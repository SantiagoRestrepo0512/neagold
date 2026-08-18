# DEPLOYMENT — NEAGOLD

Guía de despliegue: local (desarrollo) y producción (Docker Compose).

## Arquitectura

```
                        ┌─────────────────────────────┐
   Cliente ──► :80 ──►  │ nginx (web/nginx.conf)      │
                        │  SPA Vue + /api + /verify   │
                        └──────────────┬──────────────┘
                                       │ proxy interno
                        ┌──────────────▼──────────────┐
                        │ api (NestJS, :3000)         │
                        │  solo expuesto a la red      │
                        └──────────────┬──────────────┘
                                       │ red interna
                        ┌──────────────▼──────────────┐
                        │ postgres (postgres:17)      │
                        │  volumen neagold_pgdata      │
                        └─────────────────────────────┘
```

- **API**: NestJS 11 + Prisma 6 (driver adapter `@prisma/adapter-pg`).
- **Web**: SPA Vue 3 servida por nginx con proxy same-origin de `/api` y `/verify`.
- **Base de datos**: PostgreSQL 17+; esquema gestionado por migraciones Prisma.
- En producción **solo nginx queda expuesto** (puerto 80); postgres y la API no
  publican puertos al host. El TLS se termina en un reverse proxy frontal
  (ver "Requisitos de producción").

## Requisitos

| Entorno | Requisitos |
|---|---|
| Local | Node 20+ (recomendado 24), PostgreSQL 17+ (servicio nativo o Docker), npm 10+ |
| Producción | Docker 24+ con Compose **v2.20+** (condición `service_completed_successfully`), 1 GB RAM mínimo, dominio + TLS |

> Dockerfile de la API: `node:24-slim` (Debian, glibc). **No usar Alpine**:
> `argon2` solo publica prebuilds para glibc (no existe `linuxmusl-x64`).

---

## 1. Despliegue local

### 1.1 Instalar dependencias

```powershell
npm install                 # workspaces api + web
```

### 1.2 Base de datos

Opción A — PostgreSQL nativo (servicio de Windows, p. ej. PostgreSQL 18):

```powershell
# Verificar el servicio y crear la BD si no existe
Get-Service postgresql-x64-18
psql -U postgres -c "CREATE ROLE neagold LOGIN PASSWORD 'neagold_dev_password' CREATEDB;"
psql -U postgres -c "CREATE DATABASE neagold OWNER neagold;"
```

Opción B — Docker:

```powershell
npm run db:up               # docker compose up -d postgres
```

> Credenciales de desarrollo (solo local): `neagold / neagold_dev_password`.

### 1.3 Configuración y esquema

```powershell
Copy-Item .env.example .env # luego ajustar si hace falta
npm run db:migrate          # aplica migraciones + seed (admin, staff, cliente demo)
```

### 1.4 Arrancar API y Web

```powershell
cd api
npm run start:dev           # API en http://localhost:3000
```

```powershell
cd web
npm run dev                 # SPA en http://localhost:5173
```

**URLs locales**

| Servicio | URL |
|---|---|
| SPA | http://localhost:5173 |
| API (health) | http://localhost:3000/health |
| API (ready) | http://localhost:3000/ready |
| Verificación pública | http://localhost:5173/verify/:publicToken |

**Credenciales del seed** (password común para los 3 usuarios):

| Rol | Email | Password |
|---|---|---|
| SUPER_ADMIN | `admin@neagold.local` | `ChangeMe_Neagold_2026!` |
| STAFF | `staff@neagold.local` | `ChangeMe_Neagold_2026!` |
| CUSTOMER | `cliente@neagold.local` | `ChangeMe_Neagold_2026!` |

> Cambiar `SEED_ADMIN_PASSWORD` en `.env` si se re-siembra una base no demo.

---

## 2. Despliegue de producción (Docker Compose)

### 2.1 Preparar el servidor

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER   # re-loguear la sesión
```

### 2.2 Obtener el código y configurar el entorno

```bash
git clone <repo> /opt/neagold && cd /opt/neagold
cp .env.example .env
```

Generar los secretos (obligatorios en producción — el arranque FALLA si no):

```bash
# JWT: mínimo 32 caracteres, recomendado 48 bytes base64url
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# MFA: clave AES-256-GCM en hex (64 caracteres)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Postgres: contraseña fuerte
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Editar `.env` — sección Producción (todo lo siguiente es **obligatorio**):

