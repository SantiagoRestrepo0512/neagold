# syntax=docker/dockerfile:1
# NEAGOLD web — SPA Vue 3: build multi-stage + servida por nginx (no root).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
# --ignore-scripts evita el postinstall de @prisma/client (dependencia raíz
# que no necesita el build de la SPA)
RUN npm ci --workspace @neagold/web --ignore-scripts
COPY web ./web
RUN npm run build -w @neagold/web

FROM nginx:1.27-alpine AS runtime
# Configuración completa (pid en /tmp y logs a stderr) para correr como nginx
COPY web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
# Usuario no root: nginx corre como usuario 'nginx'
USER nginx
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]