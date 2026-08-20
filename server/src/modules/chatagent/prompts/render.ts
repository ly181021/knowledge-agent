/**
 * PromptRenderer —— 读取 prompt 模板文件，替换占位符
 * prompts/ + renderPrompt
 * 注意：.md 模板文件不被 nest build 编译到 dist，需从源码目录读
 */
import { readFileSync } from 'fs'
import { join } from 'path'

// nest build 只编译 .ts 到 dist，.md 文件不会复制，所以从 src 目录读
// dist 里 render.js 在 dist/src/modules/chatagent/prompts/，往上 5 层回 server/ 根
const PROMPTS_DIR = join(__dirname, '..', '..', '..', '..', '..', 'src', 'modules', 'chatagent', 'prompts')

const cache = new Map<string, string>()

function loadTemplate(name: string): string {
  if (cache.has(name)) return cache.get(name)!
  const filePath = join(PROMPTS_DIR, `${name}.md`)
  const content = readFileSync(filePath, 'utf8')
  cache.set(name, content)
  return content
}

/**
 * 渲染 prompt 模板，替换 {key} 占位符
 */
export function renderPrompt(name: string, vars: Record<string, string>): string {
  let tpl = loadTemplate(name)
  for (const [key, value] of Object.entries(vars)) {
    tpl = tpl.replaceAll(`{${key}}`, value)
  }
  return tpl
}
