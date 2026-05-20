FROM node:20-alpine AS builder

ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# CI=false evita que warnings de ESLint quebrem o build (CRA padrão).
RUN CI=false npm run build

FROM nginx:alpine

# PORT é setado pela plataforma (Render). Default 80 para uso local.
ENV PORT=80

COPY --from=builder /app/build /usr/share/nginx/html
# Coloca o template FORA de /etc/nginx/templates para não conflitar com o
# entrypoint padrão da imagem nginx (que faz envsubst automático e
# quebra a substituição em algumas plataformas).
COPY nginx.conf /etc/nginx/conf.template

EXPOSE 80

CMD ["sh", "-c", "envsubst '${PORT}' < /etc/nginx/conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
