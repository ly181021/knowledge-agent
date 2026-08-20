/**
 * StructureChunkService —— 结构切块（组合策略的结构主干）
 * 结构切块分支：
 * 1. HeadingDetector 逐行正则识别标题信号
 * 2. headingCount ≥ 2 → 按标题边界切章节块，维护栈式 headingPath
 * 3. 超长章节（> chunkSize）→ 内部 RecursiveCharacterTextSplitter 语义细分，子块继承 headingPath
 * 4. headingCount < 2 或任何异常 → 回退纯递归兜底
 * split(text, opts?) 支持按文档配置的 chunkSize/overlap（DocumentIndexConfig）
 * 三种格式共用：MD 带 #、DOCX 经 docxHtmlToMd 带 #、PDF/TXT 纯文本靠编号正则识别
 */
import { Injectable, Logger } from '@nestjs/common'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { HeadingDetector, type HeadingLine } from './heading-detector'
import { HeadingDisambiguator } from './heading-disambiguator'
import type { ChunkResult, SplitResult } from './chunk.service'

/** 默认单块最大字符（800） */
const DEFAULT_CHUNK_SIZE = 800
/** 默认块重叠字符（120） */
const DEFAULT_CHUNK_OVERLAP = 120
/** 触发结构切块的最小标题数 */
const MIN_HEADINGS_FOR_STRUCTURE = 2

/** 语义分隔符（+ 现有 chunk.service） */
const SEPARATORS = ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' ', '']

/** 切块参数（来自 DocumentIndexConfig） */
export interface ChunkOptions {
  chunkSize?: number
  overlap?: number
}

/** 章节段：标题行 + 该标题下正文 */
interface SectionSegment {
  /** 当前章节的标题路径（从根到当前层级） */
  headingPath: string[]
  /** 该章节的完整文本（含标题行 + 正文） */
  content: string
}

@Injectable()
export class StructureChunkService {
  private readonly logger = new Logger(StructureChunkService.name)

  // ：低置信标题 LLM 判歧（只对启发式 0.58 候选生效，正则/冒号不进；失败静默回退）
  constructor(private disambiguator: HeadingDisambiguator) {}

  /**
   * 结构切块入口
   * @param text 解析后的文本（MD 带 #，DOCX 转带 # 的 markdown，PDF/TXT 纯文本）
   * @param opts 按文档配置的切块参数（默认 800/120）
   * @returns SplitResult（chunks + headings； 透出 headings 供 consumer 构建结构节点）
   */
  async split(text: string, opts?: ChunkOptions): Promise<SplitResult> {
    const chunkSize = opts?.chunkSize ?? DEFAULT_CHUNK_SIZE
    const overlap = opts?.overlap ?? DEFAULT_CHUNK_OVERLAP
    try {
      const detected = HeadingDetector.detect(text)
      // ：低置信标题（启发式 0.58）交 LLM 判歧，剔除误判（失败静默回退，返回原数组）
      const headings = await this.disambiguator.disambiguate(detected, text.split('\n'))

      // 无标题或标题不足 → 回退纯递归（headings=undefined，consumer 跳过结构节点构建）
      if (headings.length < MIN_HEADINGS_FOR_STRUCTURE) {
        this.logger.debug(`structure-chunk: headings=${headings.length} < ${MIN_HEADINGS_FOR_STRUCTURE}, fallback to recursive`)
        const chunks = await this.recursiveSplit(text, chunkSize, overlap)
        return { chunks }
      }

      // 按标题切章节段
      const segments = this.splitByHeadings(text, headings)
      // 每段内部超长细分，组装最终 chunks
      const chunks: ChunkResult[] = []
      let index = 0
      for (const seg of segments) {
        const subChunks = await this.segmentToChunks(seg, chunkSize, overlap)
        for (const content of subChunks) {
          chunks.push({ index: index++, content, headingPath: seg.headingPath })
        }
      }

      this.logger.log(
        `structure-chunk: headings=${headings.length} segments=${segments.length} chunks=${chunks.length} (size=${chunkSize})`,
      )
      return { chunks, headings }
    } catch (e) {
      // 任何异常回退递归（不阻塞流水线）
      this.logger.warn(
        `structure-chunk failed, fallback to recursive: ${e instanceof Error ? e.message : String(e)}`,
      )
      const chunks = await this.recursiveSplit(text, chunkSize, overlap)
      return { chunks }
    }
  }

  /**
   * 按标题边界把文本切成章节段，维护栈式 headingPath
   */
  private splitByHeadings(text: string, headings: HeadingLine[]): SectionSegment[] {
    const lines = text.split('\n')
    const segments: SectionSegment[] = []

    // 标题栈：[{level, text}]，遇到 level N 压栈，弹出 level >= N 的同级
    const stack: { level: number; text: string }[] = []

    // 处理第一个标题前的正文（文档开头 → 第一个标题）
    if (headings.length > 0 && headings[0].lineNo > 0) {
      const preface = lines.slice(0, headings[0].lineNo).join('\n').trim()
      if (preface) {
        segments.push({ headingPath: ['（文档开头）'], content: preface })
      }
    }

    // 逐标题切段：每段 = 当前标题行 → 下一个标题行
    for (let i = 0; i < headings.length; i++) {
      const cur = headings[i]
      const next = headings[i + 1]
      const startLine = cur.lineNo
      const endLine = next ? next.lineNo : lines.length

      // 维护标题栈
      while (stack.length > 0 && stack[stack.length - 1].level >= cur.level) {
        stack.pop()
      }
      stack.push({ level: cur.level, text: cur.text })

      const sectionLines = lines.slice(startLine, endLine)
      const content = sectionLines.join('\n').trim()
      if (content) {
        segments.push({
          headingPath: stack.map((s) => s.text),
          content,
        })
      }
    }

    return segments
  }

  /**
   * 单个章节段 → chunks
   * 短段直接成一块；超长段用递归切分器细分，子块继承 headingPath
   */
  private async segmentToChunks(seg: SectionSegment, chunkSize: number, overlap: number): Promise<string[]> {
    if (seg.content.length <= chunkSize) {
      return [seg.content]
    }
    // 超长段语义细分（按文档配置的 chunkSize/overlap）
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap: overlap, separators: SEPARATORS })
    const sub = await splitter.splitText(seg.content)
    return sub.length > 0 ? sub : [seg.content]
  }

  /**
   * 纯递归兜底（无标题 / 异常时用），headingPath 为空
   */
  private async recursiveSplit(text: string, chunkSize: number, overlap: number): Promise<ChunkResult[]> {
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap: overlap, separators: SEPARATORS })
    const chunks = await splitter.splitText(text)
    return chunks.map((content, index) => ({ index, content }))
  }
}
