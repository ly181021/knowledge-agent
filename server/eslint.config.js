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
  {
    // CLI 脚本（demo:seed / demo:eval）无 HTTP 出口，console 是与使用者唯一的交互面
    // 模式必须带 **/ 前缀：lint-staged 以绝对路径调 eslint，files 匹配相对于 cwd（仓库根）而非本文件位置
    files: ['**/src/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
)
