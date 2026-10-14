/* SPDX-License-Identifier: MIT */
#include <unistd.h>

int main(void) {
  if (isatty(STDOUT_FILENO)) return 3;
  static const char result[] = "{\"version\":1,\"status\":\"unsupported_version\",\"entries\":[]}\n";
  return write(STDOUT_FILENO, result, sizeof(result) - 1) == sizeof(result) - 1 ? 0 : 1;
}
