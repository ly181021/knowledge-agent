// eslint.config.js —— web（Vue 3 + TS + Vite）ESLint 9 flat config（ESM）
// 规则集：eslint-plugin-vue flat/recommended + typescript-eslint recommended + prettier 收尾
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/auto-imports.d.ts', 'src/components.d.ts'] },
  ...pluginVue.configs['flat/recommended'],
  tseslint.configs.recommended,
  {
    // flat/recommended 的 files 只匹配顶层 '*.vue'，src/ 下的需显式指定 parser
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      // 单词组件名豁免（Chat.vue 等既有命名，改名成本高收益低）
      'vue/multi-word-component-names': 'off',
      // v-html 豁免：MessageBubble.vue 渲染前已 DOMPurify.sanitize（见该文件 html computed）
      'vue/no-v-html': 'off',
    },
  },
  prettier,
)
