# NEAGOLD

Plataforma de identidad digital y trazabilidad de joyería: cada pieza tiene un
serial único, identidad digital (token público canónico + hash), QR de
verificación pública, historial de propiedad inmutable, certificados
verificables y un portal web de gestión.

Monorepo con workspaces de npm.

## Stack

| Capa | Tecnología |
|---|---|
| API | NestJS 11 + Prisma 6 + PostgreSQL 17+, TypeScript estricto |
| Web | Vue 3 + Vite 6 + Pinia + Vue Router, TypeScript estricto |
| Auth | Argon2id, JWT access en cookie httpOnly + refresh con rotación y familias, CSRF por cookie + header, MFA TOTP |
| Seguridad | RBAC por permisos, rate limiting, lockout distribuido, auditoría, idempotencia, anti-SSRF + HMAC en webhooks |
| Tests | Vitest (unit + e2e contra PostgreSQL real), integridad de BD |

## Estructura

```
api/      Backend NestJS (código en src/, specs en test/)
web/      Frontend Vue 3 (SPA, views por módulo)
prisma/   Schema, migraciones, seed y tests de integridad
scripts/  backup.sh / restore.sh (producción)
docs      DEPLOYMENT.md, PRODUCTION_CHECKLIST.md, PRODUCTION_READINESS_REPORT.md
```

## Quick start (local, Windows PowerShell)

Requisitos: Node 20+ (recomendado 24), PostgreSQL 17+ (servicio nativo o Docker).

```powershell
npm install                # workspaces api + web
Copy-Item .env.example .env
npm run db:migrate         # aplica migraciones + seed (admin, staff, cliente demo)
```

Base de datos — opción nativa (servicio `postgresql-x64-18`) o Docker:

```powershell
npm run db:up              # Docker: levanta Postgres en localhost:5432
```

Arrancar la API y la Web (dos terminales):

```powershell
cd api
npm run start:dev          # API en http://localhost:3000
```

```powershell
cd web
npm run dev                # SPA en http://localhost:5173 (proxy /api y /verify)
```

**Entrá a `http://localhost:5173`.**

### URLs

| Servicio | URL |
|---|---|
| SPA | `http://localhost:5173` |
| API | `http://localhost:3000` (health en `/health`, ready en `/ready`) |
| Verificación pública | `http://localhost:5173/verify/:publicToken` |

### Credenciales demo (seed)

| Rol | Email | Password |
|---|---|---|
| SUPER_ADMIN | `admin@neagold.local` | `ChangeMe_Neagold_2026!` |
| STAFF | `staff@neagold.local` | `ChangeMe_Neagold_2026!` |
| CUSTOMER | `cliente@neagold.local` | `ChangeMe_Neagold_2026!` |

Con `SEED_DEMO=true` (default) el seed crea además 3 productos, 3 piezas con
identidad digital + QR, y una venta canjeada (el anillo `NG-RING-18K-001` queda
en propiedad del cliente demo).

> El envío de emails de verificación/reset es solo de desarrollo: la API
> devuelve la URL directamente en la respuesta (`devVerifyUrl`/`devResetUrl`)
> y las vistas la muestran.

## Acceso a la base de datos (psql)

Instalación nativa de PostgreSQL (Windows): psql está en
`C:\Program Files\PostgreSQL\<version>\bin\psql.exe`.

```powershell
# Conexión a la BD de desarrollo (neagold / neagold_dev_password)
$env:PGPASSWORD="neagold_dev_password"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U neagold -h localhost -d neagold

# Dentro de psql
\l                          # listar bases de datos
\dt                          # listar tablas
\d ownership_records         # estructura de una tabla
SELECT email, status FROM users;
SELECT p.serial_number, o.start_date FROM ownership_records o
  JOIN jewelry_pieces p ON p.id = o.piece_id WHERE o.end_date IS NULL;
\q                          # salir
```

En producción (la BD no publica puertos):

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U neagold -d neagold
```

Más detalles y queries de operación en `DATABASE.md`.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run db:up` / `db:down` | Postgres local (Docker) |
| `npm run db:migrate` | Migración de desarrollo + seed |
| `npm run db:migrate:deploy` | Aplicar migraciones pendientes (producción) |
| `npm run db:seed` | Seed idempotente |
| `npm run test:db` | Migra BD de tests + suite de integridad (17 tests) |
| `npm run generate` | Regenera Prisma Client |

En `api/`:

| Comando | Descripción |
|---|---|
| `npm test` | Suite e2e completa Vitest (102 tests en 14 specs) |
| `npm run test:unit` | Specs unit (`src/**/*.spec.ts`, 42 tests) |
| `npm run lint` | ESLint (src + test) |
| `npm run build` | Compilación NestJS |

En `web/`:

| Comando | Descripción |
|---|---|
| `npm run dev` | Dev server (proxy a `localhost:3000`) |
| `npm run build` | `vue-tsc` + `vite build` |

Tests e2e: corren contra `dist/` — compilar la API antes (`npm run build`).
Configuración de BD de tests en `.env.test`.

## Módulos

- **Autenticación y sesiones** — login/registro, verificación de email,
  recuperación de contraseña, MFA TOTP, sesiones con rotación de refresh,
  revocación y lockout distribuido por IP.
- **Catálogo y piezas** — productos, registro de piezas con serial anual,
  identidad digital (SHA-256 del payload canónico), QR regenerables.
- **Ventas y garantías** — venta de una pieza (una sola vez) con código de
  reclamación de un solo uso (128 bits, hash en BD).
- **Transferencias** — propiedad P2P con invitación, expiración y bloqueo
  cruzado contra ventas/canjes.
- **Certificados** — autenticidad/aprecio/mantenimiento con documento canónico
  y hash verificable por descarga.
- **Servicios** — órdenes de mantenimiento (solicitud → inicio → completado);
  al iniciar la pieza pasa a `IN_SERVICE`; al completar vuelve a `AVAILABLE`.
- **Incidentes** — robo/pérdida/fraude con reportes, resolución y máximo un
  incidente abierto por pieza (índice único parcial).
- **Notificaciones y webhooks** — bus de eventos in-process; webhooks firmados
  (HMAC-SHA256) con reintentos de backoff, desactivación automática y
  validación anti-SSRF del destino.
- **Portal público de verificación** — `/verify/:token` sin autenticación.

## Producción

- `DEPLOYMENT.md` — despliegue local y producción (Docker Compose), TLS, backups, troubleshooting.
- `PRODUCTION_CHECKLIST.md` — checklist operativa pre-go-live.
- `PRODUCTION_READINESS_REPORT.md` — reporte de readiness (fases, threat model, métricas).
- `SECURITY.md` — garantías y límites de la plataforma.

## Estado

Plataforma verificada end-to-end: e2e 102/102, unit 42/42, integridad de BD
17/17, lint y builds limpios. Fases de auditoría F1–F9 cerradas (ver
`ARCHITECTURE_AUDIT.md`).