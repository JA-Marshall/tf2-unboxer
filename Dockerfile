# tf2-unboxer: one container, configured by environment variables (see README.md).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY public ./public
COPY data ./data
COPY scripts ./scripts
# the login token, the log of opened cases and the price cache live in /data: keep it on a volume
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "src/server.js"]
