FROM node:22-alpine

WORKDIR /app

# Copy manifests first so dependency layers cache across code changes.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Overridden by fly.toml to point at the mounted volume.
ENV DATA_DIR=/app/data
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "src/index.js"]
