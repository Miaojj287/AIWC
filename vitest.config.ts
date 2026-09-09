import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

const alias = {
  '@aiwc/protocol': here('./packages/protocol/src/index.ts'),
  '@aiwc/kernel': here('./packages/kernel/src/index.ts'),
  '@aiwc/substrate': here('./packages/substrate/src/index.ts'),
  '@aiwc/gateway': here('./packages/gateway/src/index.ts'),
  '@aiwc/memory': here('./packages/memory/src/index.ts'),
  '@': here('./src'),
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    testTimeout: 15000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/**/*.test.ts', 'electron/**/*.test.ts', 'dev/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
