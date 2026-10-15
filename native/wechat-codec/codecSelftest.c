/* SPDX-License-Identifier: MIT */
#include "codecHelper.h"
#include <CommonCrypto/CommonCryptor.h>
#include <CommonCrypto/CommonHMAC.h>
#include <CommonCrypto/CommonKeyDerivation.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

volatile sig_atomic_t codec_cancelled;

static void fill(unsigned char *buffer, size_t size, unsigned seed) {
  for (size_t i = 0; i < size; ++i) buffer[i] = (unsigned char)(i * 71 + seed * 29);
}

static void authenticate(unsigned char *page, const unsigned char *hmac_key, uint32_t number) {
  CCHmacContext context;
  CCHmacInit(&context, kCCHmacAlgSHA512, hmac_key, CODEC_KEY_BYTES);
  unsigned offset = number == 1 ? CODEC_SALT_BYTES : 0;
  CCHmacUpdate(&context, page + offset, 4032 - offset);
  const unsigned char encoded[4] = {number & 255, (number >> 8) & 255,
      (number >> 16) & 255, (number >> 24) & 255};
  CCHmacUpdate(&context, encoded, sizeof(encoded));
  CCHmacFinal(&context, page + 4032);
  codec_wipe(&context, sizeof(context));
}

static int make_database(CodecDatabase *database, const unsigned char *key, unsigned seed) {
  database->page_count = 3;
  database->numbers[0] = 1;
  database->numbers[1] = 2;
  database->numbers[2] = 7;
  for (unsigned i = 0; i < 3; ++i) fill(database->pages[i], CODEC_PAGE_BYTES, seed + i);
  unsigned char body[4000];
  fill(body, sizeof(body), seed + 3);
  const unsigned char sqlite_fields[] = {0x10, 0, 2, 2, 80, 64, 32, 32};
  memcpy(body, sqlite_fields, sizeof(sqlite_fields));
  size_t length = 0;
  int valid = CCCrypt(kCCEncrypt, kCCAlgorithmAES, 0, key, CODEC_KEY_BYTES,
      database->pages[0] + 4016, body, sizeof(body), database->pages[0] + 16,
      sizeof(body), &length) == kCCSuccess && length == sizeof(body);
  unsigned char salt[CODEC_SALT_BYTES], hmac_key[CODEC_KEY_BYTES];
  for (unsigned i = 0; i < sizeof(salt); ++i) salt[i] = database->pages[0][i] ^ 0x3a;
  valid = valid && CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)key, CODEC_KEY_BYTES,
      salt, sizeof(salt), kCCPRFHmacAlgSHA512, 2, hmac_key, sizeof(hmac_key)) == kCCSuccess;
  for (unsigned i = 0; i < 3; ++i) authenticate(database->pages[i], hmac_key, database->numbers[i]);
  codec_wipe(body, sizeof(body));
  codec_wipe(salt, sizeof(salt));
  codec_wipe(hmac_key, sizeof(hmac_key));
  return valid;
}

static int crypto_tests(CodecScan *scan, const unsigned char *key) {
  CodecDatabase *database = &scan->databases[0];
  int valid = make_database(database, key, 1) && codec_verify_key(key, database);
  unsigned char wrong_key[CODEC_KEY_BYTES];
  memcpy(wrong_key, key, sizeof(wrong_key));
  wrong_key[0] ^= 1;
  valid = valid && !codec_verify_key(wrong_key, database);
  for (unsigned i = 0; i < 3; ++i) {
    database->pages[i][100] ^= 1;
    valid = valid && !codec_verify_key(key, database);
    database->pages[i][100] ^= 1;
  }
  database->numbers[1] = 3;
  valid = valid && !codec_verify_key(key, database);
  database->numbers[1] = 2;
  database->pages[0][0] ^= 1;
  valid = valid && !codec_verify_key(key, database);
  database->pages[0][0] ^= 1;
  codec_wipe(wrong_key, sizeof(wrong_key));
  return valid;
}

