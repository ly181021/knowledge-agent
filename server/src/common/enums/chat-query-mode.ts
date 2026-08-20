/**
 * ChatQueryMode —— 用户侧问答模式枚举（ChatQueryMode）
 * 三种问答模式（前端按钮文案）：
 * - DOCUMENT       当前文档问答：限定在用户选中的单个文档内检索
 * - AUTO_DOCUMENT  自动知识问答：全库 RAG 检索（默认）
 * - OPEN_CHAT      开放式提问：不走知识库，直接基于模型自身能力回答
 * 与 ExecutionMode（后端执行器维度）的映射在 PreparationOrchestrator 中完成：
 * DOCUMENT/AUTO_DOCUMENT → RETRIEVAL，OPEN_CHAT → REACT_AGENT
 */
export enum ChatQueryMode {
  DOCUMENT = 'DOCUMENT',
  AUTO_DOCUMENT = 'AUTO_DOCUMENT',
  OPEN_CHAT = 'OPEN_CHAT',
}
