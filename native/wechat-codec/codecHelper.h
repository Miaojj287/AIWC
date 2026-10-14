/* SPDX-License-Identifier: MIT */
#ifndef AIWC_CODEC_HELPER_H
#define AIWC_CODEC_HELPER_H

#include <mach/mach.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>

enum {
  CODEC_MAX_DATABASES = 128,
  CODEC_PAGE_BYTES = 4096,
  CODEC_SALT_BYTES = 16,
  CODEC_KEY_BYTES = 32,
  CODEC_CONTEXT_BYTES = 136,
  CODEC_SUBCONTEXT_BYTES = 40,
  CODEC_READ_LIMIT_BYTES = 16384,
  CODEC_CHUNK_BYTES = 2 * 1024 * 1024,
  CODEC_MAX_CONTEXTS = 4096,
  CODEC_MAX_DYLD_IMAGES = 2048,
  CODEC_MAX_DYLD_DEPTH = 32,
  CODEC_SCAN_SECONDS = 45,
  CODEC_RESULT_BYTES = 32768
};

#define CODEC_MAX_SCAN_BYTES (4ULL * 1024 * 1024 * 1024)
#define CODEC_MAX_REGION_BYTES (256ULL * 1024 * 1024)
#define CODEC_CORE_FILE_BYTES 357747072ULL
#define CODEC_ARM64_FILE_OFFSET 184614912ULL
#define CODEC_MASK_OFFSET 0x8b6d000ULL
#define CODEC_KDF_OFFSET 0x58ba0ccULL
#define CODEC_AES_OFFSET 0x58ba1a8ULL

typedef enum {
  CODEC_OK,
  CODEC_NEEDS_AUTHORIZATION,
  CODEC_UNSUPPORTED_VERSION,
  CODEC_NOT_FOUND,
  CODEC_TIMEOUT,
  CODEC_PROCESS_EXITED
} CodecStatus;

typedef struct {
  unsigned index;
  unsigned page_count;
  uint32_t numbers[3];
  unsigned char pages[3][CODEC_PAGE_BYTES];
  unsigned char key[CODEC_KEY_BYTES];
  int matched;
} CodecDatabase;

typedef struct {
  task_t task;
  pid_t pid;
  pid_t owner_pid;
  uint64_t core;
  double deadline;
  uint64_t scanned_bytes;
  unsigned contexts;
  unsigned database_count;
  unsigned matched_count;
  unsigned char mask[CODEC_KEY_BYTES];
  CodecDatabase databases[CODEC_MAX_DATABASES];
} CodecScan;

extern volatile sig_atomic_t codec_cancelled;

void codec_wipe(void *buffer, size_t size);
double codec_seconds(void);
int codec_owner_alive(CodecScan *scan);
int codec_read(task_t task, uint64_t address, void *output, size_t size);
int codec_pointer(uint64_t pointer);
int codec_live_header(const unsigned char *header, size_t size);
CodecStatus codec_load_mask(const char *path, CodecScan *scan);
CodecStatus codec_resolve_core(const char *path, CodecScan *scan);
int codec_load_database(const char *path, unsigned index, CodecDatabase *database);
int codec_verify_key(const unsigned char *key, const CodecDatabase *database);
void codec_scan_chunk(CodecScan *scan, const unsigned char *data, size_t size);
CodecStatus codec_scan_memory(CodecScan *scan);
int codec_emit(CodecStatus status, const CodecScan *scan);

#endif
