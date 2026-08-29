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
#include <CommonCrypto/CommonKeyDerivation.h>
#include <dispatch/dispatch.h>
#include <pthread.h>

#define MAX_SALTS 1000
#define MAX_DB_PAGES 1000
#define MAX_RAW_CANDIDATES 4096
#define RECORD_SIZE 99
#define DB_PAGE_SIZE 4096
#define RAW_KEY_SIZE 32
#define CHUNK_SIZE (2u * 1024u * 1024u)
#define MAX_REGION_SIZE (512ull * 1024ull * 1024ull)

typedef struct {
  uint8_t values[MAX_SALTS][16];
  size_t count;
} SaltSet;

typedef struct {
  uint8_t values[MAX_DB_PAGES][DB_PAGE_SIZE];
  size_t count;
} DbPageSet;

typedef struct {
  uint8_t values[MAX_RAW_CANDIDATES][RAW_KEY_SIZE];
  size_t count;
} RawKeySet;

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

static void collect_databases(const char *root, SaltSet *salts, DbPageSet *pages) {
  char *paths[] = {(char *)root, NULL};
  FTS *tree = fts_open(paths, FTS_PHYSICAL | FTS_NOCHDIR, NULL);
  if (!tree) return;
  FTSENT *entry;
  while (salts->count < MAX_SALTS && (entry = fts_read(tree)) != NULL) {
    if (entry->fts_info != FTS_F || !ends_with_db(entry->fts_path)) continue;
    int fd = open(entry->fts_path, O_RDONLY);
    if (fd < 0) continue;
    uint8_t page[DB_PAGE_SIZE];
    ssize_t actual = pread(fd, page, sizeof(page), 0);
    close(fd);
    if (actual < 16) continue;
    if (memcmp(page, "SQLite format 3", 15) == 0) continue;
    add_salt(salts, page);
    if (actual == (ssize_t)sizeof(page) && pages->count < MAX_DB_PAGES) {
      memcpy(pages->values[pages->count++], page, sizeof(page));
    }
  }
  fts_close(tree);
}

static bool is_uuid_v4_at(const uint8_t *data, size_t offset, size_t length) {
  return offset + 16 <= length &&
         (data[offset + 6] & 0xf0) == 0x40 &&
         (data[offset + 8] & 0xc0) == 0x80;
}

static void add_raw_key(RawKeySet *keys, const uint8_t value[RAW_KEY_SIZE]) {
  for (size_t i = 0; i < keys->count; i++) {
    if (memcmp(keys->values[i], value, RAW_KEY_SIZE) == 0) return;
  }
  if (keys->count >= MAX_RAW_CANDIDATES) return;
  memcpy(keys->values[keys->count++], value, RAW_KEY_SIZE);
}

static void collect_raw_v4_keys(const uint8_t *data, size_t length,
                                mach_vm_address_t base_address, RawKeySet *keys) {
  size_t offset = (size_t)((8 - (base_address & 7)) & 7);
  for (; offset + RAW_KEY_SIZE <= length; offset += 8) {
    if (is_uuid_v4_at(data, offset, length) &&
        is_uuid_v4_at(data, offset + 16, length)) {
      add_raw_key(keys, data + offset);
    }
  }
}

static void collect_raw_v4_keys_unaligned(const uint8_t *data, size_t length,
                                          RawKeySet *keys) {
  for (size_t offset = 0; offset + RAW_KEY_SIZE <= length; offset++) {
    if (is_uuid_v4_at(data, offset, length) &&
        is_uuid_v4_at(data, offset + 16, length)) {
      add_raw_key(keys, data + offset);
    }
  }
}

