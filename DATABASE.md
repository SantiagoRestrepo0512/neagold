# DATABASE — NEAGOLD

Base de datos: **PostgreSQL 17+** · ORM: **Prisma 6** · Esquema: `public`

## Stack y ubicación

| Artefacto | Ruta |
|---|---|
| Esquema Prisma | `prisma/schema.prisma` |
| Migraciones | `prisma/migrations/` |
| Seed | `prisma/seed.ts` |
| Tests de integridad | `prisma/tests/integrity.spec.ts` |

## Modelos (26)

### Identidad y acceso
- `users` — email único, `password_hash` (Argon2id), `status`, `auth_stage` (preparado MFA), contadores de intentos fallidos y bloqueo.
- `roles`, `permissions`, `user_roles`, `role_permissions` — RBAC puro (4 roles semilla: CUSTOMER, STAFF, ADMIN, SUPER_ADMIN; 49 permisos).
- `sessions` — `refresh_token_hash` único (nunca el token crudo), `family_id` para rotación de refresh.
- `password_reset_tokens`, `email_verification_tokens` — tokens con hash, expiración y uso único, separados por propósito.

### Catálogo y piezas
- `products` — modelo (SKU único). Relación `PRODUCTO 1—N PIEZAS`.
- `jewelry_pieces` — unidad física: `internal_id`, `public_id` (ULID), `serial_number` (`NG-{año}-{000001}`) únicos; peso, pureza, material, fecha de fabricación, `status`.
- `serial_counters` — contador por año para seriales secuenciales sin duplicados bajo concurrencia.

### Identidad digital y QR
- `digital_identities` — `public_token` (256-bit, único, canónico e inmutable) + `identity_hash` (SHA-256 del payload canónico de la pieza).
- `qr_codes` — **ediciones del QR**, no la identidad: token único, `status ACTIVE/REVOKED`, `revoked_at`, `revoked_reason`. Regenerar QR = nueva fila + revocar anteriores. **El QR es solo un mecanismo de acceso, nunca la identidad.**

### Propiedad
- `ownership_records` — historial inmutable append-only: `start_date`, `end_date` (NULL = propietario actual), `acquisition_type`, `transfer_id`. La propiedad se reconstruye leyendo el historial.
- `ownership_transfers` — flujo PENDING → ACCEPTED/REJECTED/CANCELLED/EXPIRED; invite al `to_user`.
- `piece_claim_codes` — canje post-venta de un solo uso (`code_hash`, expiración).

### Comercial y servicios
- `sales` — `piece_id` único (una pieza se vende una vez), monto DECIMAL(12,2), factura única.
- `certificates` — `certificate_number` único (`NG-CERT-{año}-{12 hex}`), `type` (AUTHENTICITY/APPRAISAL/MAINTENANCE), `document_hash` (SHA-256 del **documento canónico** JSON de claves ordenadas; la descarga devuelve el mismo documento en claro para re-hasheo), `file_url` opcional, `status ACTIVE/REVOKED`, `issued_by` y `revoked_at`.
- `incidents` + `incident_reports` — robo/pérdida/fraude con estados y reportes numerados.
- `service_records` — mantenimiento (limpieza, reparación, ajuste, cambio de componentes, inspección): `status REQUESTED/IN_PROGRESS/COMPLETED/CANCELLED`, `requested_by`, `performed_by`, `scheduled_at`, `completed_at`.

### Operacional
- `audit_logs` — actor, acción, entidad, IP, user-agent, `metadata` JSONB. Nunca tokens ni secrets.
- `notifications` — tipo + payload JSONB.
- `idempotency_keys` — UNIQUE(key, request_path) con expiración para operaciones sensibles.

## Invariantes fuera del schema Prisma (migración manual)

En `20260815054940_init` (sección "SQL manual"):

1. **Partial unique index** `uq_ownership_transfers_one_pending_per_piece` — máximo una transferencia PENDING por pieza.
2. **Trigger** `trg_enforce_single_active_owner` — máximo un `ownership_records` abierto (`end_date IS NULL`) por pieza; defensa en profundidad frente a condiciones de carrera.
3. **CHECK** `chk_ownership_date_range` — `end_date ≥ start_date`.

## Convenciones

- PK `uuid` nativo de PostgreSQL (`gen_random_uuid()`), nunca IDs secuenciales expuestos.
- Timestamps `timestamptz(6)` UTC; `created_at` default `now()`, `updated_at` mantenido por Prisma.
- FKs `ON DELETE RESTRICT` (historial inmutable); `SET NULL` solo en actor/operador opcional; `CASCADE` solo en tablas efímeras (sesiones, tokens de verificación, notificaciones, joins RBAC).
- Nombres de columnas `snake_case`.

## Comandos