static int file_tests(CodecScan *scan, const unsigned char *key) {
  char path[] = "/tmp/aiwc-codec-selftest-XXXXXX";
  int descriptor = mkstemp(path);
  if (descriptor < 0) return 0;
  CodecDatabase *database = &scan->databases[0];
  int valid = ftruncate(descriptor, 7 * CODEC_PAGE_BYTES) == 0;
  for (unsigned i = 0; i < 3 && valid; ++i) {
    off_t offset = (off_t)(database->numbers[i] - 1) * CODEC_PAGE_BYTES;
    valid = pwrite(descriptor, database->pages[i], CODEC_PAGE_BYTES, offset) == CODEC_PAGE_BYTES;
  }
  close(descriptor);
  CodecDatabase *loaded = calloc(1, sizeof(*loaded));
  valid = valid && loaded && codec_load_database(path, 73, loaded) && loaded->index == 73 &&
      loaded->page_count == 3 && loaded->numbers[2] == 7 && codec_verify_key(key, loaded);
  if (loaded) { codec_wipe(loaded, sizeof(*loaded)); free(loaded); }
  unlink(path);
  return valid;
}

static int header_tests(void) {
  unsigned char header[56] = {0};
  const uint32_t fields[] = {0xfeedfacf, 0x0100000c, 0, 6, 1, 24, 0, 0, 0x1b, 24};
  memcpy(header, fields, sizeof(fields));
  const unsigned char uuid[] = {0x8a, 0xcf, 0x7a, 0x2f, 0x51, 0x7c, 0x32, 0xb4,
      0x9d, 0xfb, 0x47, 0xe8, 0x84, 0x9c, 0xd4, 0x44};
  memcpy(header + 40, uuid, sizeof(uuid));
  int valid = codec_live_header(header, sizeof(header));
  header[40] ^= 1;
  valid = valid && !codec_live_header(header, sizeof(header));
  header[40] ^= 1;
  header[4] ^= 1;
  valid = valid && !codec_live_header(header, sizeof(header));
  header[4] ^= 1;
  header[36] = 255;
  return valid && !codec_live_header(header, sizeof(header));
}

static int context_tests(CodecScan *scan, const unsigned char *key) {
  unsigned char context[CODEC_CONTEXT_BYTES] = {0}, child[CODEC_SUBCONTEXT_BYTES] = {0};
  unsigned char masked_key[CODEC_KEY_BYTES];
  uint64_t provider[8] = {0};
  scan->task = mach_task_self();
  scan->core = 0x100000000ULL;
  scan->deadline = codec_seconds() + CODEC_SCAN_SECONDS;
  scan->database_count = 2;
  scan->databases[1].index = 41;
  int valid = make_database(&scan->databases[1], key, 17);
  for (unsigned i = 0; i < CODEC_KEY_BYTES; ++i) masked_key[i] = key[i] ^ scan->mask[i];
  uint64_t pointer = (uint64_t)masked_key;
  memcpy(child + 8, &pointer, sizeof(pointer));
  const uint32_t shape[] = {16, 32, 16, 16, 4096};
  memcpy(context + 12, shape, sizeof(shape));
  provider[6] = scan->core + CODEC_KDF_OFFSET;
  provider[7] = scan->core + CODEC_AES_OFFSET + 4;
  pointer = (uint64_t)provider;
  memcpy(context + 120, &pointer, sizeof(pointer));
  pointer = (uint64_t)child;
  memcpy(context + 104, &pointer, sizeof(pointer));
  memcpy(context + 112, &pointer, sizeof(pointer));
  codec_scan_chunk(scan, context, sizeof(context));
  valid = valid && scan->contexts == 0 && scan->matched_count == 0;
  provider[7] -= 4;
  codec_scan_chunk(scan, context, sizeof(context));
  valid = valid && scan->contexts == 1 && scan->matched_count == 2 &&
      !memcmp(scan->databases[0].key, key, CODEC_KEY_BYTES) &&
      !memcmp(scan->databases[1].key, key, CODEC_KEY_BYTES);
  scan->databases[0].matched = scan->databases[1].matched = 0;
  scan->matched_count = 0;
  codec_cancelled = 1;
  codec_scan_chunk(scan, context, sizeof(context));
  valid = valid && scan->contexts == 1 && scan->matched_count == 0;
  codec_cancelled = 0;
  scan->deadline = codec_seconds() - 1;
  codec_scan_chunk(scan, context, sizeof(context));
  valid = valid && scan->contexts == 1 && scan->matched_count == 0;
  scan->owner_pid = getppid() + 1;
  valid = valid && !codec_owner_alive(scan) && codec_cancelled;
  codec_cancelled = 0;
  scan->owner_pid = 0;
  codec_wipe(masked_key, sizeof(masked_key));
  codec_wipe(child, sizeof(child));
  codec_wipe(context, sizeof(context));
  return valid;
}

