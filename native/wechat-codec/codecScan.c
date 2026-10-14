/* SPDX-License-Identifier: MIT */
#include "codecHelper.h"
#include <errno.h>
#include <mach/mach_vm.h>
#include <stdlib.h>
#include <string.h>

static int expired(CodecScan *scan) {
  return !codec_owner_alive(scan) || codec_seconds() >= scan->deadline;
}

static void check_subcontext(CodecScan *scan, uint64_t pointer) {
  unsigned char context[CODEC_SUBCONTEXT_BYTES] = {0}, key[CODEC_KEY_BYTES] = {0};
  uint64_t key_pointer = 0;
  if (codec_read(scan->task, pointer, context, sizeof(context)))
    memcpy(&key_pointer, context + 8, sizeof(key_pointer));
  if (codec_pointer(key_pointer) && codec_read(scan->task, key_pointer, key, sizeof(key))) {
    for (unsigned i = 0; i < sizeof(key); ++i) key[i] ^= scan->mask[i];
    for (unsigned i = 0; i < scan->database_count && !expired(scan); ++i) {
      CodecDatabase *database = &scan->databases[i];
      if (!database->matched && codec_verify_key(key, database)) {
        memcpy(database->key, key, sizeof(database->key));
        database->matched = 1;
        ++scan->matched_count;
      }
    }
  }
  codec_wipe(context, sizeof(context));
  codec_wipe(key, sizeof(key));
}

void codec_scan_chunk(CodecScan *scan, const unsigned char *data, size_t size) {
  const uint32_t shape[5] = {16, 32, 16, 16, 4096};
  for (size_t offset = 0; offset + CODEC_CONTEXT_BYTES <= size; offset += 8) {
    if (scan->matched_count == scan->database_count ||
        scan->contexts >= CODEC_MAX_CONTEXTS ||
        ((offset & 4095) == 0 && expired(scan))) break;
    if (memcmp(data + offset + 12, shape, sizeof(shape))) continue;
    uint64_t provider, read_context, write_context, functions[8] = {0};
    memcpy(&provider, data + offset + 120, sizeof(provider));
    memcpy(&read_context, data + offset + 104, sizeof(read_context));
    memcpy(&write_context, data + offset + 112, sizeof(write_context));
    if (!codec_pointer(provider) || !codec_read(scan->task, provider, functions, sizeof(functions)) ||
        functions[6] != scan->core + CODEC_KDF_OFFSET ||
        functions[7] != scan->core + CODEC_AES_OFFSET) continue;
    ++scan->contexts;
    if (codec_pointer(read_context)) check_subcontext(scan, read_context);
    if (write_context != read_context && codec_pointer(write_context)) check_subcontext(scan, write_context);
  }
}

static int process_exited(pid_t pid) {
  return kill(pid, 0) != 0 && errno == ESRCH;
}

static CodecStatus scan_region(CodecScan *scan, mach_vm_address_t address,
                               mach_vm_size_t length, unsigned char *data) {
  for (uint64_t offset = 0; offset < length; offset += CODEC_CHUNK_BYTES) {
    if (expired(scan) || scan->scanned_bytes >= CODEC_MAX_SCAN_BYTES ||
        scan->contexts >= CODEC_MAX_CONTEXTS) return CODEC_TIMEOUT;
    size_t bytes = (size_t)(length - offset);
    if (bytes > CODEC_CHUNK_BYTES + CODEC_CONTEXT_BYTES)
      bytes = CODEC_CHUNK_BYTES + CODEC_CONTEXT_BYTES;
    if (bytes > CODEC_MAX_SCAN_BYTES - scan->scanned_bytes)
      bytes = (size_t)(CODEC_MAX_SCAN_BYTES - scan->scanned_bytes);
    mach_vm_size_t got = 0;
    kern_return_t result = mach_vm_read_overwrite(scan->task, address + offset, bytes,
        (mach_vm_address_t)data, &got);
    if (result != KERN_SUCCESS) {
      if (process_exited(scan->pid)) return CODEC_PROCESS_EXITED;
      continue;
    }
    scan->scanned_bytes += got;
    codec_scan_chunk(scan, data, got);
    codec_wipe(data, got);
    if (scan->matched_count == scan->database_count) return CODEC_OK;
  }
  return CODEC_NOT_FOUND;
}

static CodecStatus scan_regions(CodecScan *scan, unsigned char *data) {
  mach_vm_address_t address = 0;
  natural_t depth = 0;
  while (!expired(scan)) {
    mach_vm_size_t length = 0;
    vm_region_submap_info_data_64_t info;
    mach_msg_type_number_t count = VM_REGION_SUBMAP_INFO_COUNT_64;
    kern_return_t result;
    do {
      count = VM_REGION_SUBMAP_INFO_COUNT_64;
      result = mach_vm_region_recurse(scan->task, &address, &length, &depth,
          (vm_region_recurse_info_t)&info, &count);
      if (result != KERN_SUCCESS || !info.is_submap) break;
      ++depth;
    } while (depth < CODEC_MAX_DYLD_DEPTH);
    if (result != KERN_SUCCESS || !length || address + length < address || info.is_submap)
      return process_exited(scan->pid) ? CODEC_PROCESS_EXITED : CODEC_NOT_FOUND;
    if ((info.protection & (VM_PROT_READ | VM_PROT_WRITE)) == (VM_PROT_READ | VM_PROT_WRITE) &&
        info.pages_resident && info.user_tag <= 20 && length <= CODEC_MAX_REGION_BYTES) {
      CodecStatus status = scan_region(scan, address, length, data);
      if (status != CODEC_NOT_FOUND) return status;
    }
    address += length;
  }
  return CODEC_TIMEOUT;
}

CodecStatus codec_scan_memory(CodecScan *scan) {
  size_t size = CODEC_CHUNK_BYTES + CODEC_CONTEXT_BYTES;
  unsigned char *data = malloc(size);
  if (!data) return CODEC_NOT_FOUND;
  CodecStatus status = scan_regions(scan, data);
  codec_wipe(data, size);
  free(data);
  return status;
}
