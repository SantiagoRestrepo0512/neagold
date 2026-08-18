# NEAGOLD — Auditoría de arquitectura y seguridad

Fecha: 2026-08-17
Alcance: repositorio completo (api/, web/, prisma/, docker/, scripts raíz).
Estado: **FASES 1–9 CERRADAS — plataforma verificada para producción**
(e2e 102/102, unit 42/42, integridad BD 17/17, lint y builds limpios).
Siguiente: go-live — seguir `PRODUCTION_CHECKLIST.md`.

---

## 1. Arquitectura

Monorepo npm workspaces (`api`, `web`), Prisma en la raíz, PostgreSQL 17 en
Docker. Stack: NestJS 11 + Prisma 6 + PostgreSQL 17 (backend), Vue 3 + Vite 6 +
Pinia + Vue Router (SPA), Vitest (tests). No hay framework UI externo.

```
/api/v1/*   → módulos autenticados (auth, users, products, pieces, sales,
              claims, transfers, certificates, services, incidents,
              notifications, webhooks)
/verify/*   → portal público de verificación (sin auth)
/health     → liveness
/ready      → readiness (SELECT 1)
```

Pipeline de guards (global): `CsrfGuard → ThrottlerGuard → JwtAuthGuard →
PermissionsGuard`. Filtro de excepciones global, interceptor de logging con
redacción, middleware de request-id.

### Lo que ya está bien implementado (no tocar)

- Refresh token con rotación + familias + revocación de familia ante reuse.
- Refresh tokens almacenados solo como SHA-256; tokens de verificación/reset
  opacos de 256 bits almacenados hasheados.
- Argon2id (m=19MiB, t=2, p=1), política de contraseña 12–128 con complejidad.
- CSRF double-submit cookie + header con comparación timing-safe.
- RBAC con 49 permisos + 4 roles; `SUPER_ADMIN = '*'`; permisos firmados en JWT.
- Rate limiting global + específico (register 5/min, login 15/min, reset 3/min).
- Bloqueo de cuenta (5 fallos → 15 min), anti-enumeración en respuestas.
- Validación estricta de DTOs (whitelist + forbidNonWhitelisted).
- Historial de propiedad append-only con trigger SQL que impide dos propietarios
  activos (`piece_already_has_active_owner`), partial unique index para una sola
  transferencia PENDING por pieza, CHECK de rango de fechas.
- Claims single-use con flip condicional `PENDING → USED` (concurrencia segura).
- Códigos de reclamación: almacenados como hash, canje restringido al comprador.
- Webhooks HMAC-SHA256 con backoff exponencial, auto-desactivación y claim
  atómico `PENDING → DELIVERING`.
- Certificados con documento canónico (claves ordenadas) + SHA-256 + re-hash por
  descarga.
- Seriales/invoices/reportes secuenciales por año vía `serial_counters.upsert`.
- Auditoría (~40 acciones) con redacción de secretos; errores sin stack traces
  al cliente; validación de env con fail-fast.
- Identidad digital: token público 256 bits, QR con ediciones revocables,
  endpoint público que no expone emails/ids internos.

---

## 2. Hallazgos y prioridades

### CRITICAL

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| C1 | **Códigos de reclamación con solo 32 bits de entropía** (`NG-CLAIM-{año}-{8 hex}`) | `api/src/common/utils/tokens.ts:25` | El código es la prueba de compra y transfiere propiedad. Con 2^32 combinaciones es forzable por brute force (limitado por throttle pero factible con tiempo/IPS). |
| C2 | **Tokens de reset/verificación y de verificación pública quedan en los logs de la URL** | `api/src/common/interceptors/logging.interceptor.ts:44` loguea `request.originalUrl` | Un reset token (256 bits) en logs = riesgo de account takeover si los logs se filtran. |
| C3 | **SSRF en webhooks salientes**: la URL destino se envía a `fetch` sin validar direcciones privadas | `api/src/webhooks/webhooks.service.ts:241`; `create-webhook.dto.ts:5` permite http/https sin restricción | Un atacante autenticado puede usar la API como proxy para alcanzar la red interna (metadata cloud, localhost, etc.). |
| C4 | **Venta/canje de pieza con transferencia PENDING pendiente → robo de propiedad** | `api/src/sales/sales.service.ts` y `claims.service.ts` no verifican transferencias pendientes; `transfers.accept` cierra el ownership activo sin revalidar | Staff vende una pieza con transferencia pendiente; el destinatario de la transferencia acepta después y se queda con la propiedad del comprador real. |

