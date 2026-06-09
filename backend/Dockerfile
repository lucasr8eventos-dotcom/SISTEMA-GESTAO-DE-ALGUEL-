FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package*.json ./
# npm install (em vez de npm ci) tolera pequenas divergências entre
# package.json e package-lock.json, evitando builds quebrados por diferenças
# de versão do npm entre ambientes. --omit=dev não instala devDependencies.
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

RUN mkdir -p uploads

USER node

EXPOSE 5000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
