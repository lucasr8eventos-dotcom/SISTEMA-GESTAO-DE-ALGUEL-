FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Diretório de uploads — no Railway, monte um Volume aqui para persistir PDFs.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node

# Declara o ponto de montagem para Railway/docker volumes
VOLUME ["/app/uploads"]

EXPOSE 5000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