### HIGH

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| H1 | **Idempotencia no implementada** (tabla lista, sin middleware) | `prisma/schema.prisma:593`, README | Retries duplican ventas, transferencias, certificados, servicios. |
| H2 | **MFA no implementado** (solo enum `authStage` en schema) | `prisma/schema.prisma:32` | Sin segundo factor para cuentas privilegiadas/transferencias. |
| H3 | **Email solo en modo dev** (devuelve URLs en la respuesta) | `api/src/auth/auth.service.ts:87-90,126,144,362` | En producción no hay envío real. |
| H4 | **Timing oracle en login**: si el email no existe no se ejecuta argon2 | `api/src/auth/auth.service.ts:187` | Enumeración de usuarios por diferencia de tiempo. |
| H5 | **El flujo de servicio nunca pone la pieza en `IN_SERVICE`** | `api/src/services/services.service.ts:89-92` (start no toca la pieza) | El estado documentado `IN_SERVICE` es inalcanzable; la lógica de `complete()` que devuelve a `AVAILABLE` solo aplica si el estado se setea manualmente por otro camino. |
| H6 | **Dos incidentes abiertos concurrentes por pieza** (sin constraint en BD) | `api/src/incidents/incidents.service.ts:79-84` | Race: dos reports simultáneos crean dos incidentes ACTIVE. |
| H7 | **JWT sin issuer/audience/jti** | `api/src/auth/auth.service.ts:84`, `jwt.strategy.ts` | Tokens no acotados a emisor/audiencia; sin replay-flag por token. |
| H8 | **URL de verificación hardcodeada** `https://neagold.com/verify/{token}` | `pieces.service.ts:122,269`, `claims.service.ts:103` | Incorrecta para cualquier despliegue; rompe QR en producción real. |
| H9 | **Sin rate limiting en `/verify/:token`, verify-email, reset-password, refresh** | controllers | Abuso/enumeración del endpoint público y de endpoints sensibles. |

### MEDIUM

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| M1 | **Sesiones sin IP/user-agent capturados** (columnas existentes) | `auth.service.ts:252-265` | Sin detección de anomalías de sesión. |
| M2 | **`verify` público expone `piece.id` (UUID interno) y nombre del propietario** | `verification.service.ts:42,58-60` | Fuga menor de datos internos; el nombre del propietario es dato personal expuesto sin consentimiento. |
| M3 | **Certificados: un propietario histórico puede descargar el documento** (`canView` sin filtrar `endDate`) | `certificates.service.ts:238-243` | Un ex-propietario mantiene acceso al documento. |
| M4 | **Account lockout DoS**: bloqueo por usuario sin considerar IP/distribución | `auth.service.ts:231-250` | Un atacante puede bloquear cuentas de terceros adivinando 5 contraseñas. |
| M5 | **Sin CSP ni personalización de security headers** (helmet por defecto) | `api/src/main.ts:17` | Mitigación XSS subóptima para la SPA. |
| M6 | **Sin graceful shutdown** (`enableShutdownHooks` no llamado) | `api/src/main.ts` | Conexiones Prisma/requests truncadas al terminar. |
| M7 | **Webhooks creados con `http` permitido en todos los entornos** y sin verificación del host en update | `create-webhook.dto.ts:5` | Reforzar HTTPS en producción + SSRF check también en update. |
| M8 | **Refresh sin throttle y con skip de CSRF** | `auth.controller.ts:64-75` | Endpoint sensible sin protección de tasa (token 384 bits mitiga brute force, pero conviene límite). |
| M9 | **`registerFailedAttempt` puede actualizar en race** (increment atómico OK, lockout check fuera de transacción) | `auth.service.ts:231-250` | Doble lock harmless, pero el conteo puede quedar inconsistente con concurrencia; revisar. |
| M10 | **`devLink` expone URLs de reset/verify en respuestas incluso en `test`** | `auth.service.ts:88` | Aceptado como trade-off dev/test, documentar en prod. |
| M11 | **Cambio de contraseña no distingue sesión actual**: revoca todas (UX) y el cliente asume relogin; documentado | `auth.service.ts:399-417` | Info. |
| M12 | **`updateProfile`**: verificar que no permita cambiar `status`/`email` (whitelist) | `users/dto/update-profile.dto.ts` | Revisado en fase de verificación. |
| M13 | **Ninguna integración de email/notificaciones hacia el webhook `claim.available`** (evento existe, sin emisor) | `events.service.ts` WEBHOOK_EVENTS | Bajo. |