static void encode_keyspec(unsigned char *output, const unsigned char *key,
                           const unsigned char *salt, int has_salt) {
  static const char digits[] = "0123456789abcdef";
  output[0] = 'x';
  output[1] = '\'';
  unsigned bytes = CODEC_KEY_BYTES + (has_salt ? CODEC_SALT_BYTES : 0);
  for (unsigned i = 0; i < bytes; ++i) {
    unsigned char value = i < CODEC_KEY_BYTES ? key[i] : salt[i - CODEC_KEY_BYTES];
    output[2 + i * 2] = digits[value >> 4];
    output[3 + i * 2] = digits[value & 15];
  }
  output[2 + bytes * 2] = '\'';
}

static void scan_retained(CodecScan *scan, unsigned char *context, unsigned char *child,
                         unsigned char *keyspec, uint32_t length) {
  for (unsigned i = 0; i < scan->database_count; ++i) scan->databases[i].matched = 0;
  scan->matched_count = 0;
  uint64_t pointer = (uint64_t)keyspec;
  memcpy(child + 4, &length, sizeof(length));
  memcpy(child + 24, &pointer, sizeof(pointer));
  codec_scan_chunk(scan, context, CODEC_CONTEXT_BYTES);
}

static int retained_tests(CodecScan *scan, const unsigned char *key) {
  enum { KEYSPEC_BYTES = 99, KEY_ONLY_BYTES = 67, KEYSPEC_BUFFER_BYTES = 104 };
  unsigned char context[CODEC_CONTEXT_BYTES] = {0}, child[CODEC_SUBCONTEXT_BYTES] = {0};
  unsigned char keyspec[KEYSPEC_BUFFER_BYTES] = {0}, original[KEYSPEC_BUFFER_BYTES] = {0};
  uint64_t provider[8] = {0};
  scan->task = mach_task_self();
  scan->core = 0x100000000ULL;
  scan->deadline = codec_seconds() + CODEC_SCAN_SECONDS;
  scan->database_count = 2;
  scan->contexts = 0;
  const uint32_t shape[] = {16, 32, 16, 16, 4096};
  memcpy(context + 12, shape, sizeof(shape));
  provider[6] = scan->core + CODEC_KDF_OFFSET;
  provider[7] = scan->core + CODEC_AES_OFFSET;
  uint64_t pointer = (uint64_t)provider;
  memcpy(context + 120, &pointer, sizeof(pointer));
  pointer = (uint64_t)child;
  memcpy(context + 104, &pointer, sizeof(pointer));
  memcpy(context + 112, &pointer, sizeof(pointer));
  encode_keyspec(original, key, scan->databases[0].pages[0], 1);
  for (unsigned i = 0; i < KEYSPEC_BYTES; ++i) original[i] ^= scan->mask[i % CODEC_KEY_BYTES];
  memcpy(keyspec, original, sizeof(keyspec));
  scan_retained(scan, context, child, keyspec, KEYSPEC_BYTES);
  int valid = scan->matched_count == 1 && scan->databases[0].matched &&
      !scan->databases[1].matched && !memcmp(scan->databases[0].key, key, CODEC_KEY_BYTES);
  // Reject malformed syntax, a different explicit salt, and a different key.
  const unsigned offsets[] = {0, 1, 2, 66, 98};
  for (unsigned i = 0; i < sizeof(offsets) / sizeof(offsets[0]); ++i) {
    memcpy(keyspec, original, sizeof(keyspec));
    keyspec[offsets[i]] = 'z' ^ scan->mask[offsets[i] % CODEC_KEY_BYTES];
    scan_retained(scan, context, child, keyspec, KEYSPEC_BYTES);
    valid = valid && scan->matched_count == 0;
  }
  memcpy(keyspec, original, sizeof(keyspec));
  keyspec[2] = (('0' ^ scan->mask[2]) == keyspec[2] ? '1' : '0') ^ scan->mask[2];
  scan_retained(scan, context, child, keyspec, KEYSPEC_BYTES);
  valid = valid && scan->matched_count == 0;
  memcpy(keyspec, original, sizeof(keyspec));
  keyspec[66] = (('0' ^ scan->mask[2]) == keyspec[66] ? '1' : '0') ^ scan->mask[2];
  scan_retained(scan, context, child, keyspec, KEYSPEC_BYTES);
  valid = valid && scan->matched_count == 0;
  memcpy(keyspec, original, sizeof(keyspec));
  scan_retained(scan, context, child, keyspec, KEYSPEC_BYTES - 1);
  valid = valid && scan->matched_count == 0;
  scan->databases[0].pages[2][100] ^= 1;
  scan_retained(scan, context, child, keyspec, KEYSPEC_BYTES);
  valid = valid && scan->matched_count == 0;
  scan->databases[0].pages[2][100] ^= 1;
  encode_keyspec(keyspec, key, NULL, 0);
  for (unsigned i = 0; i < KEY_ONLY_BYTES; ++i) keyspec[i] ^= scan->mask[i % CODEC_KEY_BYTES];
  scan_retained(scan, context, child, keyspec, KEY_ONLY_BYTES);
  valid = valid && scan->matched_count == 2;
  codec_cancelled = 1;
  scan_retained(scan, context, child, keyspec, KEY_ONLY_BYTES);
  valid = valid && scan->matched_count == 0;
  codec_cancelled = 0;
  codec_wipe(context, sizeof(context));
  codec_wipe(child, sizeof(child));
  codec_wipe(keyspec, sizeof(keyspec));
  codec_wipe(original, sizeof(original));
  codec_wipe(provider, sizeof(provider));
  return valid;
}

