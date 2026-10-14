/* SPDX-License-Identifier: MIT */
#include "codecHelper.h"
#include <errno.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

volatile sig_atomic_t codec_cancelled;

static void cancel_scan(int number) {
  (void)number;
  codec_cancelled = 1;
}

static CodecStatus acquire(int argc, char **argv, CodecScan *scan) {
  char *end = NULL;
  errno = 0;
  long pid = strtol(argv[1], &end, 10);
  if (errno || !end || *end || pid <= 0 || pid > INT_MAX) return CODEC_NOT_FOUND;
  scan->pid = (pid_t)pid;
  char core_path[PATH_MAX];
  if (argv[2][0] != '/' || !realpath(argv[2], core_path)) return CODEC_UNSUPPORTED_VERSION;
  CodecStatus status = codec_load_mask(core_path, scan);
  if (status != CODEC_OK) return status;
  if (kill(scan->pid, 0) != 0 && errno == ESRCH) return CODEC_PROCESS_EXITED;
  kern_return_t result = task_for_pid(mach_task_self(), scan->pid, &scan->task);
  if (result != KERN_SUCCESS || scan->task == MACH_PORT_NULL) {
    return kill(scan->pid, 0) != 0 && errno == ESRCH
        ? CODEC_PROCESS_EXITED : CODEC_NEEDS_AUTHORIZATION;
  }
  status = codec_resolve_core(core_path, scan);
  if (status != CODEC_OK) return status;
  for (int i = 3; i < argc && !codec_cancelled; ++i) {
    if (argv[i][0] != '/') continue;
    CodecDatabase *database = &scan->databases[scan->database_count];
    if (codec_load_database(argv[i], (unsigned)(i - 3), database)) ++scan->database_count;
  }
  if (codec_cancelled || codec_seconds() >= scan->deadline) return CODEC_TIMEOUT;
  if (!scan->database_count) return CODEC_NOT_FOUND;
  status = codec_scan_memory(scan);
  return status == CODEC_NOT_FOUND && scan->matched_count ? CODEC_OK : status;
}

int main(int argc, char **argv) {
  /* Credentials are exclusively a private pipe payload, never terminal diagnostics. */
  if (isatty(STDOUT_FILENO)) return 3;
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = cancel_scan;
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGINT, &action, NULL);
  signal(SIGPIPE, SIG_IGN);
  CodecScan *scan = calloc(1, sizeof(*scan));
  if (!scan) return codec_emit(CODEC_NOT_FOUND, NULL);
  scan->owner_pid = getppid();
  scan->deadline = codec_seconds() + CODEC_SCAN_SECONDS;
  CodecStatus status = argc >= 4 && argc <= CODEC_MAX_DATABASES + 3
      ? acquire(argc, argv, scan) : CODEC_NOT_FOUND;
  if (codec_cancelled) {
    codec_wipe(scan->databases, sizeof(scan->databases));
    scan->database_count = 0;
    status = CODEC_TIMEOUT;
  }
  int exit_code = codec_emit(status, status == CODEC_OK ? scan : NULL);
  if (scan->task != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), scan->task);
  codec_wipe(scan, sizeof(*scan));
  free(scan);
  return exit_code;
}