```bash
NODE_ENV="production"
DATABASE_URL="postgresql://neagold:TU_CONTRASEÑA@postgres:5432/neagold?schema=public"
POSTGRES_USER="neagold"
POSTGRES_PASSWORD="TU_CONTRASEÑA"
POSTGRES_DB="neagold"
JWT_ACCESS_SECRET="<generado>"
MFA_SECRET_ENCRYPTION_KEY="<hex de 64 caracteres>"
CORS_ORIGINS="https://neagold.com"
PUBLIC_BASE_URL="https://neagold.com"
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_USER="apikey"
SMTP_PASS="secret"
EMAIL_FROM="NEAGOLD <no-reply@neagold.com>"
SEED_DEMO="false"
```

> Fail-fast de `NODE_ENV=production`: placeholders de JWT/MFA, `CORS_ORIGINS`
> vacío y SMTP ausente detienen el arranque con mensajes claros (los emails no
> pueden caer al provider de desarrollo en producción).

### 2.3 Construir y levantar

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Orden de arranque (gestionado por `depends_on`):

1. `postgres` → healthcheck `pg_isready`.
2. `migrate` (one-shot, `target: prisma` del Dockerfile) → aplica migraciones y
   **termina** (`service_completed_successfully`).
3. `api` → healthcheck `GET /health`.
4. `web` (nginx) → expone `:80`.

### 2.4 Verificar

```bash
docker compose -f docker-compose.prod.yml ps            # todos Up (migrate: exited 0)
curl -fsS http://localhost/health                        # {"status":"ok"}
curl -fsS http://localhost/api/v1/health                # API vía nginx
```

### 2.5 TLS (recomendado)

nginx solo expone HTTP en `:80`. Terminar TLS con un reverse proxy frontal
(Caddy/nginx/certbot) apuntando a `http://127.0.0.1:80`, o editar
`web/nginx.conf` para servir `:443` con certificados. El proxy debe:

- Reenviar `Host` y `X-Forwarded-For` (usados por la API para IP de clientes).
- Mantener las cabeceras de seguridad ya emitidas por la app (CSP, HSTS en
  producción vía helmet).

### 2.6 Actualización y rollback

```bash
cd /opt/neagold
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate one-shot aplica lo nuevo
```

Rollback: `git checkout <commit-anterior>` + mismo comando. La BD no se revierte
automáticamente; si la migración falla, restaurar del backup (ver `DATABASE.md`
→ Backup y restore) y corregir antes de reintentar.

### 2.7 Backups

```bash
# Manual
DATABASE_URL="postgresql://neagold:PASS@postgres:5432/neagold" ./scripts/backup.sh

# Cron diario 03:00 (con retención de 14 días por defecto)
0 3 * * * cd /opt/neagold && DATABASE_URL="postgresql://..." ./scripts/backup.sh >> /var/log/neagold-backup.log 2>&1
```

Copiar los backups fuera del servidor y **probar un restore** al menos una vez
por trimestre.

---

## 3. Operación

### 3.1 Logs

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web
```

### 3.2 Endpoints de salud

| Endpoint | Uso |
|---|---|
| `GET /health` | Liveness: proceso vivo (no toca la BD). |
| `GET /ready` | Readiness: verifica conexión a PostgreSQL. |

### 3.3 Reglas operativas

- **Nunca** ejecutar `db:seed` con `SEED_DEMO=true` en producción (el fail-fast
  no lo bloquea; es responsabilidad operativa).
- Los webhooks salientes validan el destino (anti-SSRF) al crear y en cada
  entrega; en producción exigen `https` y rechazan IPs privadas/reservadas.
- Los límites de rate limiting por defecto: global 120/min por IP y login
  15/min por IP. Ajustar con `THROTTLE_LIMIT` / `LOGIN_THROTTLE_LIMIT`.
- La BD de producción no publica puertos; para tareas administrativas usar
  `docker compose exec postgres psql -U neagold -d neagold`.

---

## 4. Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| `argon2` falla al instalar en la imagen | Imagen basada en musl (Alpine). Usar el Dockerfile incluido (Debian slim). |
| `service_completed_successfully` no funciona | Compose < v2.20. Actualizar el plugin de Docker Compose. |
| La API no arranca en producción | Fail-fast de `.env`: JWT/MFA/CORS/SMTP inválidos. Leer el mensaje del contenedor. |
| `migrate` sale con error | La migración falló. Restaurar backup si hubo cambios parciales y corregir. |
| `localhost:5173` no conecta a la API | El proxy dev de Vite apunta a `localhost:3000`; arrancar la API primero. |
| Emails no llegan | En dev los enlaces se devuelven en la respuesta (`devVerifyUrl`). En producción `SMTP_HOST` es obligatorio. |
| Login da 423 ACCOUNT_LOCKED | 5 intentos fallidos desde IPs distintas (o con el mismo email). Esperar el lockout o desbloquear desde la BD: `UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE email='...';` |
| `P2002` en ventas/transferencias | Ya existe una venta (una pieza se vende una vez) o una transferencia PENDING para esa pieza. |