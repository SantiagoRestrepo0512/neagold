# PRODUCTION CHECKLIST — NEAGOLD

Checklist operativa previa al go-live. Cada ítem debe poder verificarse.

## 1. Secretos y entorno (`.env`)

- [ ] `NODE_ENV="production"` (con esto el fail-fast de configuración está activo)
- [ ] `JWT_ACCESS_SECRET` generado con `crypto.randomBytes(48).toString('base64url')` y ≥ 32 caracteres
- [ ] `MFA_SECRET_ENCRYPTION_KEY` hex de 64 caracteres (AES-256-GCM) — perderla inutiliza los TOTP guardados
- [ ] `POSTGRES_PASSWORD` fuerte y distinta de cualquier valor de desarrollo
- [ ] `DATABASE_URL` apunta al servicio `postgres` interno, con `?schema=public`
- [ ] `CORS_ORIGINS` con el/los orígenes reales de la SPA (https)
- [ ] `PUBLIC_BASE_URL` con el dominio público (base de enlaces de email)
- [ ] `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`EMAIL_FROM` reales (obligatorio en producción)
- [ ] `SEED_DEMO="false"` — el seed demo **no** debe ejecutarse en producción
- [ ] `.env` con permisos restringidos (0600) y **nunca** en el repositorio

## 2. Base de datos

- [ ] Migraciones aplicadas (`migrate` one-shot terminó con exit 0)
- [ ] Backups automatizados (cron diario vía `scripts/backup.sh`, retención ≥ 14 días)
- [ ] Backup copiado fuera del servidor
- [ ] Restore probado al menos una vez (trimestral recomendado)
- [ ] `neagold_pgdata` en un volumen persistente; la BD no publica puertos al host
- [ ] Contraseña del rol `neagold` rotada respecto a cualquier valor de desarrollo

## 3. Red y TLS

- [ ] TLS terminado por reverse proxy frontal (Caddy/nginx/certbot) o editando `web/nginx.conf` para `:443`
- [ ] Solo el puerto 80/443 expuesto al exterior; 3000 y 5432 internos
- [ ] `X-Forwarded-For` reenviado por el proxy (la API lo usa para IP de clientes y rate limiting)
- [ ] Redirect HTTP → HTTPS (y HSTS — la API lo emite solo en `production`)

## 4. Verificación funcional post-despliegue

- [ ] `curl -fsS http://localhost/health` → `{"status":"ok"}`
- [ ] `curl -fsS http://localhost/ready` → ok (comprueba PostgreSQL)
- [ ] Login de un usuario staff/admin funciona
- [ ] Verificación pública: `GET /verify/<publicToken>` de una pieza seed responde
- [ ] Email de registro/reset llega (SMTP) y el enlace usa `PUBLIC_BASE_URL`
- [ ] Un webhook creado con destino público responde; uno a IP privada es rechazado
- [ ] Rate limiting activo: 15 intentos de login/min por IP → 429

## 5. Seguridad operativa

- [ ] Usuarios seed (admin/staff/cliente) con password rotada o eliminados
- [ ] `SEED_ADMIN_PASSWORD` ya no coincide con el valor publicado en el README
- [ ] Roles y permisos revisados (mínimo privilegio: cliente ≠ staff ≠ admin)
- [ ] Monitoreo de `audit_logs` (acciones sensibles: ventas, transferencias, incidentes, webhooks)
- [ ] Alerta ante fallos del worker de webhooks (`failureCount` → 5 desactiva el endpoint)
- [ ] Límites de throttling acordes al negocio (`THROTTLE_LIMIT`, `LOGIN_THROTTLE_LIMIT`)
- [ ] `SECURITY.md` leído y aceptado por el equipo (límites: hash ≠ firma, QR ≠ autenticidad física)

## 6. Operación y monitoreo

- [ ] Healthchecks activos (`/health`, `/ready`) integrados al orquestador/orquestación
- [ ] Logs centralizados o accesibles (`docker compose logs -f api`)
- [ ] Procedimiento de actualización documentado y probado (`git pull` + `up -d --build`)
- [ ] Procedimiento de rollback definido (revertir commit + restaurar backup si aplica)
- [ ] Responsable on-call y runbook de incidentes conocidos (ver `DEPLOYMENT.md` §4)