static bool verifies_raw_v4_key(const uint8_t key[RAW_KEY_SIZE],
                                const uint8_t page[DB_PAGE_SIZE]) {
  uint8_t derived[RAW_KEY_SIZE];
  int kdf = CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)key, RAW_KEY_SIZE,
                                 page, 16, kCCPRFHmacAlgSHA512, 256000,
                                 derived, sizeof(derived));
  if (kdf != kCCSuccess) return false;

  uint8_t plain[4000];
  size_t moved = 0;
  CCCryptorStatus status = CCCrypt(kCCDecrypt, kCCAlgorithmAES, 0,
                                   derived, sizeof(derived), page + 4016,
                                   page + 16, sizeof(plain),
                                   plain, sizeof(plain), &moved);
  if (status != kCCSuccess || moved != sizeof(plain)) return false;
  return plain[0] == 0x10 && plain[1] == 0x00 &&
         (plain[2] == 1 || plain[2] == 2) &&
         (plain[3] == 1 || plain[3] == 2) &&
         plain[4] == 0x50 && plain[5] == 0x40 &&
         plain[6] == 0x20 && plain[7] == 0x20;
}

static bool find_verified_raw_v4_key(const RawKeySet *keys, const DbPageSet *pages,
                                     uint8_t key[RAW_KEY_SIZE]) {
  if (keys->count == 0 || pages->count == 0) return false;
  __block ssize_t matched = -1;
  __block pthread_mutex_t matched_lock = PTHREAD_MUTEX_INITIALIZER;
  dispatch_queue_t queue = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
  dispatch_apply(keys->count, queue, ^(size_t i) {
    pthread_mutex_lock(&matched_lock);
    bool already_matched = matched >= 0;
    pthread_mutex_unlock(&matched_lock);
    if (already_matched) return;
    for (size_t j = 0; j < pages->count; j++) {
      if (!verifies_raw_v4_key(keys->values[i], pages->values[j])) continue;
      pthread_mutex_lock(&matched_lock);
      if (matched < 0) matched = (ssize_t)i;
      pthread_mutex_unlock(&matched_lock);
      return;
    }
  });
  pthread_mutex_destroy(&matched_lock);
  if (matched >= 0) {
    memcpy(key, keys->values[matched], RAW_KEY_SIZE);
    return true;
  }
  return false;
}

static bool scan_dump_file(const char *path, const DbPageSet *pages,
                           uint8_t key[RAW_KEY_SIZE], size_t *candidate_count,
                           uint64_t *bytes_read) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return false;
  uint8_t *chunk = malloc(CHUNK_SIZE + RAW_KEY_SIZE - 1);
  if (!chunk) {
    close(fd);
    return false;
  }
  RawKeySet keys = {0};
  size_t trailing = 0;
  while (true) {
    ssize_t actual = read(fd, chunk + trailing, CHUNK_SIZE);
    if (actual <= 0) break;
    *bytes_read += (uint64_t)actual;
    size_t searchable = trailing + (size_t)actual;
    collect_raw_v4_keys_unaligned(chunk, searchable, &keys);
    trailing = searchable < RAW_KEY_SIZE - 1 ? searchable : RAW_KEY_SIZE - 1;
    memmove(chunk, chunk + searchable - trailing, trailing);
  }
  close(fd);
  free(chunk);
  *candidate_count += keys.count;
  return find_verified_raw_v4_key(&keys, pages, key);
}

