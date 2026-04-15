# ── Build Stage ──
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production --ignore-scripts

# ── Runtime Stage ──
FROM node:20-slim
WORKDIR /app

# Create non-root user
RUN groupadd -r bridge && useradd -r -g bridge -s /bin/false bridge

# Copy dependencies and source
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Create logs directory
RUN mkdir -p /app/logs && chown -R bridge:bridge /app

USER bridge

# Health check against the API endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http');const r=http.get('http://localhost:9100/health',res=>{process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1))"

EXPOSE 9100

CMD ["node", "src/index.js"]
