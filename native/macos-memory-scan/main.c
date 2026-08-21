#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <fts.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <CommonCrypto/CommonCryptor.h>

#define MAX_SALTS 1000
#define RECORD_SIZE 99
#define CHUNK_SIZE (2u * 1024u * 1024u)
#define MAX_REGION_SIZE (512ull * 1024ull * 1024ull)

typedef struct {
  uint8_t values[MAX_SALTS][16];
  size_t count;
} SaltSet;

static bool ends_with_db(const char *path) {
  size_t length = strlen(path);
  return length >= 3 && strcasecmp(path + length - 3, ".db") == 0;
}

static bool add_salt(SaltSet *salts, const uint8_t value[16]) {
  for (size_t i = 0; i < salts->count; i++) {
    if (memcmp(salts->values[i], value, 16) == 0) return false;
  }
  if (salts->count >= MAX_SALTS) return false;
  memcpy(salts->values[salts->count++], value, 16);
  return true;
}

static void collect_salts(const char *root, SaltSet *salts) {
  char *paths[] = {(char *)root, NULL};
  FTS *tree = fts_open(paths, FTS_PHYSICAL | FTS_NOCHDIR, NULL);
  if (!tree) return;
  FTSENT *entry;
  while (salts->count < MAX_SALTS && (entry = fts_read(tree)) != NULL) {
    if (entry->fts_info != FTS_F || !ends_with_db(entry->fts_path)) continue;
    int fd = open(entry->fts_path, O_RDONLY);
    if (fd < 0) continue;
    uint8_t head[16];
    ssize_t actual = pread(fd, head, sizeof(head), 0);
    close(fd);
    if (actual != (ssize_t)sizeof(head)) continue;
    if (memcmp(head, "SQLite format 3", 15) == 0) continue;
    add_salt(salts, head);
  }
  fts_close(tree);
}

static int hex_value(uint8_t value) {
  if (value >= '0' && value <= '9') return value - '0';
  value = (uint8_t)tolower(value);
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  return -1;
}

static bool salt_matches(const SaltSet *salts, const uint8_t *hex) {
  uint8_t decoded[16];
  for (size_t i = 0; i < 16; i++) {
    int high = hex_value(hex[i * 2]);
    int low = hex_value(hex[i * 2 + 1]);
    if (high < 0 || low < 0) return false;
    decoded[i] = (uint8_t)((high << 4) | low);
  }
  for (size_t i = 0; i < salts->count; i++) {
    if (memcmp(salts->values[i], decoded, 16) == 0) return true;
  }
  return false;
}

static bool find_key(const uint8_t *data, size_t length, const SaltSet *salts, char key[65]) {
  if (length < RECORD_SIZE) return false;
  for (size_t i = 0; i + RECORD_SIZE <= length; i++) {
    if (data[i] != 'x' || data[i + 1] != '\'') continue;
    const uint8_t *hex = data + i + 2;
    if (data[i + 98] != '\'') continue;
    bool valid = true;
    for (size_t j = 0; j < 96; j++) {
      if (hex_value(hex[j]) < 0) {
        valid = false;
        break;
      }
    }
    if (!valid || !salt_matches(salts, hex + 64)) continue;
    for (size_t j = 0; j < 64; j++) key[j] = (char)tolower(hex[j]);
    key[64] = '\0';
    return true;
  }
  return false;
}

static bool image_header_matches(const uint8_t plain[16]) {
  return (plain[0] == 0xff && plain[1] == 0xd8 && plain[2] == 0xff) ||
         (memcmp(plain, "\x89PNG", 4) == 0) ||
         (memcmp(plain, "RIFF", 4) == 0) ||
         (memcmp(plain, "wxgf", 4) == 0) ||
         (memcmp(plain, "GIF", 3) == 0);
}

static bool verifies_image_key(const uint8_t key[16], const uint8_t ciphertext[16]) {
  uint8_t plain[32] = {0};
  size_t moved = 0;
  CCCryptorStatus status = CCCrypt(kCCDecrypt, kCCAlgorithmAES, kCCOptionECBMode,
                                   key, 16, NULL, ciphertext, 16,
                                   plain, sizeof(plain), &moved);
  return status == kCCSuccess && moved >= 16 && image_header_matches(plain);
}