static bool scan_dump_path(const char *root, const DbPageSet *pages,
                           uint8_t key[RAW_KEY_SIZE], size_t *candidate_count,
                           uint64_t *bytes_read, size_t *file_count) {
  struct stat info;
  if (stat(root, &info) != 0) return false;
  if (S_ISREG(info.st_mode)) {
    *file_count = 1;
    return scan_dump_file(root, pages, key, candidate_count, bytes_read);
  }
  if (!S_ISDIR(info.st_mode)) return false;

  char *paths[] = {(char *)root, NULL};
  FTS *tree = fts_open(paths, FTS_PHYSICAL | FTS_NOCHDIR, NULL);
  if (!tree) return false;
  bool matched = false;
  FTSENT *entry;
  while (!matched && (entry = fts_read(tree)) != NULL) {
    if (entry->fts_info != FTS_F) continue;
    size_t length = strlen(entry->fts_name);
    if (length < 4 || strcasecmp(entry->fts_name + length - 4, ".dmp") != 0) continue;
    (*file_count)++;
    matched = scan_dump_file(entry->fts_path, pages, key, candidate_count, bytes_read);
  }
  fts_close(tree);
  return matched;
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
  if (argc == 4 && strcmp(argv[1], "--dump") == 0) {
    SaltSet salts = {0};
    DbPageSet pages = {0};
    collect_databases(argv[3], &salts, &pages);
    uint8_t key[RAW_KEY_SIZE] = {0};
    size_t candidates = 0, files = 0;
    uint64_t bytes_read = 0;
    bool matched = pages.count > 0 &&
                   scan_dump_path(argv[2], &pages, key, &candidates, &bytes_read, &files);
    if (matched) {
      printf("{\"success\":true,\"key\":\"");
      for (size_t i = 0; i < RAW_KEY_SIZE; i++) printf("%02x", key[i]);
      printf("\",\"source\":\"wechat-crash-dump\",\"attached\":false,\"saltCount\":%zu,\"dumpFiles\":%zu,\"bytes\":%llu,\"rawCandidates\":%zu}\n",
             salts.count, files, bytes_read, candidates);
      return 0;
    }
    printf("{\"success\":false,\"source\":\"wechat-crash-dump\",\"attached\":false,\"saltCount\":%zu,\"dumpFiles\":%zu,\"bytes\":%llu,\"rawCandidates\":%zu}\n",
           salts.count, files, bytes_read, candidates);
    return 6;
  }
  if (argc != 3) {
    fprintf(stderr, "usage: %s <pid> <db-root> | --dump <dump-path> <db-root> | --image <pid> <ciphertext-hex>\n", argv[0]);
    return 2;
  }
  pid_t pid = (pid_t)strtol(argv[1], NULL, 10);
  SaltSet salts = {0};
  DbPageSet pages = {0};
  collect_databases(argv[2], &salts, &pages);
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
  size_t raw_candidate_count = 0;

  while (address < 0x7fffffffffffULL) {
    mach_vm_size_t size = 0;
    vm_region_extended_info_data_t info = {0};
    mach_msg_type_number_t count = VM_REGION_EXTENDED_INFO_COUNT;
    mach_port_t object = MACH_PORT_NULL;
    kern_return_t kr = mach_vm_region(task, &address, &size, VM_REGION_EXTENDED_INFO,
                                      (vm_region_info_t)&info, &count, &object);
    if (kr != KERN_SUCCESS) break;
    if (object != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), object);
    mach_vm_address_t next = address + size;

    // SQLCipher/WCDB key buffers live in anonymous writable allocations. File-
    // backed mappings contain thousands of unrelated UUID pairs and used to
    // fill the global candidate pool before the real key was reached.
    if ((info.protection & VM_PROT_READ) && (info.protection & VM_PROT_WRITE) &&
        info.external_pager == 0 && size > 0 && size <= MAX_REGION_SIZE) {
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
        mach_vm_address_t searchable_address = address + offset - requested - trailing;
        RawKeySet chunk_keys = {0};
        collect_raw_v4_keys(chunk, searchable, searchable_address, &chunk_keys);
        raw_candidate_count += chunk_keys.count;
        uint8_t raw_key[RAW_KEY_SIZE];
        if (find_verified_raw_v4_key(&chunk_keys, &pages, raw_key)) {
          printf("{\"success\":true,\"key\":\"");
          for (size_t i = 0; i < RAW_KEY_SIZE; i++) printf("%02x", raw_key[i]);
          printf("\",\"attached\":true,\"saltCount\":%zu,\"regions\":%llu,\"bytes\":%llu,\"rawCandidates\":%zu}\n",
                 salts.count, regions, bytes_read, raw_candidate_count);
          free(chunk);
          mach_port_deallocate(mach_task_self(), task);
          return 0;
        }
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
  printf("{\"success\":false,\"attached\":true,\"saltCount\":%zu,\"regions\":%llu,\"bytes\":%llu,\"rawCandidates\":%zu}\n",
         salts.count, regions, bytes_read, raw_candidate_count);
  free(chunk);
  mach_port_deallocate(mach_task_self(), task);
  return 6;
}
