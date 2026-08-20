/**
 * docxHtmlToMd —— 把 mammoth convertToHtml 的输出转成带 # 标题的 Markdown 风格文本
 * 背景：mammoth 内置把 Word 标题样式（Heading 1-6）映射成 <h1>~<h6>，
 * 而Tika 对 DOCX 只抽纯文本丢样式。我们用 convertToHtml 提取 Word heading 样式，
 * 再转成 Markdown # 标记，让 HeadingDetector 能识别 DOCX 的章节结构。
 * 只处理语义标签（h/p/li/strong/em），去样式标签留文本。不引入 HTML 解析库，用正则足够。
 */

/**
 * 把 mammoth 输出的 HTML 转成带 # 标题的 Markdown 文本
 * @param html mammoth convertToHtml 的 result.value
 * @returns 带 #/## 标题的 Markdown 风格纯文本
 */
export function docxHtmlToMd(html: string): string {
  let s = html

  // 1. 标题 h1~h6 → # ~ ######
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n\n# ${stripTags(c)}\n\n`)
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n\n## ${stripTags(c)}\n\n`)
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n\n### ${stripTags(c)}\n\n`)
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n\n#### ${stripTags(c)}\n\n`)
  s = s.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `\n\n##### ${stripTags(c)}\n\n`)
  s = s.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `\n\n###### ${stripTags(c)}\n\n`)

  // 2. 列表项 li → - item（ul 下的）
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `\n- ${stripTags(c).trim()}`)

  // 3. 段落 p → 段落分隔
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `\n\n${stripTags(c)}\n\n`)

  // 4. 换行 br → 换行
  s = s.replace(/<br\s*\/?>/gi, '\n')

  // 5. 去掉所有剩余标签（strong/em/span/div/ul/ol 等留文本）
  s = stripTags(s)

  // 6. 清理：压缩 3+ 连续换行为 2 个，trim
  s = s.replace(/\n{3,}/g, '\n\n').trim()

  return s
}

/** 去掉所有 HTML 标签，只留文本内容（处理实体后） */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
