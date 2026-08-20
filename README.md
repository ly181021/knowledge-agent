# Knowledge Agent

> 企业级知识驱动型 AI 对话平台 —— 上传企业文档，对话即问即答，每条回答带引用来源、可回溯全链路 trace。

## 快速启动

### 1. 起基础设施

```bash
cd infra
cp .env.example .env         # 改密码（可选）
docker compose up -d         # MySQL + pg + Redis + MinIO + Kafka（KRaft）
docker compose ps            # 全部 healthy 后继续
```

### 2. 配置后端环境变量

```bash
cd server
cp .env.example .env
# 编辑 .env，至少填入 LLM_KEY；可选配 PREVIEW_MODE_ENABLED 等
# DATABASE_URL/PG_URL/REDIS_* 默认对齐 docker compose 起的容器
```

关键变量速查：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `mysql://knowledgeagent:knowledgeagent123@localhost:3306/knowledgeagent` | MySQL 业务库 |
| `PG_URL` | `postgresql://knowledgeagent:knowledgeagent123@localhost:5432/knowledgeagent` | pgvector 向量库 |
| `LLM_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/` | OpenAI 兼容协议 base_url（可换用任意 OpenAI 兼容服务） |
| `LLM_KEY` | （空） | LLM API Key |
| `LLM_MODEL` | `qwen-plus` | 对话模型 |
| `EMBEDDING_MODEL` | `text-embedding-v4` | 向量化模型 |
| `RAG_MIN_VECTOR_SIM` | `0.45` | 向量最低相似度阈值 |
| `RAG_MIN_KEYWORD_SCORE` | `0.01` | 关键词最低 ts_rank 阈值 |
| `PREVIEW_MODE_ENABLED` | `false` | 演示只读模式开关 |

### 3. 初始化数据库

```bash
cd server
pnpm install
pnpm prisma migrate dev --name init   # 建 MySQL 表
pnpm prisma generate
pnpm prisma db seed                   # 建首个 admin（账号由 SEED_ADMIN_* 决定，默认 admin / admin123）
# pgvector 表用 raw SQL 建（Prisma 不支持 vector 类型）：
psql "postgresql://knowledgeagent:knowledgeagent123@localhost:5432/knowledgeagent" -f server/prisma/pgvector.sql
```

### 4. 启动后端

```bash
# Git Bash
cd server
DATABASE_URL="mysql://knowledgeagent:knowledgeagent123@localhost:3306/knowledgeagent" node dist/src/main.js
# 或开发热重载
pnpm start:dev
# 后端跑在 http://localhost:3000
# Swagger: http://localhost:3000/api/docs
```

### 5. 启动前端

```bash
cd web
pnpm install
pnpm dev                  # http://localhost:5173（vite proxy /api → :3000）
```

打开 http://localhost:5173，用 `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` 配置的账号登录（默认 `admin` / `admin123`，见 `server/.env.example`），或点登录页下方"演示模式进入"按钮进入只读模式。

## 端口速查

| 服务 | 端口 | 说明 |
|---|---|---|
| 前端 Vite | 5173 | dev server，proxy `/api` → 3000 |
| 后端 NestJS | 3000 | API + Swagger (`/api/docs`) |
| MySQL | 3306 | 业务库 |
| PostgreSQL | 5432 | pgvector 向量库 |
| Redis | 6379 | 租约锁 |
| Kafka | 29092 | 消息队列（document-parse / document-index / summary-merge，容器端口映射；KRaft 单节点） |
| MinIO S3 | 9000 | 文档存储 API |
| MinIO Console | 9001 | 文档管理 UI |
