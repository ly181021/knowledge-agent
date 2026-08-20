# Knowledge Agent Server —— 多阶段构建（NestJS + Prisma）
#
# 设计要点：
#   1. 基础镜像用 node:22-bookworm-slim（glibc）——@node-rs/jieba / @prisma/engines /
#      msgpackr-extract 三个 native 包都有 glibc prebuilt，零编译；alpine(musl) 需额外适配。
#   2. runner 基于 builder 跑 pnpm prune --prod，删 devDeps 但保留 @prisma/client 的 generate
#      产物（.pnpm/@prisma+client@*/node_modules/.prisma/client/，PrismaClient 运行时按
#      library.js 的 searchLocations 动态查找）。规避 pnpm 版本号路径硬编码问题。
#   3. render.ts 用 __dirname 回溯 5 层读 src/modules/chatagent/prompts/*.md，runner 必须
#      保留这 6 个 .md（nest build 不复制非 ts 文件）。
#   4. prisma generate 注入 dummy DATABASE_URL（注意：generate 只解析 env() 不连库，但
#      schema.prisma 的 url=env("DATABASE_URL") 缺值会报 "Environment variable not found"）。
#
# Target：
#   - runner（默认）：生产运行
#   - init：DB 初始化容器（基于 builder，保留 prisma CLI + ts-node 跑 migrate/seed）

# ---------- 公共底 ----------
FROM node:22-bookworm-slim AS base
# 显式安装固定版本 pnpm 到 /usr/local/bin（corepack enable 创建的 shim 会被 prepare --output 覆盖，故只用后者）
RUN corepack prepare pnpm@10.5.2 --output /usr/local/bin/pnpm
WORKDIR /app

# ---------- builder：全量安装 + 编译 + generate ----------
FROM base AS builder
# 先 COPY 依赖清单（利用层缓存：源码改动不重装依赖）
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
# 全量安装（含 devDeps：prisma CLI / ts-node / nest-cli）
RUN pnpm install --frozen-lockfile
# 生成 Prisma Client：注入 dummy DATABASE_URL（generate 不连库，但需解析 env()）
# pnpm 10 靠 package.json 的 onlyBuiltDependencies 白名单执行 @prisma/engines 下载二进制
RUN DATABASE_URL="mysql://dummy:dummy@dummy:3306/dummy" pnpm prisma generate
# COPY 源码 + 构建配置，编译
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN pnpm nest build

# ---------- runner：生产运行（默认 target）----------
FROM base AS runner
ENV NODE_ENV=production
# 复制依赖清单 + 全量 node_modules，再 prune 到仅生产依赖
# prune 保留 dependencies 及其关联产物（含 .prisma/client/ generate 结果），删 devDependencies
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
RUN pnpm prune --prod
# 编译产物
COPY --from=builder /app/dist ./dist
# 运行时依赖的 prompt 模板（render.ts 用 __dirname 回溯读取，6 个 .md）
COPY src/modules/chatagent/prompts ./src/modules/chatagent/prompts
# prisma schema（部分运行时路径解析可能引用，保留保险）
COPY prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/src/main.js"]

# ---------- init：DB 初始化容器（target=init）----------
# 基于 builder（未 prune，保留 prisma CLI + ts-node），
# 启动命令由 compose 的 command 覆盖（migrate deploy + pgvector + 可选 seed）
FROM builder AS init