### LOW / INFO

| # | Hallazgo |
|---|---|
| L1 | Sin contenedores Docker para api/web (solo postgres). |
| L2 | Sin estrategia de backups/restore. |
| L3 | `.env.example` incompleto para producción (MFA, email, verify URL, etc.). |
| L4 | `VITE_API_ORIGIN` no documentado en `.env.example` del web (no existe archivo). |
| L5 | `npm audit` pendiente de ejecutar (fase de verificación). |
| L6 | Seed hace `deleteMany` de `role_permissions` (idempotente pero destructivo si hay roles custom). |
| L7 | `changeOrigin: false` en proxy de Vite (dev ok; documentar para despliegue). |
| L8 | Certificados sin firma digital (hash ≠ firma). Documentar en SECURITY.md. |
| L9 | El QR por sí solo no prueba la autenticidad física de la pieza (documentar en la UI pública). |
| L10 | `idempotency_keys` sin columna `user_id` (scope por usuario requerido). |

---

## 3. Threat model (resumen)

Actores: anónimo, cliente, propietario, staff, admin, atacante externo,
atacante autenticado, cuenta comprometida, sistema externo vía webhook.

| Amenaza | Prob. | Impacto | Mitigación actual | Gap |
|---|---|---|---|---|
| Brute force de claim codes | Media | Alto | Hash en BD + throttle | Entropía 32 bits (C1) |
| Robo de propiedad vía transfer+venta | Baja | Crítico | — | Falta bloqueo (C4) |
| SSRF vía webhooks | Media | Alto | — | Falta validación (C3) |
| Account takeover (reset token) | Baja | Crítico | Tokens 256 bits hasheados | Logs exponen tokens (C2) |
| Enumeración de usuarios | Media | Medio | Respuestas genéricas | Timing oracle (H4) |
| Brute force login | Alta | Alto | Throttle + lockout | DoS por lockout (M4) |
| Token theft (XSS) | Media | Alto | httpOnly + SameSite | Sin CSP (M5) |
| Replay CSRF | Baja | Alto | Double-submit + Lax | OK |
| Race en claims/transfer/serial | Media | Alto | Flip condicional + constraints | Cubierto (FASE 6): e2e concurrentes + índices únicos |
| Manipulación del historial | Baja | Crítico | RESTRICT + trigger owner único | Falta hash encadenado (evaluado, ver §5) |

---

## 4. Plan de corrección

### FASE 2 — Seguridad crítica (CRITICAL + HIGH)
- C1: entropía de claim codes → 128 bits (16 bytes).
- C2: sanitizar URL en logs + redactar `currentPassword`/`csrfToken`.
- C3: validación de URL de webhook (bloqueo de IPs privadas/reservadas,
  HTTPS en producción) en create y update.
