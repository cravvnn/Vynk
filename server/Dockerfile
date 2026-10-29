FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/protocol/package.json shared/protocol/
COPY server/package.json server/
RUN npm ci
COPY shared/protocol shared/protocol
COPY server server
# --force: never trust a copied tsbuildinfo; the image must emit its own dist.
RUN npm run build -- --force

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/protocol/package.json shared/protocol/
COPY server/package.json server/
RUN npm ci --omit=dev
COPY --from=build /app/shared/protocol/dist shared/protocol/dist
COPY --from=build /app/server/dist server/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "server/dist/index.js"]
