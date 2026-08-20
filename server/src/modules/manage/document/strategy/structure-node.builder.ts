/**
 * structure-node.builder.ts —— 从标题信号构建结构节点树
 * 复用 StructureChunkService.splitByHeadings 的栈式算法（structure-chunk.service.ts），
 * 把 HeadingLine[] 转成结构节点（含 parentId / canonicalPath / 正文切片）。
 * 一轮遍历：push 时预生成 uuid，parentId 从栈取（栈顶下一层即父节点）。
 * 不做兄弟链/重复合并（无 ES/图投影需求）。
 */
import { randomUUID } from 'crypto'
import type { HeadingLine } from './heading-detector'

/** 结构节点数据（落库前的内存结构，consumer 负责先删后插） */
export interface StructureNodeData {
  nodeNo: number
  parentId: string | null
  level: number
  title: string
  content: string
  canonicalPath: string
  lineNo: number
  confidence: number
}

/**
 * 从 headings + text 构建结构节点树。
 * 栈式层级：遇 level N 弹出 level >= N 的同级，压当前；parentId = 栈倒数第二个（父节点）。
 * 正文切片：当前标题行 → 下一标题行（同 splitByHeadings :114-134）。
 */
export function buildStructureNodes(headings: HeadingLine[], text: string): StructureNodeData[] {
  if (headings.length === 0) return []

  const lines = text.split('\n')
  const nodes: StructureNodeData[] = []
  // 栈存 { level, text, id }：id 在 push 时预生成，供子节点的 parentId 引用
  const stack: { level: number; text: string; id: string }[] = []
  let nodeNo = 0

  for (let i = 0; i < headings.length; i++) {
    const cur = headings[i]
    const next = headings[i + 1]
    const id = randomUUID()

    // 弹栈：弹出 level >= 当前的（同级及更深层出栈）
    while (stack.length > 0 && stack[stack.length - 1].level >= cur.level) {
      stack.pop()
    }
    stack.push({ level: cur.level, text: cur.text, id })

    // parentId：栈倒数第二个（栈顶是当前自己，其下一层是父节点）
    const parentId = stack.length > 1 ? stack[stack.length - 2].id : null

    // 正文：当前标题行 → 下一标题行（或文末）
    const content = lines.slice(cur.lineNo, next?.lineNo ?? lines.length).join('\n').trim()

    nodes.push({
      nodeNo: nodeNo++,
      parentId,
      level: cur.level,
      title: cur.text,
      content,
      canonicalPath: stack.map((s) => s.text).join('>'),
      lineNo: cur.lineNo,
      confidence: cur.confidence,
    })
  }

  return nodes
}
