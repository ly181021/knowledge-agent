// lint-staged 根配置 —— pre-commit 只处理暂存文件
// ESLint 9 的 config 查找基于 cwd（git 根无 eslint.config.js），故用 --config 显式指定子项目配置；
// eslint/prettier 二进制在根 node_modules，config 文件内的插件 require 从各自子项目 node_modules 解析
module.exports = {
  'server/**/*.ts': (files) => `eslint --config server/eslint.config.js --fix ${files.join(' ')}`,
  'web/**/*.{ts,vue}': (files) => `eslint --config web/eslint.config.js --fix ${files.join(' ')}`,
  'web/**/*.{css,json}': ['prettier --write'],
}