- C4: bloquear venta/canje cuando exista transferencia PENDING de la pieza.
- H4: dummy verify argon2 para usuarios inexistentes.
- H5: `services.start` marca la pieza `IN_SERVICE`.
- H6: partial unique index para un incidente abierto por pieza.
- H7: issuer/audience/jti en JWT.
- H8: URL pública configurable (`PUBLIC_BASE_URL`).
- H9: throttles en `/verify`, verify-email, reset-password, refresh.

### FASE 3 — Integridad
- H1: middleware/interceptor de idempotencia con respaldo en PostgreSQL
  (columna `user_id`, UNIQUE (user_id, key, request_path), expiración,
  respuesta original rejugable, concurrencia segura).
- Revisión de transacciones existentes (ya correctas en transfer/claim/venta).
- Tests de concurrencia explícitos.

### FASE 3 — Integridad ✅ CERRADA (2026-08-17)

- H1: interceptor global de idempotencia (`IdempotencyInterceptor`) con
  respaldo en PostgreSQL: slot único `(user_id, key, request_path)` con
  `NULLS NOT DISTINCT`, expiración 24 h, replay de la respuesta original con
  `X-Idempotency-Replayed: true`, serialización de peticiones concurrentes
  (winner reserva slot; losers esperan el resultado del winner), solo se
  almacenan 2xx (errores borran el slot y permiten reintento).
- L10: columna `user_id` + índice único manual en migración
  `20260817020000_idempotency_user_scoped` (aplicada).
- Prisma: migración del query engine a driver adapter (`@prisma/adapter-pg` +
  `pg`) en `PrismaService` y helpers de test. Elimina el proceso externo del
  engine (falla "Response from the Engine was empty" observada en Prisma 6.x
  bajo carga concurrente en tests).
- 6 tests e2e de idempotencia, incl. concurrencia (`serializa peticiones
  concurrentes`), estables.

**Fixes de infraestructura de testing (mismo día):**

- **Race de supertest (ECONNRESET intermitente en el test de concurrencia)**:
  causa raíz en el lifecycle de supertest, NO en la app. Cuando el servidor no
  está escuchando al construir un request, supertest llama `listen(0)` y lo
  CIERRA tras cada respuesta (`test.js:serverAddress` + `end`), re-abriendo en
  un puerto nuevo. Con requests concurrentes en el mismo tick, la construcción
  dispara múltiples `listen(0)`/lecturas de puerto en carrera → algunos requests
  apuntan a puertos stale/cerrados → `read ECONNRESET` (artefacto, no del engine
  ni de PostgreSQL). Fix: `api/test/test-server.ts` — `listenForTests(app)` hace
  pre-listen del servidor una vez en `beforeAll` para que `address()` nunca sea
  null y supertest nunca lo cierre. Aplicado a los 9 specs e2e.
- **Helper `dbErrorCode` (test:db)**: con el adapter-pg, los errores raw llegan
  como `DriverAdapterError` con el SQLSTATE en `cause.code` (no `meta.code`).
  Ajustado en `prisma/tests/integrity.spec.ts`. Los 17 tests de integridad
  verifican los constraints reales de PostgreSQL.
- Eliminados specs de debug residuales (`debug-csrf`, `idemdiag`) que corrían
  con la suite.

### FASE 4 — Auth (completada)
- **H2: MFA TOTP** (`api/src/mfa/`): `totp.ts` implementa RFC 6238 con
  `node:crypto` (HMAC-SHA1, 6 dígitos, 30 s, ±1 paso), verificado con los
  vectores oficiales. El secreto se cifra en reposo con AES-256-GCM
  (`MFA_SECRET_ENCRYPTION_KEY`, hex 64 chars, obligatoria) en formato
  `v1:iv:tag:data`. Códigos de recuperación: 10× Crockford de 10 chars,
  almacenados hasheados con sha256. `mfa_challenges` son de un solo uso con
  TTL de 5 min y máx. 5 intentos (al superarlos se revoca el desafío). Flujo:
  login con MFA habilitado responde `{ mfaRequired: true, challengeToken }`
  **sin cookies**; `POST /auth/mfa/verify` o `POST /auth/mfa/recover`
  completan el login (cookies access+refresh). Endpoints
  `/auth/mfa/setup|verify-setup|disable` con JWT + throttle 10/min;
  `mfa/verify` y `mfa/recover` públicos con throttle 5/min. Auditoría:
  MFA_ENABLED, MFA_DISABLED, MFA_VERIFIED, MFA_FAILED, MFA_RECOVERED.
