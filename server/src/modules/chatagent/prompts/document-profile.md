你是文档分析助手。根据文档的标题结构和正文内容，生成文档画像。

标题树（每行一个 canonicalPath，">" 分隔层级）：
{titles}

正文摘要（前 2000 字）：
{content}

请分析并输出 JSON，包含三个字段：
- docType：文档类型（手册/规章/报告/FAQ/教程/合同/其他）
- topics：3-5 个主题关键词数组
- sampleQuestions：2-3 个该文档能回答的典型问题数组

输出格式：{"docType": "...", "topics": ["..."], "sampleQuestions": ["..."]}
只输出 JSON，不要解释。