```bash
npm run db:migrate          # migrate dev (desarrollo, aplica + seed automático)
npm run db:migrate:deploy   # migrate deploy (aplicar migraciones pendientes)
npm run db:seed             # seed idempotente
npm run db:test:migrate     # aplicar migraciones a la BD de tests (.env.test)
npm run test:db             # migrar test DB + ejecutar tests de integridad
npm run generate            # regenerar Prisma Client
```

Bases locales: `neagold` (desarrollo) y `neagold_test` (tests). En producción usar `DATABASE_URL` real y un secret manager; el rol de la BD debe seguir el principio de mínimo privilegio.

## Acceso con psql (SQL Shell)

### Windows (instalación nativa)

`psql` no está en el PATH; se usa la ruta completa de la instalación:

```powershell
$env:PGPASSWORD="neagold_dev_password"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U neagold -h localhost -d neagold
```

Si la contraseña no está en la variable de entorno, psql la pide de forma
interactiva. Alternativa permanente: crear `%APPDATA%\postgresql\pgpass.conf`
con una línea `host:puerto:bd:usuario:contraseña` (permisos solo del usuario).

### Dentro de psql (comandos útiles)

```sql
\l                                   -- listar bases de datos
\dt                                  -- listar tablas del esquema actual
\d users                             -- estructura de una tabla (columnas, tipos, índices)
\d+ ownership_records                -- estructura + índices y triggers
\dn                                  -- esquemas
\dT+                                 -- enums (Tipos de estado, etc.)

SELECT email, status, last_login_at FROM users;
SELECT serial_number, status FROM jewelry_pieces;

-- Propietario actual de cada pieza (historial append-only, end_date NULL)
SELECT p.serial_number, u.email
FROM ownership_records o
JOIN jewelry_pieces p ON p.id = o.piece_id
JOIN users u ON u.id = o.owner_id
WHERE o.end_date IS NULL;

-- Incidentes abiertos
SELECT i.id, i.type, i.status, p.serial_number
FROM incidents i JOIN jewelry_pieces p ON p.id = i.piece_id
WHERE i.status IN ('ACTIVE', 'UNDER_REVIEW');

-- Desbloquear una cuenta (lockout por intentos fallidos)
UPDATE users SET failed_login_attempts = 0, locked_until = NULL
WHERE email = 'usuario@example.com';
```

Comandos útiles de psql: `\q` (salir), `\x` (pantalla expandida, útil para
filas con muchas columnas), `\g` o `;` para ejecutar, `\timing` (tiempo de
cada query), `\e` (editar la query en el editor).

### Linux / macOS / producción (Docker)

```bash
psql -U neagold -h localhost -d neagold          # cliente local
docker compose -f docker-compose.prod.yml exec postgres psql -U neagold -d neagold
```

> En producción la BD no publica puertos al host: solo se accede desde la red
> interna del compose (`docker compose exec`) o vía túnel/SSH.

## Backup y restore (producción)

Requerido: herramientas cliente de PostgreSQL (`pg_dump`, `psql`) en el servidor.

```bash
# Backup (comprimido, con retención de 14 días por defecto)
DATABASE_URL="postgresql://neagold:pass@host:5432/neagold" ./scripts/backup.sh
# Backup a un directorio concreto y retención personalizada
BACKUP_RETENTION_DAYS=30 DATABASE_URL="..." ./scripts/backup.sh /var/backups/neagold

# Restore (¡destructivo! pide confirmación)
DATABASE_URL="postgresql://neagold:pass@host:5432/neagold" \
BACKUP="/var/backups/neagold/neagold_20260817_030000.sql.gz" ./scripts/restore.sh
```

Automatización sugerida (cron, diario a las 03:00):

```
0 3 * * * cd /opt/neagold && DATABASE_URL="postgresql://..." ./scripts/backup.sh >> /var/log/neagold-backup.log 2>&1
```

Recomendado: copiar los backups fuera del servidor (almacenamiento
objetos/NFS) y **probar el restore** al menos una vez por trimestre.
En el despliegue con `docker-compose.prod.yml` la BD corre en el volumen
`neagold_pgdata`; los backups se generan desde fuera del contenedor.

## Datos semilla

`prisma/seed.ts` (idempotente por `upsert`):
- 4 roles + 49 permisos + mappings RBAC.
- `SUPER_ADMIN` (email/password vía `SEED_ADMIN_*`, Argon2id).
- Con `SEED_DEMO=true`: 3 productos, 3 piezas con identidad digital + QR, venta con código de reclamación canjeado y propiedad activa del cliente demo (`cliente@neagold.local`).

## Testing

`prisma/tests/integrity.spec.ts` (Vitest contra PostgreSQL real) — 17 tests:
- Unicidad: email, SKU, serial, internal_id, public_id, public_token, token QR, certificate_number.
- Integridad referencial: RESTRICT en delete de usuario con historial y de producto con piezas.
- Invariantes: partial index (PENDING único), trigger (1 propietario activo), CHECK fechas, enums válidos, venta única.
- Seed idempotente (doble ejecución sin duplicados).