static bool is_alnum_byte(uint8_t value) {
  return (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
         (value >= '0' && value <= '9');
}

static bool find_image_key(const uint8_t *data, size_t length,
                           const uint8_t ciphertext[16], uint8_t key[16]) {
  for (size_t i = 0; i + 34 <= length; i++) {
    if (is_alnum_byte(data[i])) continue;
    bool valid = true;
    for (size_t j = 1; j <= 32; j++) valid = valid && is_alnum_byte(data[i + j]);
    if (!valid || (i + 33 < length && is_alnum_byte(data[i + 33]))) continue;
    if (verifies_image_key(data + i + 1, ciphertext)) {
      memcpy(key, data + i + 1, 16);
      return true;
    }
  }

  for (size_t i = 0; i + 64 <= length; i++) {
    bool valid = true;
    for (size_t j = 0; j < 32; j++) {
      valid = valid && data[i + j * 2 + 1] == 0 && is_alnum_byte(data[i + j * 2]);
    }
    if (!valid) continue;
    uint8_t candidate[16];
    for (size_t j = 0; j < 16; j++) candidate[j] = data[i + j * 2];
    if (verifies_image_key(candidate, ciphertext)) {
      memcpy(key, candidate, 16);
      return true;
    }
  }

  for (size_t i = 0; i + 16 <= length; i++) {
    unsigned printable = 0;
    for (size_t j = 0; j < 16; j++) printable += data[i + j] >= 0x20 && data[i + j] <= 0x7e;
    if (printable < 14 || !verifies_image_key(data + i, ciphertext)) continue;
    memcpy(key, data + i, 16);
    return true;
  }
  return false;
}

static int scan_image_key(pid_t pid, const uint8_t ciphertext[16]) {
  mach_port_t task = MACH_PORT_NULL;
  kern_return_t attach = task_for_pid(mach_task_self(), pid, &task);
  if (attach != KERN_SUCCESS || task == MACH_PORT_NULL) {
    printf("{\"success\":false,\"attached\":false,\"attachCode\":%d}\n", attach);
    return 4;
  }

  uint8_t *chunk = malloc(CHUNK_SIZE + 65);
  if (!chunk) return 5;
  mach_vm_address_t address = 0;
  uint64_t bytes_read = 0, regions = 0;
  uint8_t key[16] = {0};
  while (address < 0x7fffffffffffULL) {
    mach_vm_size_t size = 0;
    vm_region_basic_info_data_64_t info = {0};
    mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
    mach_port_t object = MACH_PORT_NULL;
    kern_return_t kr = mach_vm_region(task, &address, &size, VM_REGION_BASIC_INFO_64,
                                      (vm_region_info_t)&info, &count, &object);
    if (kr != KERN_SUCCESS) break;
    if (object != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), object);
    mach_vm_address_t next = address + size;
    if ((info.protection & VM_PROT_READ) && (info.protection & VM_PROT_WRITE) &&
        size > 0 && size <= 50ull * 1024ull * 1024ull) {
      regions++;
      mach_vm_size_t offset = 0;
      size_t trailing = 0;
      while (offset < size) {
        mach_vm_size_t requested = size - offset > CHUNK_SIZE ? CHUNK_SIZE : size - offset;
        mach_vm_size_t actual = 0;
        kr = mach_vm_read_overwrite(task, address + offset, requested,
                                    (mach_vm_address_t)(chunk + trailing), &actual);
        offset += requested;
        if (kr != KERN_SUCCESS || actual == 0) { trailing = 0; continue; }
        bytes_read += actual;
        size_t searchable = trailing + (size_t)actual;
        if (find_image_key(chunk, searchable, ciphertext, key)) {
          printf("{\"success\":true,\"aesKeyHex\":\"");
          for (size_t i = 0; i < 16; i++) printf("%02x", key[i]);
          printf("\",\"attached\":true,\"regions\":%llu,\"bytes\":%llu}\n", regions, bytes_read);
          free(chunk);
          mach_port_deallocate(mach_task_self(), task);
          return 0;
        }
        trailing = searchable < 65 ? searchable : 65;
        memmove(chunk, chunk + searchable - trailing, trailing);
      }
    }
    if (next <= address) break;
    address = next;
  }
  printf("{\"success\":false,\"attached\":true,\"regions\":%llu,\"bytes\":%llu}\n", regions, bytes_read);
  free(chunk);
  mach_port_deallocate(mach_task_self(), task);
  return 6;
}

