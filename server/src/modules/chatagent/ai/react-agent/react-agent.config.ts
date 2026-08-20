/**
 * ReactAgent 熔断阈值常量
 * 三层熔断：
 *   1. maxSteps：单轮模型步骤上限（AI SDK 内置防死循环，tools 模式必须传）
 *   2. MAX_TOOL_CALLS：单轮工具调用上限（onStepFinish 计数，超限抛错中断流）
 *   3. SESSION_*_LIMIT：会话累计上限（进 streamText 前 countSessionUsage 预检）
 */
export const MAX_STEPS = 8
export const MAX_TOOL_CALLS = 6
export const SESSION_MODEL_LIMIT = 40
export const SESSION_TOOL_LIMIT = 30
