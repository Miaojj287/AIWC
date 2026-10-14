/* SPDX-License-Identifier: MIT */
#include "codecHelper.h"
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static const char *status_name(CodecStatus status) {
  switch (status) {
    case CODEC_OK: return "ok";
    case CODEC_NEEDS_AUTHORIZATION: return "needs_authorization";
    case CODEC_UNSUPPORTED_VERSION: return "unsupported_version";
    case CODEC_NOT_FOUND: return "not_found";
    case CODEC_TIMEOUT: return "timeout";
    case CODEC_PROCESS_EXITED: return "process_exited";
  }
  return "not_found";
}

static void encode_hex(const unsigned char *source, size_t size, char *destination) {
  static const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < size; ++i) {
    destination[i * 2] = digits[source[i] >> 4];
    destination[i * 2 + 1] = digits[source[i] & 15];
  }
  destination[size * 2] = '\0';
}

int codec_emit(CodecStatus status, const CodecScan *scan) {
  if (status != CODEC_OK) scan = NULL;
  char output[CODEC_RESULT_BYTES];
  int written = snprintf(output, sizeof(output), "{\"version\":1,\"status\":\"%s\",\"entries\":[", status_name(status));
  if (written < 0 || (size_t)written >= sizeof(output)) return 1;
  size_t used = (size_t)written;
  unsigned emitted = 0;
  for (unsigned i = 0; scan && i < scan->database_count && !codec_cancelled; ++i) {
    const CodecDatabase *database = &scan->databases[i];
    if (!database->matched) continue;
    char salt_hex[CODEC_SALT_BYTES * 2 + 1], key_hex[CODEC_KEY_BYTES * 2 + 1];
    encode_hex(database->pages[0], CODEC_SALT_BYTES, salt_hex);
    encode_hex(database->key, CODEC_KEY_BYTES, key_hex);
    written = snprintf(output + used, sizeof(output) - used,
        "%s{\"index\":%u,\"saltHex\":\"%s\",\"keyHex\":\"%s\",\"form\":\"direct\"}",
        emitted++ ? "," : "", database->index, salt_hex, key_hex);
    codec_wipe(salt_hex, sizeof(salt_hex));
    codec_wipe(key_hex, sizeof(key_hex));
    if (written < 0 || (size_t)written >= sizeof(output) - used) {
      codec_wipe(output, sizeof(output));
      return 1;
    }
    used += (size_t)written;
  }
  memcpy(output + used, "]}\n", 3);
  used += 3;
  size_t offset = 0;
  while (offset < used) {
    ssize_t bytes = write(STDOUT_FILENO, output + offset, used - offset);
    if (bytes < 0 && errno == EINTR) continue;
    if (bytes <= 0) break;
    offset += (size_t)bytes;
  }
  codec_wipe(output, sizeof(output));
  return offset == used ? 0 : 1;
}
