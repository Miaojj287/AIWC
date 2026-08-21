use aes::cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit};
use aes::Aes128;
use napi::bindgen_prelude::Buffer;
use napi::{Error, Result, Status};
use napi_derive::napi;
use std::fs;

const V1_SIGNATURE: &[u8; 6] = b"\x07\x08V1\x08\x07";
const V2_SIGNATURE: &[u8; 6] = b"\x07\x08V2\x08\x07";
const DEFAULT_V1_AES_KEY: &[u8; 16] = b"cfcd208495d565ef";

#[napi(object)]
pub struct NativeDecryptResult {
    pub data: Buffer,
    pub ext: String,
    pub is_wxgf: bool,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn image_extension(data: &[u8]) -> Option<&'static str> {
    if data.len() >= 3 && data.starts_with(b"GIF") {
        return Some(".gif");
    }
    if data.len() >= 4 && data.starts_with(b"\x89PNG") {
        return Some(".png");
    }
    if data.len() >= 3 && data.starts_with(b"\xff\xd8\xff") {
        return Some(".jpg");
    }
    if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some(".webp");
    }
    None
}

fn strip_trailing_nuls(mut data: Vec<u8>) -> Vec<u8> {
    while data.last() == Some(&0) {
        data.pop();
    }
    data
}

fn decrypt_v3(bytes: &[u8], xor_key: u8) -> Vec<u8> {
    if image_extension(bytes).is_some() {
        return strip_trailing_nuls(bytes.to_vec());
    }
    bytes.iter().map(|byte| byte ^ xor_key).collect()
}

fn read_nonnegative_i32(bytes: &[u8], name: &str) -> Result<usize> {
    let raw: [u8; 4] = bytes
        .try_into()
        .map_err(|_| invalid(format!("invalid {name} field")))?;
    let value = i32::from_le_bytes(raw);
    if value < 0 {
        return Err(invalid(format!("negative {name} encountered in DAT header")));
    }
    Ok(value as usize)
}

fn strict_unpad(mut data: Vec<u8>) -> Result<Vec<u8>> {
    let padding = *data.last().ok_or_else(|| invalid("empty AES plaintext"))? as usize;
    if padding == 0 || padding > 16 || padding > data.len() {
        return Err(invalid("invalid PKCS7 padding in V4 DAT"));
    }
    if !data[data.len() - padding..]
        .iter()
        .all(|byte| *byte as usize == padding)
    {
        return Err(invalid("invalid PKCS7 padding in V4 DAT"));
    }
    data.truncate(data.len() - padding);
    Ok(data)
}

fn decrypt_v4(bytes: &[u8], xor_key: u8, aes_key: &[u8; 16]) -> Result<Vec<u8>> {
    if bytes.len() < 0x0f {
        return Err(invalid("invalid V4 DAT file: header too small"));
    }
    let aes_size = read_nonnegative_i32(&bytes[6..10], "AES size")?;
    let xor_size = read_nonnegative_i32(&bytes[10..14], "XOR size")?;
    let payload = &bytes[0x0f..];
    let aligned_aes_size = aes_size
        .checked_add(16 - (aes_size % 16))
        .ok_or_else(|| invalid("invalid V4 DAT file: AES size overflow"))?;
    if aligned_aes_size > payload.len() {
        return Err(invalid("invalid V4 DAT file: AES payload exceeds file length"));
    }

    let cipher = Aes128::new_from_slice(aes_key).map_err(|_| invalid("invalid AES key"))?;
    let mut decrypted = payload[..aligned_aes_size].to_vec();
    for block in decrypted.chunks_exact_mut(16) {
        cipher.decrypt_block(GenericArray::from_mut_slice(block));
    }
    let unpadded = strict_unpad(decrypted)?;

    let remaining = &payload[aligned_aes_size..];
    if xor_size > remaining.len() {
        return Err(invalid("invalid V4 DAT file: XOR payload exceeds file length"));
    }
    let raw_size = remaining.len() - xor_size;
    let mut output = Vec::with_capacity(unpadded.len() + remaining.len());
    output.extend_from_slice(&unpadded);
    output.extend_from_slice(&remaining[..raw_size]);
    output.extend(remaining[raw_size..].iter().map(|byte| byte ^ xor_key));
    Ok(output)
}

fn ascii_key_16(value: &str) -> Result<[u8; 16]> {
    let bytes = value.as_bytes();
    if bytes.len() < 16 || !bytes[..16].is_ascii() {
        return Err(invalid("AES key must contain at least 16 ASCII characters"));
    }
    let mut key = [0u8; 16];
    key.copy_from_slice(&bytes[..16]);
    Ok(key)
}

#[napi(js_name = "decryptDatNative")]
pub fn decrypt_dat_native(input_path: String, xor_key: u32, aes_key: Option<String>) -> Result<NativeDecryptResult> {
    if xor_key > u8::MAX as u32 {
        return Err(invalid("xorKey must be between 0 and 255"));
    }
    let bytes = fs::read(&input_path)
        .map_err(|error| Error::new(Status::GenericFailure, format!("failed to read DAT file: {error}")))?;
    let version = if bytes.starts_with(V1_SIGNATURE) {
        1
    } else if bytes.starts_with(V2_SIGNATURE) {
        2
    } else {
        0
    };

    let data = match version {
        0 => decrypt_v3(&bytes, xor_key as u8),
        1 => decrypt_v4(&bytes, xor_key as u8, DEFAULT_V1_AES_KEY)?,
        _ => {
            let key = ascii_key_16(aes_key.as_deref().unwrap_or_default())?;
            decrypt_v4(&bytes, xor_key as u8, &key)?
        }
    };
    let is_wxgf = data.len() >= 20 && data.starts_with(b"wxgf");
    let ext = if is_wxgf {
        ".hevc"
    } else {
        image_extension(&data).unwrap_or("")
    };
    Ok(NativeDecryptResult {
        data: data.into(),
        ext: ext.to_string(),
        is_wxgf,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_plaintext_images_and_strips_nuls() {
        let input = b"\xff\xd8\xffhello\xff\xd9\0\0";
        assert_eq!(decrypt_v3(input, 0x73), b"\xff\xd8\xffhello\xff\xd9");
    }

    #[test]
    fn decrypts_xor_images() {
        let plain = b"\x89PNGpayload";
        let encrypted: Vec<u8> = plain.iter().map(|byte| byte ^ 0x73).collect();
        assert_eq!(decrypt_v3(&encrypted, 0x73), plain);
    }
}
