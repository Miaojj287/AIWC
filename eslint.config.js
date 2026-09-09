// @ts-check
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'

/**
 * Dependency rules (see docs/ARCHITECTURE.md §3):
 *   protocol  → (nothing internal)
 *   kernel    → protocol
 *   substrate → protocol
 *   gateway   → protocol
 *   memory    → protocol
 *   electron  → everything (composition root)
 *   renderer  → protocol only (talks to main over IPC)
 */
export default tseslint.config(
  { ignores: ['dist/**', 'dist-web/**', 'dist-electron/**', 'release/**', 'node_modules/**', 'Example/**', 'docs/**', '.tmp*', 'scripts/**', '**/*.cjs'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'protocol', pattern: 'packages/protocol/**', mode: 'full' },
        { type: 'kernel', pattern: 'packages/kernel/**', mode: 'full' },
        { type: 'substrate', pattern: 'packages/substrate/**', mode: 'full' },
        { type: 'gateway', pattern: 'packages/gateway/**', mode: 'full' },
        { type: 'memory', pattern: 'packages/memory/**', mode: 'full' },
        { type: 'electron', pattern: 'electron/**', mode: 'full' },
        { type: 'renderer', pattern: 'src/**', mode: 'full' },
        { type: 'dev', pattern: 'dev/**', mode: 'full' },
      ],
      'boundaries/ignore': ['**/*.test.ts', '**/*.test.tsx'],
      'import/resolver': { typescript: {} },
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'protocol', allow: ['protocol'] },
            { from: 'kernel', allow: ['kernel', 'protocol'] },
            { from: 'substrate', allow: ['substrate', 'protocol'] },
            { from: 'gateway', allow: ['gateway', 'protocol'] },
            { from: 'memory', allow: ['memory', 'protocol'] },
            { from: 'electron', allow: ['electron', 'protocol', 'kernel', 'substrate', 'gateway', 'memory'] },
            { from: 'renderer', allow: ['renderer', 'protocol'] },
            { from: 'dev', allow: ['dev', 'protocol', 'kernel', 'substrate', 'gateway', 'memory'] },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
