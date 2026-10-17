import { createRequire } from 'node:module'

const requireNative = createRequire(import.meta.url)

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- koffi's untyped FFI boundary is confined here.
type KernelFunction = (...args: any[]) => any

/** Read-only Win32 memory access shared by the database and image scanners. */
export interface Kernel32 {
  virtualQueryEx: KernelFunction
  readProcessMemory: KernelFunction
}

/** Resource acquisition and release for a read-only process handle. */
export interface Kernel32Api extends Kernel32 {
  openProcess: KernelFunction
  closeHandle: KernelFunction
}

/** Load native access lazily in the utility process; importing this module has no native effects. */
export function loadKernel32(): Kernel32Api | null {
  try {
    const library = requireNative('koffi').load('kernel32.dll')
    return {
      openProcess: library.func('uintptr_t OpenProcess(uint32_t desiredAccess, int inheritHandle, uint32_t processId)'),
      virtualQueryEx: library.func(
        'size_t VirtualQueryEx(uintptr_t process, uintptr_t address, _Out_ uint8_t *info, size_t length)',
      ),
      readProcessMemory: library.func(
        'int ReadProcessMemory(uintptr_t process, uintptr_t address, _Out_ uint8_t *buffer, size_t size, _Out_ size_t *bytesRead)',
      ),
      closeHandle: library.func('int CloseHandle(uintptr_t handle)'),
    }
  } catch {
    // Native access is optional; callers report an unavailable scanner instead of loading on import.
    return null
  }
}
