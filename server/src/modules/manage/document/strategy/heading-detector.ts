/**
 * HeadingDetector —— 标题信号识别器
 * 不读 PDF 字体/书签，对解析后的纯文本逐行正则识别标题，三种格式（MD/DOCX/PDF）共用
 * 识别的标题模式（按优先级）：
 * 1. Markdown #/##/###（level = # 个数）
 * 2. 多级数字编号 1.2.3（level = 点数）
 * 3. 单级数字 1、/1.（level=1）
 * 4. 中文 第N章/节/条（level=1）
 * 5. 附录（level=1）
 * 6. 中文大纲 一、二、（level=1）
 * 辅助规则：未命中正则但行≤32字 + 孤立 + 下行像正文 + 不含标点 → 低置信标题，
 * 仅在正则命中 < 2 时启用，避免过度识别
 */

/** 识别出的标题行 */
export interface HeadingLine {
  /** 在原文按行拆分后的 0-based 行号 */
  lineNo: number
  /** 标题层级（1=一级，2=二级...） */
  level: number
  /** 标题文本（已去编号前缀，如 安装要求） */
  text: string
  /** 命中的模式名（调试用） */
  pattern: string
  /** 置信度：正则命中=1.0，启发式=0.58 */
  confidence: number
}

// 各标题模式（正则）
interface HeadingPattern {
  name: string
  regex: RegExp
  /** 从匹配结果算出 level 和 text */
  extract: (m: RegExpMatchArray) => { level: number; text: string }
}

const PATTERNS: HeadingPattern[] = [
  {
    // Markdown #/##/###（level = # 个数）
    name: 'markdown',
    regex: /^(#{1,6})\s+(.+)$/,
    extract: (m) => ({ level: m[1].length, text: m[2].trim() }),
  },
  {
    // 多级数字 1.2.3（level = 点数+1，如 1.2 → level 2）
    name: 'numeric-multi',
    regex: /^(\d+(?:\.\d+)+)\s*[、.]?\s*(.+)$/,
    extract: (m) => ({ level: m[1].split('.').length, text: m[2].trim() }),
  },
  {
    // 单级数字 1、/1.（level=1）
    name: 'numeric-single',
    regex: /^(\d+)\s*[、.]\s*(.+)$/,
    extract: (m) => ({ level: 1, text: m[2].trim() }),
  },
  {
    // 中文 第N章/节/条（level=1，N 为中文数字或阿拉伯数字）
    name: 'chinese-chapter',
    regex: /^(第[一二三四五六七八九十百零\d]+[章节条部分])\s*(.*)$/,
    extract: (m) => ({ level: 1, text: `${m[1]} ${m[2]}`.trim() }),
  },
  {
    // 附录
    name: 'appendix',
    regex: /^(附录\s*[A-Za-z0-9]+)\s*(.*)$/,
    extract: (m) => ({ level: 1, text: m[1].trim() }),
  },
  {
    // 中文大纲 一、二、（level=1）
    name: 'chinese-outline',
    regex: /^([一二三四五六七八九十百]+)[、.]\s*(.+)$/,
    extract: (m) => ({ level: 1, text: m[2].trim() }),
  },
]

/** 启发式标题最大长度（32） */
const MAX_PLAIN_HEADING_CHARS = 32
/** 启发式标题置信度（纯启发式，进 LLM 判歧） */
const PLAIN_HEADING_CONFIDENCE = 0.58
/** 上行冒号特征置信度（较可信但不绝对，不进判歧——直接接受） */
const COLON_HEADING_CONFIDENCE = 0.7

/**
 * 检查一行是否像普通标题（启发式）
 * 条件：行≤32字 + 不含句号/逗号/问号 + 不是列表项
 */
function looksLikePlainHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > MAX_PLAIN_HEADING_CHARS) return false
  // 含句号、逗号、问号、分号的行不像标题（更像正文）
  if (/[。，？！；,?!;]/.test(trimmed)) return false
  // 列表项（-/*开头或数字编号开头）不算（列表由其他逻辑处理）
  if (/^[-*•]\s/.test(trimmed)) return false
  return true
}

export class HeadingDetector {
  /**
   * 对文本逐行识别标题
   * @param text 解析后的纯文本（MD 带 #，DOCX 转带 # 的 markdown 风格，PDF 纯文本）
   * @returns HeadingLine[]（按出现顺序）
   */
  static detect(text: string): HeadingLine[] {
    const lines = text.split('\n')
    const results: HeadingLine[] = []

    // 第一轮：正则识别（高置信）
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      for (const p of PATTERNS) {
        const m = line.match(p.regex)
        if (m) {
          const { level, text: headingText } = p.extract(m)
          results.push({
            lineNo: i,
            level,
            text: headingText,
            pattern: p.name,
            confidence: 1.0,
          })
          break // 一行只匹配第一个命中的模式
        }
      }
    }

    // 正则命中数 ≥ 2，直接返回（不需要启发式）
    if (results.length >= 2) return results

    // 第二轮：启发式低置信标题（仅在正则命中不足时补位）
    // 统计每行出现次数：重复出现的行（正文重复句）不应当标题
    const lineCount = new Map<string, number>()
    for (const l of lines) {
      const t = l.trim()
      if (t) lineCount.set(t, (lineCount.get(t) ?? 0) + 1)
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      // 跳过已识别为正则标题的行
      if (results.some((r) => r.lineNo === i)) continue
      // 频次 >= 3 才判页眉页脚噪声（正文重复句不等于页眉页脚）
      if ((lineCount.get(line) ?? 0) >= 3) continue

      const prevEmpty = i === 0 || !lines[i - 1].trim()
      const nextEmpty = i === lines.length - 1 || !lines[i + 1].trim()
      // 上行冒号特征：冒号行是标签而非标题，但下行若是短孤立行则大概率是标题的内容部分，
      // 如 第一章： 加 总则；而 摘要： 加 正文 是误报场景，所以 0.7 标记为较可信但不绝对
      // 分档意义：0.7 直接接受不进 LLM 判歧，0.58 纯启发式才判歧
      // 冒号判定必须在孤立检查之前：冒号标签行（如 第一章：）是非空行，
      // 先做孤立检查会被 prevEmpty=false 挡掉，冒号特征恒为 false（死代码），故冒号标签行放行孤立检查
      const prevEndsWithColon = i > 0 && /[：:]$/.test(lines[i - 1].trim())
      // 孤立项：前后有空行（或文档首末）；上行是冒号标签行时放行（冒号场景上行必非空）
      if ((!prevEmpty && !prevEndsWithColon) || !nextEmpty) continue

      if (looksLikePlainHeading(line)) {
        results.push({
          lineNo: i,
          level: 1,
          text: line,
          pattern: prevEndsWithColon ? 'plain-heading-colon' : 'plain-heading',
          confidence: prevEndsWithColon ? COLON_HEADING_CONFIDENCE : PLAIN_HEADING_CONFIDENCE,
        })
      }
    }

    return results
  }
}