- **H3: EmailProvider** (`api/src/email/`): interfaz `EMAIL_PROVIDER` con
  `DevEmailProvider` (default; expone `devVerifyUrl`/`devResetUrl` solo en
  dev/test) y `SmtpEmailProvider` (nodemailer, se activa solo si `SMTP_HOST`
  está definido y exige SMTP_USER/SMTP_PASS/EMAIL_FROM). Inyectado en
  register/resend/forgot-password.
- **M1: sesiones con IP/user-agent**: `login`, `refresh`, `completeLogin` y
  `verifyMfaChallenge` capturan `clientIp`/`clientUserAgent` (con soporte de
  `X-Forwarded-For`) y los persisten en `sessions` (columnas preexistentes).
- **M4: lockout DoS** (`login_attempts`): ventana de 15 min por (email, IP).
  **Semántica deliberada**: una sola IP (brute force, ya throttled) NUNCA
  bloquea la cuenta; el lockout escalonado (5 fallos→15 min, 8→1 h, 10→24 h)
  solo se activa cuando los fallos vienen de 2+ IPs distintas en la ventana
  (ataque distribuido). El éxito limpia ventana y contador. La cuenta bloqueada
  responde HTTP 423 con `code: ACCOUNT_LOCKED` (el filter respeta el
  `statusCode` explícito del body del exception).
- **M8: throttle de login env-driven**: el decorador `@Throttle` es estático
  (no puede leer el constructor) y ThrottlerGuard v6 no expone getLimit/getTtl,
  así que se usa un throttler nombrado `'login'` con `skipIf` en
  `ThrottlerModule.forRootAsync` aplicado solo a `/auth/login`
  (`LOGIN_THROTTLE_LIMIT=15` prod / 100 test).
- **M2: privacidad en /verify**: `piece.id` interno eliminado de la respuesta y
  el nombre del propietario queda detrás de `VERIFY_OWNER_NAME` (off por
  defecto; el e2e existente lo activa en `.env.test`).
- **Env nuevos**: MFA_SECRET_ENCRYPTION_KEY, TOTP_ISSUER, VERIFY_OWNER_NAME,
  PUBLIC_BASE_URL, SMTP_HOST/PORT/USER/PASS, EMAIL_FROM,
  LOGIN_THROTTLE_LIMIT, LOGIN_THROTTLE_TTL_MS.
- **Migraciones** (6 total): `20260817030000_mfa_and_login_attempts` crea
  `mfa`, `mfa_challenges`, `login_attempts`; `20260817031000_mfa_recovery_codes_text_array`
  corrige el mapeo de `String[]`: Prisma genera `TEXT[]` nativo de pg (no
  JSONB), por lo que la columna inicial JSONB se convirtió con columna temporal
  (ALTER USING no admite subconsultas y no hay cast implícito jsonb→text[]).
  Aplicadas a dev (neagold) y test (neagold_test).
- **Ajustes de infraestructura de testing**: `prisma/tests/helpers.ts` limpia
  las 3 tablas nuevas; el filtro HTTP respeta `statusCode` explícito en el body
  del exception (contrato del 423). Validación: e2e 88/88 (×2 corridas), unit
  34/34, test:db 17/17, lint y build limpios.

