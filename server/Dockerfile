# 门铃调度器 —— 零依赖，node:22-alpine 自带的 fetch/http 就够
FROM node:22-alpine
WORKDIR /app
COPY index.mjs ./
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
# 非 root 跑，容器逃逸的代价小一点
USER node
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1
CMD ["node", "index.mjs"]
