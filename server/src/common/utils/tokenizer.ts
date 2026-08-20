/**
 * 中文分词工具 —— 应用层 jieba
 * PostgreSQL simple 全文检索配置不做中文分词（中文按标点切成长 token，查询短语必须逐字连续出现才命中），
 * 因此在应用层用 jieba 分词后以空格分隔存入 tsv_zh，查询端同样分词后 plainto_tsquery。
 * 纯函数（无状态），manage 写入端与 chatagent 查询端共用。
 */
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'

/** 单例：withDict 加载默认词典（new Jieba 是空词典，必须加载） */
const jieba = Jieba.withDict(dict)

/** 轻量中文停用词表（高频虚词/疑问词），可按需扩充 */
const STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '一个', '什么', '怎么', '如何', '为什么',
  '吗', '呢', '吧', '啊', '呀', '这', '那', '我', '你', '他', '她', '它', '我们', '你们', '他们',
  '请', '请问', '有', '没有', '不', '要', '会', '能', '可以', '应该', '把', '被', '给', '对',
  '从', '到', '向', '于', '等', '的',
])

/**
 * 分词 + 停用词过滤，返回空格分隔的 token 串（供 to_tsvector / plainto_tsquery 使用）
 * 例：tokenize('退款规则是什么') → '退款 规则'
 * 纯停用词输入返回空串，调用方应回退到原文本检索（tsv 列）
 */
export function tokenize(text: string): string {
  return jieba
    .cut(text)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .join(' ')
}
