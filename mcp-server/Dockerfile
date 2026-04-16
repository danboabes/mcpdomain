# MCPDomain MCP Server - Production Dockerfile
# Multi-stage build for minimal final image

FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies
RUN npm prune --production


# ─── Runtime stage ─────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Non-root user for security
RUN addgroup -S mcpdomain && adduser -S mcpdomain -G mcpdomain

# Copy built artifacts and production node_modules
COPY --from=builder --chown=mcpdomain:mcpdomain /app/dist ./dist
COPY --from=builder --chown=mcpdomain:mcpdomain /app/node_modules ./node_modules
COPY --from=builder --chown=mcpdomain:mcpdomain /app/package.json ./package.json

USER mcpdomain

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# Health check (uses the /health endpoint we built)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/http.js"]
