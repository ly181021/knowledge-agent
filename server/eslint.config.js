// eslint.config.js —— server（NestJS）ESLint 9 flat config
// 规则集：typescript-eslint recommended + jest（spec 文件）+ prettier（收尾关冲突）
const tseslint = require('typescript-eslint')
const jest = require('eslint-plugin-jest')
const prettier = require('eslint-config-prettier')

module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  tseslint.configs.recommended,
  {
    rules: {
      // _ 前缀 = 有意忽略的占位（解构剔除 passwordHash、接口未用参数等，社区约定）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Nest 项目日志走 pino Logger，禁止裸 console（存量已清零，防再引入）
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    plugins: { jest },
    ...jest.configs['flat/recommended'],
    languageOptions: {
      globals: jest.environments.globals.globals,
    },
  },
  prettier,
)
