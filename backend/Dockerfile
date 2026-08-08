FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Backend build stage
FROM base AS backend-builder
WORKDIR /app/backend
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Backend production stage
FROM base AS backend-production
WORKDIR /app
COPY --from=backend-builder /app/backend/package.json ./
COPY --from=backend-builder /app/backend/dist ./dist

# Install production dependencies only
RUN pnpm install --prod

USER node

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3004/api/health || exit 1

CMD ["node", "dist/index.js"]
