# Knowledge Agent Web —— 多阶段构建（Vite + Vue3 → nginx 托管）
#
# 设计：builder 阶段用 node 编译出 SPA 静态文件，runner 阶段用 nginx 托管 + 反代 /api。
# 前端 request.ts 用相对路径 /api/v1，同源直达 nginx，无跨域（server CORS 不用改）。
# 详见 web/nginx.conf（含 SSE 反代配置）。

# ---------- builder：编译 SPA ----------
FROM node:22-bookworm-slim AS builder
RUN corepack prepare pnpm@10.5.2 --output /usr/local/bin/pnpm
WORKDIR /app

# 先 COPY 依赖清单（层缓存）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# COPY 源码 + 构建配置（web 是单 tsconfig，无 tsconfig.app.json；public 为空目录不带）
COPY tsconfig.json index.html vite.config.ts ./
COPY src ./src

# 构建（vue-tsc 类型检查 + vite build）
RUN pnpm build

# ---------- runner：nginx 托管 ----------
FROM nginx:stable-alpine AS runner
# 清掉 nginx 默认配置，换上项目定制配置（SPA + /api 反代 + SSE）
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
# 构建产物拷到 nginx 静态根
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
