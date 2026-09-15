// @ts-check
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Dependency rules (docs/ARCHITECTURE.md §2, AGENTS.md §3):
 *   protocol                                    → nothing internal
 *   kernel · substrate · gateway · memory · i18n · shell → protocol
 *   office                                      → protocol, shell (process runner)
 *   electron                                    → everything (composition root)
 *   renderer (src/)                             → protocol, i18n — data only through window.aiwc
 *   dev (fixtures, previews)                    → anything; production code never imports dev
 */
/**
 * aiwc/no-hardcoded-cjk — UI copy must come from the @aiwc/i18n catalogs (CLAUDE.md §11). Flags any
 * string literal, template chunk or JSX text containing CJK ideographs in renderer / main code.
 * Legitimate exceptions (model prompts, WeChat data tables) disable the rule inline WITH a reason:
 *   // eslint-disable-next-line aiwc/no-hardcoded-cjk -- 模型提示词，不是界面文案
 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** @type {import('eslint').Rule.RuleModule} */
const noHardcodedCjk = {
  meta: {
    type: 'problem',
    docs: { description: 'UI copy must be resolved through @aiwc/i18n (zh-CN + en-US), never hard-coded' },
    schema: [],
    messages: {
      cjk: 'Hard-coded Chinese copy "{{text}}": add the key to packages/i18n/src/locales/{zh-CN,en-US} and use t(). Prompts / data tables: disable inline with a reason.',
    },
  },
  create(context) {
    const report = (node, text) => context.report({ node, messageId: 'cjk', data: { text: text.trim().slice(0, 24) } })
    return {
      Literal(node) {
        if (typeof node.value === 'string' && CJK.test(node.value)) report(node, node.value)
      },
      TemplateElement(node) {
        if (CJK.test(node.value.raw)) report(node, node.value.raw)
      },
      JSXText(node) {
        if (CJK.test(node.value)) report(node, node.value)
      },
    }
  },
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-web/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      'Example/**',
      'docs/**',
      '.tmp*',
      '.cache/**',
      'coverage/**',
      'scripts/**',
      '**/*.cjs',
    ],
  },
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
        { type: 'i18n', pattern: 'packages/i18n/**', mode: 'full' },
        { type: 'office', pattern: 'packages/office/**', mode: 'full' },
        { type: 'shell', pattern: 'packages/shell/**', mode: 'full' },
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
            { from: 'i18n', allow: ['i18n', 'protocol'] },
            { from: 'shell', allow: ['shell', 'protocol'] },
            { from: 'office', allow: ['office', 'protocol', 'shell'] },
            {
              from: 'electron',
              allow: ['electron', 'protocol', 'kernel', 'substrate', 'gateway', 'memory', 'i18n', 'office', 'shell'],
            },
            { from: 'renderer', allow: ['renderer', 'protocol', 'i18n'] },
            {
              from: 'dev',
              allow: ['dev', 'protocol', 'kernel', 'substrate', 'gateway', 'memory', 'i18n', 'office', 'renderer'],
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aiwc/*/*'],
              message:
                'Import a package only through its entry point (@aiwc/<pkg>); export what you need from its index.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // Renderer + main process: every user-facing string goes through @aiwc/i18n. Tests, demo fixtures,
    // the dev-only kit gallery and prompt builders are data, not UI copy.
    files: ['src/**/*.ts', 'src/**/*.tsx', 'electron/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'src/platform/mock/**',
      'src/features/kit/**',
      'electron/main/prompts/**',
      'electron/main/services/autoReplyGenerate.ts',
      'electron/main/services/replyStyle.ts',
    ],
    plugins: { aiwc: { rules: { 'no-hardcoded-cjk': noHardcodedCjk } } },
    rules: { 'aiwc/no-hardcoded-cjk': 'error' },
  },
  {
    // Type-aware correctness rules for shipped code (AGENTS.md §2). Tests keep the syntactic set so fakes stay terse.
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts', 'packages/*/src/**/*.ts', 'dev/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      // Hard ceiling; the working limit is 400 (AGENTS.md §2.3). Split by responsibility, never by line count alone.
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'dev/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    // The kit is used only through its barrel (src/kit/index.ts, AGENTS.md §3.7). ESLint replaces rule options per
    // block instead of merging them, so the package entry-point pattern from the shared block is repeated here.
    files: ['src/**/*.{ts,tsx}', 'dev/**/*.{ts,tsx}'],
    ignores: ['src/kit/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aiwc/*/*'],
              message:
                'Import a package only through its entry point (@aiwc/<pkg>); export what you need from its index.ts.',
            },
            {
              group: ['@/kit/*'],
              message: 'Import kit components from @/kit; export what you need from src/kit/index.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    rules: { 'no-console': 'error', eqeqeq: ['error', 'smart'], 'prefer-const': 'error', 'no-var': 'error' },
  },
  {
    // Where the console is the intended output: the main-process log sink, dev CLIs and previews, tests, the browser mock bridge.
    files: ['electron/main/log.ts', 'dev/**', '**/*.test.ts', '**/*.test.tsx', 'src/platform/mock/**'],
    rules: { 'no-console': 'off' },
  },
)
