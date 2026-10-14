/* SPDX-License-Identifier: MIT */
#include "codecHelper.h"
#include <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <limits.h>
#include <mach/mach_vm.h>
#include <mach/task_info.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const unsigned char EXPECTED_UUID[16] = {
    0x8a, 0xcf, 0x7a, 0x2f, 0x51, 0x7c, 0x32, 0xb4,
    0x9d, 0xfb, 0x47, 0xe8, 0x84, 0x9c, 0xd4, 0x44};
static const unsigned char EXPECTED_SHA256[32] = {
    0xa1, 0x70, 0x9b, 0xa6, 0x2c, 0xae, 0x1b, 0x8b,
    0x27, 0x05, 0x13, 0x79, 0x80, 0xe2, 0x39, 0x83,
    0xed, 0x42, 0xdc, 0x88, 0xaf, 0xfe, 0x77, 0x4c,
    0x44, 0x42, 0x48, 0x8b, 0x82, 0xb0, 0x07, 0xfe};

int codec_read(task_t task, uint64_t address, void *output, size_t size) {
  if (!address || !size || size > CODEC_READ_LIMIT_BYTES || address + size < address) return 0;
  mach_vm_size_t got = 0;
  kern_return_t result = mach_vm_read_overwrite(task, address, size,
      (mach_vm_address_t)output, &got);
  return result == KERN_SUCCESS && got == size;
}

int codec_pointer(uint64_t pointer) {
  return pointer >= 0x100000000ULL && pointer < 0x1000000000000ULL && pointer % 8 == 0;
}

int codec_live_header(const unsigned char *header, size_t size) {
  enum { MACH_HEADER_BYTES = 32, UUID_COMMAND = 0x1b, UUID_COMMAND_BYTES = 24 };
  if (size < MACH_HEADER_BYTES) return 0;
  uint32_t magic, cpu, commands, command_bytes;
  memcpy(&magic, header, 4);
  memcpy(&cpu, header + 4, 4);
  memcpy(&commands, header + 16, 4);
  memcpy(&command_bytes, header + 20, 4);
  if (magic != 0xfeedfacf || cpu != 0x0100000c ||
      command_bytes > size - MACH_HEADER_BYTES || commands > command_bytes / 8) return 0;
  size_t offset = MACH_HEADER_BYTES;
  size_t end = MACH_HEADER_BYTES + command_bytes;
  int uuid_matches = 0;
  for (uint32_t i = 0; i < commands; ++i) {
    if (offset + 8 > end) return 0;
    uint32_t command, bytes;
    memcpy(&command, header + offset, 4);
    memcpy(&bytes, header + offset + 4, 4);
    if (bytes < 8 || bytes > end - offset) return 0;
    if (command == UUID_COMMAND) {
      if (bytes != UUID_COMMAND_BYTES || uuid_matches) return 0;
      uuid_matches = !memcmp(header + offset + 8, EXPECTED_UUID, sizeof(EXPECTED_UUID));
    }
    offset += bytes;
  }
  return uuid_matches && offset == end;
}

CodecStatus codec_load_mask(const char *path, CodecScan *scan) {
  int descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (descriptor < 0) return CODEC_UNSUPPORTED_VERSION;
  struct stat info;
  int valid = !fstat(descriptor, &info) && S_ISREG(info.st_mode) &&
      (uint64_t)info.st_size == CODEC_CORE_FILE_BYTES;
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  unsigned char *buffer = malloc(CODEC_CHUNK_BYTES);
  unsigned char digest[CC_SHA256_DIGEST_LENGTH] = {0};
  uint64_t offset = 0;
  while (valid && buffer && offset < CODEC_CORE_FILE_BYTES) {
    if (!codec_owner_alive(scan) || codec_seconds() >= scan->deadline) break;
    ssize_t bytes = pread(descriptor, buffer, CODEC_CHUNK_BYTES, (off_t)offset);
    if (bytes <= 0) { valid = 0; break; }
    CC_SHA256_Update(&context, buffer, (CC_LONG)bytes);
    offset += (uint64_t)bytes;
  }
  CC_SHA256_Final(digest, &context);
  valid = valid && offset == CODEC_CORE_FILE_BYTES &&
      !memcmp(digest, EXPECTED_SHA256, sizeof(digest)) &&
      pread(descriptor, scan->mask, sizeof(scan->mask),
          CODEC_ARM64_FILE_OFFSET + CODEC_MASK_OFFSET) == sizeof(scan->mask);
  codec_wipe(digest, sizeof(digest));
  codec_wipe(&context, sizeof(context));
  if (buffer) { codec_wipe(buffer, CODEC_CHUNK_BYTES); free(buffer); }
  close(descriptor);
  if (!codec_owner_alive(scan) || codec_seconds() >= scan->deadline) return CODEC_TIMEOUT;
  return valid ? CODEC_OK : CODEC_UNSUPPORTED_VERSION;
}

