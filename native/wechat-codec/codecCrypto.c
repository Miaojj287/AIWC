/* SPDX-License-Identifier: MIT */
#include "codecHelper.h"
#include <CommonCrypto/CommonCryptor.h>
#include <CommonCrypto/CommonHMAC.h>
#include <CommonCrypto/CommonKeyDerivation.h>
#include <fcntl.h>
#include <limits.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

void codec_wipe(void *buffer, size_t size) {
  volatile unsigned char *bytes = buffer;
  while (size--) *bytes++ = 0;
}

double codec_seconds(void) {
  struct timespec time;
  if (clock_gettime(CLOCK_MONOTONIC, &time) != 0) return 0;
  return time.tv_sec + time.tv_nsec / 1e9;
}

int codec_owner_alive(CodecScan *scan) {
  if (scan->owner_pid && getppid() != scan->owner_pid) codec_cancelled = 1;
  return !codec_cancelled;
}

int codec_load_database(const char *path, unsigned index, CodecDatabase *database) {
  int descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) return 0;
  struct stat info;
  int valid = !fstat(descriptor, &info) && S_ISREG(info.st_mode) &&
      info.st_size >= CODEC_PAGE_BYTES && info.st_size % CODEC_PAGE_BYTES == 0 &&
      (uint64_t)info.st_size / CODEC_PAGE_BYTES <= UINT32_MAX;
  if (valid) {
    uint32_t last = (uint32_t)(info.st_size / CODEC_PAGE_BYTES);
    database->index = index;
    database->numbers[0] = 1;
    database->page_count = 1;
    if (last >= 2) database->numbers[database->page_count++] = 2;
    if (last > 2) database->numbers[database->page_count++] = last;
    for (unsigned i = 0; i < database->page_count; ++i) {
      off_t offset = (off_t)(database->numbers[i] - 1) * CODEC_PAGE_BYTES;
      if (pread(descriptor, database->pages[i], CODEC_PAGE_BYTES, offset) != CODEC_PAGE_BYTES) {
        valid = 0;
        break;
      }
    }
  }
  close(descriptor);
  if (!valid) codec_wipe(database, sizeof(*database));
  return valid;
}

static int header_matches(const unsigned char *key, const unsigned char *page) {
  enum { IV_OFFSET = 4016, HEADER_BYTES = 32 };
  unsigned char plain[HEADER_BYTES] = {0};
  size_t length = 0;
  CCCryptorStatus result = CCCrypt(kCCDecrypt, kCCAlgorithmAES, 0,
      key, CODEC_KEY_BYTES, page + IV_OFFSET, page + CODEC_SALT_BYTES,
      sizeof(plain), plain, sizeof(plain), &length);
  int valid = result == kCCSuccess && length == sizeof(plain) &&
      plain[0] == 0x10 && plain[1] == 0 &&
      (plain[2] == 1 || plain[2] == 2) &&
      (plain[3] == 1 || plain[3] == 2) &&
      plain[4] == 80 && plain[5] == 64 && plain[6] == 32 && plain[7] == 32;
  codec_wipe(plain, sizeof(plain));
  return valid;
}

static int page_hmac_matches(const unsigned char *hmac_key,
                             const unsigned char *page, uint32_t number) {
  enum { HMAC_OFFSET = 4032, DIGEST_BYTES = 64 };
  unsigned char digest[DIGEST_BYTES];
  CCHmacContext context;
  CCHmacInit(&context, kCCHmacAlgSHA512, hmac_key, CODEC_KEY_BYTES);
  unsigned offset = number == 1 ? CODEC_SALT_BYTES : 0;
  CCHmacUpdate(&context, page + offset, HMAC_OFFSET - offset);
  const unsigned char encoded_number[4] = {
      number & 255, (number >> 8) & 255, (number >> 16) & 255, (number >> 24) & 255};
  CCHmacUpdate(&context, encoded_number, sizeof(encoded_number));
  CCHmacFinal(&context, digest);
  unsigned difference = 0;
  for (unsigned i = 0; i < sizeof(digest); ++i) difference |= digest[i] ^ page[HMAC_OFFSET + i];
  codec_wipe(digest, sizeof(digest));
  codec_wipe(&context, sizeof(context));
  return difference == 0;
}

int codec_verify_key(const unsigned char *key, const CodecDatabase *database) {
  if (!database->page_count || database->page_count > 3 ||
      database->numbers[0] != 1 || !header_matches(key, database->pages[0])) return 0;
  unsigned char salt[CODEC_SALT_BYTES], hmac_key[CODEC_KEY_BYTES];
  for (unsigned i = 0; i < sizeof(salt); ++i) salt[i] = database->pages[0][i] ^ 0x3a;
  int valid = CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)key, CODEC_KEY_BYTES,
      salt, sizeof(salt), kCCPRFHmacAlgSHA512, 2, hmac_key, sizeof(hmac_key)) == kCCSuccess;
  for (unsigned i = 0; valid && i < database->page_count; ++i)
    valid = page_hmac_matches(hmac_key, database->pages[i], database->numbers[i]);
  codec_wipe(salt, sizeof(salt));
  codec_wipe(hmac_key, sizeof(hmac_key));
  return valid;
}