int main(int argc, char **argv) {
  if (argc == 4 && strcmp(argv[1], "--image") == 0) {
    uint8_t ciphertext[16];
    if (strlen(argv[3]) != 32) return 2;
    for (size_t i = 0; i < 16; i++) {
      int high = hex_value((uint8_t)argv[3][i * 2]);
      int low = hex_value((uint8_t)argv[3][i * 2 + 1]);
      if (high < 0 || low < 0) return 2;
      ciphertext[i] = (uint8_t)((high << 4) | low);
    }
    return scan_image_key((pid_t)strtol(argv[2], NULL, 10), ciphertext);
  }
  if (argc != 3) {
    fprintf(stderr, "usage: %s <pid> <db-root> | --image <pid> <ciphertext-hex>\n", argv[0]);
    return 2;
  }
  pid_t pid = (pid_t)strtol(argv[1], NULL, 10);
  SaltSet salts = {0};
  collect_salts(argv[2], &salts);
  if (pid <= 0 || salts.count == 0) {
    printf("{\"success\":false,\"attached\":false,\"saltCount\":%zu,\"regions\":0,\"bytes\":0}\n", salts.count);
    return 3;
  }

  mach_port_t task = MACH_PORT_NULL;
  kern_return_t attach = task_for_pid(mach_task_self(), pid, &task);
  if (attach != KERN_SUCCESS || task == MACH_PORT_NULL) {
    printf("{\"success\":false,\"attached\":false,\"saltCount\":%zu,\"regions\":0,\"bytes\":0,\"attachCode\":%d}\n", salts.count, attach);
    return 4;
  }

  uint8_t *chunk = malloc(CHUNK_SIZE + RECORD_SIZE - 1);
  if (!chunk) return 5;
  mach_vm_address_t address = 0;
  uint64_t bytes_read = 0;
  uint64_t regions = 0;
  char key[65] = {0};

  while (address < 0x7fffffffffffULL) {
    mach_vm_size_t size = 0;
    vm_region_basic_info_data_64_t info = {0};
    mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
    mach_port_t object = MACH_PORT_NULL;
    kern_return_t kr = mach_vm_region(task, &address, &size, VM_REGION_BASIC_INFO_64,
                                      (vm_region_info_t)&info, &count, &object);
    if (kr != KERN_SUCCESS) break;
    if (object != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), object);
    mach_vm_address_t next = address + size;

    if ((info.protection & VM_PROT_READ) && (info.protection & VM_PROT_WRITE) &&
        size > 0 && size <= MAX_REGION_SIZE) {
      regions++;
      mach_vm_size_t offset = 0;
      size_t trailing = 0;
      while (offset < size) {
        mach_vm_size_t requested = size - offset > CHUNK_SIZE ? CHUNK_SIZE : size - offset;
        mach_vm_size_t actual = 0;
        kr = mach_vm_read_overwrite(task, address + offset, requested,
                                    (mach_vm_address_t)(chunk + trailing), &actual);
        offset += requested;
        if (kr != KERN_SUCCESS || actual == 0) {
          trailing = 0;
          continue;
        }
        bytes_read += actual;
        size_t searchable = trailing + (size_t)actual;
        if (find_key(chunk, searchable, &salts, key)) {
          printf("{\"success\":true,\"key\":\"%s\",\"attached\":true,\"saltCount\":%zu,\"regions\":%llu,\"bytes\":%llu}\n",
                 key, salts.count, regions, bytes_read);
          free(chunk);
          mach_port_deallocate(mach_task_self(), task);
          return 0;
        }
        trailing = searchable < RECORD_SIZE - 1 ? searchable : RECORD_SIZE - 1;
        memmove(chunk, chunk + searchable - trailing, trailing);
      }
    }
    if (next <= address) break;
    address = next;
  }

  printf("{\"success\":false,\"attached\":true,\"saltCount\":%zu,\"regions\":%llu,\"bytes\":%llu}\n",
         salts.count, regions, bytes_read);
  free(chunk);
  mach_port_deallocate(mach_task_self(), task);
  return 6;
}