### FASE 5 — Producción (completada)
- **L1: Dockerfiles multi-stage** (`api/Dockerfile`, `web/Dockerfile`) +
  `docker-compose.prod.yml`:
  - `api`: stages build (npm ci + prisma generate + nest build), `prisma`
    (CLI para migraciones one-shot) y runtime. **Debian slim, no Alpine**:
    argon2 solo publica prebuilds glibc (sin linuxmusl-x64). Runtime con
    `npm ci --omit=dev` + overlay del Prisma Client generado (`.prisma`);
    usuario `node` no root; healthcheck vía `node fetch` (slim no trae wget);
    dependencias del workspace raíz (@prisma/adapter-pg, pg, argon2) exigen
    `npm ci` sin `-w`.
  - `web`: build Vue en alpine + nginx:1.27-alpine con `nginx.conf` propio
    (pid en /tmp, logs a stderr, usuario no root): SPA fallback, caché
    inmutable de assets, proxy same-origin de `/api` y `/verify` hacia la API
    (cookies SameSite=Lax sin problemas de origen cruzado).
  - `docker-compose.prod.yml`: postgres sin puertos publicados, servicio
    `migrate` one-shot (`target: prisma`, `service_completed_successfully`),
    api con healthcheck, web expuesta en :80. Requiere Compose v2.20+.
  - Validado sin docker (no disponible en el equipo): los 3 comandos npm de
    los stages se ejecutaron en limpio (temp dir) con query real a la BD vía
    adapter-pg + argon2 + overlay del cliente generado.
- **M5: helmet con CSP**: la API declara CSP explícita (default-src 'self',
  frame-ancestors 'none', form-action/base-uri restringidos,
  upgrade-insecure-requests + HSTS solo en producción). La SPA envía CSP
  estricta + X-Content-Type-Options, Referrer-Policy, X-Frame-Options y
  Permissions-Policy desde nginx (Vue aplica estilos dinámicos → style-src
  con 'unsafe-inline'; connect-src 'self' cubre el proxy).
- **M6: graceful shutdown**: `enableShutdownHooks(['SIGTERM','SIGINT'])` en
  bootstrap (desactivado en `test` para no interferir con la suite); el cierre
  ordenado ejecuta onModuleDestroy: Prisma `$disconnect` y el timer del worker
  de webhooks.
- **L3/L4: env y fail-fast**: `.env.example` completo (JWT_ISSUER/JWT_AUDIENCE
  añadidos, sección Producción documentada). `validateEnv` en producción
  REJECTA: placeholders de JWT/MFA, CORS_ORIGINS vacío y ausencia de SMTP
  (los emails no pueden caer al provider de desarrollo). Verificado con tsx
  (config válida arranca; placeholders fallan con mensajes claros).
- **L2: backup/restore**: `scripts/backup.sh` (pg_dump | gzip con retención
  configurable y sugerencia de cron) y `scripts/restore.sh` (con confirmación
  explícita). Documentados en `DATABASE.md`.
- **L8/L9: límites documentados en `SECURITY.md`**: hash ≠ firma (sin PKI; la
  firma se aplicaría sobre el documento canónico), QR ≠ autenticidad física
  (el QR autentica la identidad digital, no el objeto), garantías por área,
  prácticas operativas y canal de reporte.
- Validación: e2e 88/88, unit 34/34, lint/build api y web limpios.

### FASE 6 — Tests ✅
- **Entropía de claims** (`test/claims.e2e-spec.ts`): 3 ventas → códigos
  `NG-CLAIM-{año}-{32 hex mayúsculas}` únicos entre sí y con sufijos
  distintos (128 bits); en BD solo `code_hash` (sha256, 64 hex) — el código
  en claro nunca se persiste y no aparece entre los hashes; canje de un solo
  uso (409 en el segundo intento).
- **Bloqueos cruzados venta/transferencia/canje** (`test/sale-transfer-block.e2e-spec.ts`):
  una transferencia PENDING bloquea la venta (400) aunque la pieza esté en
  stock; una transferencia PENDING post-venta bloquea el canje (409) y su
  cancelación lo desbloquea (canje 201 + ownership CLAIM del comprador).
  El escenario post-venta se simula insertando la transferencia directo en
  BD (ventana de carrera entre venta y canje, inalcanzable por API).