static int read_image_path(task_t task, uint64_t address, char *path, size_t capacity) {
  enum { PATH_CHUNK_BYTES = 128, VM_PAGE_BYTES = 4096 };
  size_t offset = 0;
  while (offset + 1 < capacity) {
    size_t bytes = capacity - offset - 1;
    if (bytes > PATH_CHUNK_BYTES) bytes = PATH_CHUNK_BYTES;
    size_t page_bytes = VM_PAGE_BYTES - (size_t)((address + offset) % VM_PAGE_BYTES);
    if (bytes > page_bytes) bytes = page_bytes;
    if (!codec_read(task, address + offset, path + offset, bytes)) return 0;
    if (memchr(path + offset, '\0', bytes)) return 1;
    offset += bytes;
  }
  path[capacity - 1] = '\0';
  return 0;
}

static CodecStatus resolve_image(const char *path, CodecScan *scan) {
  struct task_dyld_info info;
  mach_msg_type_number_t count = TASK_DYLD_INFO_COUNT;
  if (task_info(scan->task, TASK_DYLD_INFO, (task_info_t)&info, &count) != KERN_SUCCESS)
    return CODEC_NOT_FOUND;
  struct { uint32_t version, count; uint64_t array; } header = {0};
  if (!codec_read(scan->task, info.all_image_info_addr, &header, sizeof(header)) ||
      header.count > CODEC_MAX_DYLD_IMAGES) return CODEC_NOT_FOUND;
  struct { uint64_t base, path, date; } images[CODEC_MAX_DYLD_IMAGES];
  enum { IMAGE_CHUNK = 256 };
  for (uint32_t i = 0; i < header.count; i += IMAGE_CHUNK) {
    uint32_t chunk = header.count - i;
    if (chunk > IMAGE_CHUNK) chunk = IMAGE_CHUNK;
    if (!codec_read(scan->task, header.array + i * sizeof(images[0]),
                    images + i, chunk * sizeof(images[0]))) return CODEC_NOT_FOUND;
  }
  for (uint32_t i = 0; i < header.count; ++i) {
    if (!codec_owner_alive(scan) || codec_seconds() >= scan->deadline) return CODEC_TIMEOUT;
    char live_path[PATH_MAX] = {0}, resolved_path[PATH_MAX];
    if (!read_image_path(scan->task, images[i].path, live_path, sizeof(live_path)) ||
        !realpath(live_path, resolved_path) || strcmp(resolved_path, path)) continue;
    unsigned char live_header[CODEC_READ_LIMIT_BYTES];
    if (!codec_read(scan->task, images[i].base, live_header, sizeof(live_header)) ||
        !codec_live_header(live_header, sizeof(live_header))) return CODEC_UNSUPPORTED_VERSION;
    scan->core = images[i].base;
    return CODEC_OK;
  }
  return CODEC_UNSUPPORTED_VERSION;
}

CodecStatus codec_resolve_core(const char *path, CodecScan *scan) {
  char resolved_path[PATH_MAX];
  if (!realpath(path, resolved_path)) return CODEC_UNSUPPORTED_VERSION;
  return resolve_image(resolved_path, scan);
}