static int output_tests(CodecScan *scan) {
  int descriptors[2];
  if (pipe(descriptors) != 0) return 0;
  int original = dup(STDOUT_FILENO);
  if (original < 0 || dup2(descriptors[1], STDOUT_FILENO) < 0) {
    if (original >= 0) close(original);
    close(descriptors[0]);
    close(descriptors[1]);
    return 0;
  }
  scan->databases[0].matched = 1;
  int valid = codec_emit(CODEC_TIMEOUT, scan) == 0;
  dup2(original, STDOUT_FILENO);
  close(original);
  close(descriptors[1]);
  char buffer[256];
  ssize_t bytes = read(descriptors[0], buffer, sizeof(buffer) - 1);
  close(descriptors[0]);
  if (bytes < 0) return 0;
  buffer[bytes] = '\0';
  valid = valid && !strcmp(buffer, "{\"version\":1,\"status\":\"timeout\",\"entries\":[]}\n");
  codec_wipe(buffer, sizeof(buffer));
  return valid;
}

int main(void) {
  CodecScan *scan = calloc(1, sizeof(*scan));
  if (!scan) return 1;
  unsigned char key[CODEC_KEY_BYTES];
  fill(key, sizeof(key), 23);
  fill(scan->mask, sizeof(scan->mask), 11);
  int crypto = crypto_tests(scan, key);
  int file = file_tests(scan, key);
  int header = header_tests();
  int context = context_tests(scan, key);
  int retained = retained_tests(scan, key);
  int output = output_tests(scan);
  codec_wipe(key, sizeof(key));
  codec_wipe(scan, sizeof(*scan));
  free(scan);
  printf("{\"crypto\":%s,\"file\":%s,\"version\":%s,\"context\":%s,\"retained\":%s,\"output\":%s}\n",
      crypto ? "true" : "false", file ? "true" : "false", header ? "true" : "false",
      context ? "true" : "false", retained ? "true" : "false", output ? "true" : "false");
  return crypto && file && header && context && retained && output ? 0 : 1;
}
