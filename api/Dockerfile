# syntax=docker/dockerfile:1
# NEAGOLD api — imagen multi-stage (usuario no root, healthcheck, npm ci).
# El contexto de build es la raíz del monorepo.
#
# NOTA: imágenes basadas en Debian slim (glibc), no Alpine: argon2 solo
# publica prebuilds glibc (sin linuxmusl-x64); en Alpine compilaría en el
# contenedor y fallaría en runtime.
# NOTA: se instala el monorepo completo (npm ci sin -w): el runtime necesita
# dependencias del workspace raíz (@prisma/adapter-pg, pg, argon2).
#
# Targets:
#   - build   : compila dist y el Prisma Client generado (stage intermedio)
#   - prisma  : CLI de Prisma para ejecutar migraciones (servicio one-shot)
#   - runtime : imagen final de producción (por defecto)

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY prisma ./prisma
RUN npm ci && npx prisma generate
COPY api ./api
RUN npm run build -w @neagold/api

FROM node:24-slim AS prisma
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY prisma ./prisma
RUN npm ci --ignore-scripts
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
# Solo dependencias de producción (--ignore-scripts evita el postinstall de
# @prisma/client; el cliente generado se copia desde el stage build)
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/node_modules/.prisma node_modules/.prisma/
COPY --from=build /app/api/dist api/dist/
COPY --from=build /app/prisma prisma/
# Usuario no root: el contenedor nunca corre como root
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "api/dist/main.js"]