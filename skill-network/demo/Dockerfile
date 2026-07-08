FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Demo server + agent UI + MCP server (all share these prod deps)
COPY server.js security.js hcs26.js agent-network.js agent-server.js mcp-server.mjs ./
COPY public ./public
COPY public-agent ./public-agent
# Off-chain settlement prototype (vendored from ../settlement; zero external deps)
COPY settlement ./settlement

# Writable dir for the persisted state snapshot (STATE_FILE default)
RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
