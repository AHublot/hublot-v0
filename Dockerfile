# Hublot : application + API (Node 22, SQLite intégré, aucune dépendance npm)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data TZ=America/Martinique
RUN apk add --no-cache tzdata
COPY index.html manifest.webmanifest sw.js ./
COPY src ./src
COPY styles ./styles
COPY icons ./icons
COPY server ./server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
