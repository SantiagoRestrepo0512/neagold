# DEPLOYMENT — VERCEL (NEAGOLD)

Guía de despliegue en **Vercel** de la plataforma completa (API NestJS como
serverless function + SPA Vue + cron de webhooks). Alternativa al despliegue
Docker de `DEPLOYMENT.md`.

## Arquitectura en Vercel

```
                        ┌──────────────────────────────────────┐
   https://<dominio> ──►│ Vercel Edge (routing)                │
                        │  /api/*  → serverless function (Nest)│
                        │  /verify/* → serverless function     │
                        │  /health, /ready → serverless func   │
                        │  /assets/* y demás → static (SPA)    │
                        │  (.*) → SPA fallback (index.html)    │
                        └────────────────┬─────────────────────┘
                                         │
                        ┌────────────────▼─────────────────────┐
                        │ PostgreSQL gestionado                 │
                        │  (Vercel Postgres / Neon / Supabase) │
                        │  + pooler (PGBouncer/Neon)           │
                        └──────────────────────────────────────┘
```

- **API**: NestJS 11 compilado con `nest build` (tsc). El entry `api/index.ts`
  importa el handler desde `dist/serverless.js` para que `@vercel/node`
  empaquete el JS compilado (los decoradores conservan `design:paramtypes` y
  la DI de Nest funciona). El handler reutiliza la instancia de Express entre
  invocaciones (warm starts).
- **Web**: build de Vite estático (`web/dist`).
- **DB**: PostgreSQL externo. El driver adapter `@prisma/adapter-pg` funciona
  en serverless; **usa el pooler** (Neon/Supabase) en la URL de
  `DATABASE_URL` para no agotar conexiones.

## Requisitos previos

1. Una base PostgreSQL gestionada (Vercel Postgres, Neon, Supabase...) y su
   `DATABASE_URL` con pooler.
2. Repositorio conectado a Vercel (proyecto con raíz en la raíz del repo).
3. Variable `CRON_SECRET` (para Vercel Cron, opcional si no usas webhooks).

## 1. Configuración del proyecto en Vercel

- **Framework Preset**: *Other* (vercel.json ya define todo: build, builds y rutas).
- **Root Directory**: raíz del repositorio.
- **Build Command**: lo define `vercel.json` (`npm run vercel-build`), no hace
  falta tocarlo en el dashboard.

`vercel.json`:

| Propiedad | Valor | Motivo |
|---|---|---|
| `buildCommand` | `npm run vercel-build` | regenera el cliente de Prisma ANTES de compilar (`prisma generate`), lo que evita los errores TS de cliente vacío, y compila API + web |
| `builds` | `api/index.ts` → `@vercel/node` | función serverless con la API Nest |
| `builds` | `web/dist/**` → `@vercel/static` | SPA |
| `routes` | `/api/(.*)`, `/verify/(.*)`, `/health`, `/ready` → función | mismo enrutado que nginx en Docker |
| `routes` | `/(.*)` → `web/dist/index.html` | SPA fallback (deep links) |
| `crons` | `/api/v1/internal/cron/flush-webhooks` cada hora | reintentos de webhooks (el worker de interval no existe en serverless) |

> El `postinstall` del package.json raíz (`prisma generate`) garantiza que el
> cliente de Prisma se genere en CADA instalación, incluida la de Vercel.

## 2. Variables de entorno (todas obligatorias en producción)

Vercel fija `NODE_ENV=production`, así que el fail-fast de la app exige:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?sslmode=require&pgbouncer=true` (pooler) |
| `JWT_ACCESS_SECRET` | ≥ 32 chars (generar con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `MFA_SECRET_ENCRYPTION_KEY` | hex de 64 chars |
| `CORS_ORIGINS` | `https://<tu-dominio>` |
| `PUBLIC_BASE_URL` | `https://<tu-dominio>` |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | provider SMTP real |
| `CRON_SECRET` | secreto para el cron de webhooks (opcional si no se usan) |

