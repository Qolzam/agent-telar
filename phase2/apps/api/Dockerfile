# ─── Stage 1: Builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json .
COPY tsup.config.ts .
COPY src/ ./src/
RUN pnpm build

RUN pnpm prune --prod

# ─── Stage 2: Production ────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S agenttelar -u 1001

COPY --from=builder --chown=agenttelar:nodejs /app/dist ./dist
COPY --from=builder --chown=agenttelar:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=agenttelar:nodejs /app/package.json ./

USER agenttelar

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1))"

EXPOSE 3000
CMD ["node", "dist/index.js"]
