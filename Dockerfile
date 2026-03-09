# Managed game-server container for JetLag: The Game.
#
# Deployed via GitHub Actions → GitHub Container Registry (ghcr.io).
# The container is spun up on first player join and shuts itself down on idle
# (server/start.js calls process.exit(0) in the onIdle hook) keeping idle
# cost at $0.
#
# Build:  docker build -t jetlag-server .
# Run:    docker run -e PORT=3002 -e DATABASE_URL=... -p 3002:3002 jetlag-server

FROM node:20-alpine AS base
WORKDIR /app

# Install production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the server source (no frontend build needed for this container).
COPY server/ ./server/

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002

CMD ["node", "server/start.js"]