Opcionales: `THROTTLE_LIMIT`, `LOGIN_THROTTLE_LIMIT`, `VERIFY_OWNER_NAME`,
`WEBHOOK_DELIVERY_TIMEOUT_MS`.

> Nota: si `DATABASE_URL` la marcas como *sensitive* en Vercel no estará
> disponible en el build (solo en runtime). El build NO la necesita (solo
> `prisma generate`), así que puedes marcarla sensitive sin problema.

## 3. Migraciones

Aplicar el esquema contra la base remota. Dos opciones:

- **Una vez (recomendado)** tras conectar la DB:
  ```bash
  npm run vercel:migrate   # prisma migrate deploy
  ```
- **Automático en cada deploy** (si `DATABASE_URL` es no-sensitive, así estará
  en el build): añade al script `vercel-build` de package.json:
  `npm run generate && prisma migrate deploy && npm run build`.

## 4. Despliegue

```bash
npm i -D vercel        # ya está en devDependencies
vercel login
vercel link
vercel env pull .env.local   # o define las env vars en el dashboard
vercel build            # build local (replica el pipeline de producción)
vercel deploy --prod
```

Tras el deploy, verificar:

```bash
curl -fsS https://<dominio>/health           # {"status":"ok"}
curl -fsS https://<dominio>/ready            # {"status":"ready","database":"up"}
curl -fsS https://<dominio>/api/v1/auth/csrf # token CSRF (SPA operativa)
```

## 5. Limitaciones del entorno serverless (a tener en cuenta)

| Aspecto | Comportamiento en Vercel | Mitigación |
|---|---|---|
| Worker de reintentos de webhooks | `DeliveryWorker` (setInterval) se **desactiva** automáticamente (`VERCEL=1`) | Cron cada hora en `vercel.json` golpea `POST /api/v1/internal/cron/flush-webhooks` con `x-cron-secret` |
| Conexiones a PostgreSQL | Cada invocación usa el pool del adapter `pg` | Usar pooler (Neon/Supabase) en `DATABASE_URL` |
| Arranque en frío | El primer request inicializa Nest (módulos + Prisma) | `maxDuration: 60` en `vercel.json`; dejar el warm start para el tráfico real |
| Persistencia post-respuesta | El callback `response.on('finish')` de idempotencia escribe tras enviar la respuesta; Vercel drena el event loop antes de congelar la función | El write es una sola query, entra en la gracia; si se observan pérdidas, reenviar con la misma `Idempotency-Key` |
| Archivos en disco | El sistema de archivos es efímero entre invocaciones | No se usa persistencia local (todo vive en PostgreSQL) |
| Emails | Sin servidor SMTP propio | Usar provider SMTP externo (ya requerido en producción) |

## 6. Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| `Module '@prisma/client' has no exported member ...` / `Prisma.JsonNull` no existe | El cliente de Prisma no se regeneró en el build. Revisar que `postinstall`/`vercel-build` corren `prisma generate` y que el build usa la raíz del repo |
| `Nest can't resolve dependencies` en runtime | El entry de Vercel no debe importar desde `src/`: `api/index.ts` importa `./dist/serverless` (JS ya compilado con metadata de decoradores) |
| Build falla por variables | `NODE_ENV=production` en Vercel activa el fail-fast: faltan JWT/MFA/CORS/SMTP (ver sección 2) |
| `/api/*` devuelve 404 | La ruta en `vercel.json` exige el prefijo `api/v1` en la app; `health`/`ready`/`verify` están excluidos del prefijo global a propósito |
| Migraciones no aplicadas | Ejecutar `npm run vercel:migrate` una vez; el build no las aplica si `DATABASE_URL` es sensitive |
| Cron 403 | Falta `CRON_SECRET` o el header `x-cron-secret` no coincide. El endpoint está `@SkipCsrf` a propósito (autenticación server-to-server) |