- **SSRF** (`test/webhooks.e2e-spec.ts` + `src/webhooks/webhook-target.validator.spec.ts`):
  e2e: protocolos no http(s) → 400, credenciales embebidas → 400, puertos
  sensibles (5432) → 400, CRUD completo con secreto de un solo uso y
  rotación. Unit (lookup de DNS mockeado): producción rechaza loopback,
  privadas, link-local, sin resolución y http; acepta IP pública; desarrollo
  permite loopback sin consultar DNS.
- **Throttles** (`test/auth.e2e-spec.ts`): 429 en login (emails inexistentes
  rotativos: la verificación dummy evita que el lockout de cuenta enmascare
  el throttle) y 429 en mfa/verify (6+ intentos, límite 5/min).
- **Incidente concurrente** (`test/incidents.e2e-spec.ts`): dos reportes
  simultáneos de la misma pieza → uno 201 y el otro 409 con el mensaje
  específico. El partial unique index `uq_incidents_one_open_per_piece` ya
  existía (migración); se añadió el catch de P2002 en `incidents.service.ts`
  para devolver `ConflictException` semántica en lugar del 409 genérico.
- **Servicios → IN_SERVICE** (`test/certificates-services.e2e-spec.ts`):
  el test de start() ahora además verifica que la pieza pasa a IN_SERVICE
  (complete() → AVAILABLE ya estaba cubierto).
- Verificación completa (2 corridas): e2e **102/102**, unit **42/42**
  (5 specs, incl. el nuevo validador), integridad BD **17/17**, lint y
  build api + web limpios.

### FASE 7 — Documentación y reporte final ✅
- `DEPLOYMENT.md`: arquitectura, despliegue local (PowerShell) y producción
  (Docker Compose v2.20+), generación de secretos, TLS, actualización/rollback,
  backups y troubleshooting (argon2/glibc, fail-fast, lockout, P2002).
- `PRODUCTION_CHECKLIST.md`: checklist operativa pre-go-live (secrets, BD, red,
  verificación funcional, seguridad y operación).
- `PRODUCTION_READINESS_REPORT.md`: reporte final de readiness — fases F1–F9,
  threat model con mitigaciones aplicadas, métricas de validación (e2e 102/102,
  unit 42/42, integridad 17/17) y riesgos residuales.
- `README.md` actualizado: quick start real (URLs, credenciales del seed
  completo: SUPER_ADMIN/STAFF/CUSTOMER), acceso con psql, scripts, módulos,
  sección de producción y estado.
- `DATABASE.md`: sección "Acceso con psql (SQL Shell)" — ruta Windows real
  (`C:\Program Files\PostgreSQL\18\bin\psql.exe`), conexión verificada contra
  la BD local, queries operativas (propietario actual, incidentes abiertos,
  desbloqueo de cuenta) y acceso en Docker.
- `api/package.json`: script `test:unit` (vitest.unit.config.ts) documentado
  en el README.

---

## 5. Decisiones evaluadas y descartadas

- **Hash encadenado del historial**: el historial ya es append-only con
  FK RESTRICT y trigger de owner único; el hash encadenado no aportaría
  detección de manipulación extra para datos que solo crecen por INSERT
  dentro de transacciones auditadas. Se documenta en SECURITY.md en lugar de
  añadir complejidad (regla: elegir la solución más simple y segura).
- **Firma digital de certificados**: hash ≠ firma. Sin PKI institucional no
  hay firma que demuestre quién emitió; se documenta el límite. Si el negocio
  lo exige, la firma sería sobre el mismo documento canónico (lista para ello).
- **Blockchain**: no hay necesidad técnica real (inmutabilidad ya cubierta por
  append-only + RESTRICT + auditoría).
- **MFA obligatorio vía SMS**: descartado; TOTP, sin dependencias nuevas en la
  API (node:crypto), `qrcode` solo en el frontend para mostrar el setup.
