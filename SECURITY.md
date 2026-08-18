# SECURITY — NEAGOLD

Modelo de seguridad, límites del sistema y guía de reporte de vulnerabilidades.

## Qué garantiza la plataforma

| Área | Garantía | Mecanismo |
|---|---|---|
| Autenticación | La contraseña se verifica contra Argon2id; respuesta anti-enumeración (timing y mensaje genéricos) | `api/src/auth/auth.service.ts` |
| Sesiones | Refresh token opaco, rotación por familia, revocación total ante reuso (posible robo) | Tabla `sessions` + `family_id` |
| Acceso | RBAC con 49 permisos sobre JWT firmado; CSRF por cookie síncrona + header | Guards globales (CSRF → Throttler → JWT → Permissions) |
| Abuso | Throttle global + throttle dedicado a login; lockout escalonado solo con fallos desde 2+ IPs (anti DoS) | `ThrottlerModule`, `login_attempts` |
| MFA | TOTP RFC 6238, secreto cifrado en reposo (AES-256-GCM, clave de entorno), recovery codes hasheados, desafíos de un solo uso con TTL | `api/src/mfa/` |
| Datos sensibles | Tokens y secrets nunca en claro en BD (sha256/Argon2id); audit_logs sin tokens | Hashes + auditoría |
| Trazabilidad | Historial append-only con FK `RESTRICT`, trigger de propietario único, transacciones auditadas | `ownership_records`, migración manual |
| Comunicación | TLS en producción (HSTS), CSP estricta en API y SPA, cookies `httpOnly + secure + SameSite=Lax` | helmet + nginx |
| Config | Fail-fast: en producción se rechazan placeholders y configs incompletas | `api/src/config/env.validation.ts` |

## Límites (L8/L9) — lo que la plataforma NO demuestra

### 1. `document_hash` es integridad, no firma (hash ≠ firma)
El `document_hash` de un certificado prueba que el documento descargado es
byte a byte el documento canónico almacenado en el momento de la emisión.
**No** demuestra quién lo emitió ni la autenticidad institucional: cualquier
entidad con acceso de escritura podría emitir certificados válidos para el
sistema. Eso solo lo resuelve una firma digital con PKI institucional
(X.509/PAdES), fuera del alcance actual. Si el negocio lo exige, la firma se
aplicaría **sobre el mismo documento canónico** (el sistema ya lo serializa de
forma estable para re-hasheo). El certificado debe presentarse como
"verificado por la plataforma NEAGOLD" y nunca como "firmado por una autoridad".

### 2. El QR es acceso, no autenticidad física (QR ≠ autenticidad)
El QR (token de 256 bits) autentica la **identidad digital** de la pieza ante
la plataforma: permite consultar su historial y verificar que el código
corresponde a la identidad registrada. **No** demuestra que el objeto físico
mostrado sea la pieza real: el QR puede imprimirse, copiarse o pegarse sobre
otra pieza. La identidad física (grabado del serial, inspección) sigue siendo
responsabilidad del proceso de venta/inspección humano. Un QR revocado
(`qr_codes.status = REVOKED`) se regenera como nueva edición: las ediciones
anteriores dejan de ser válidas, pero no invalidan la identidad de la pieza.

### 3. El hash de identidad no es una prueba judicial
`identity_hash` y el historial append-only garantizan detección de
manipulación *interna* (los datos solo crecen por INSERT auditado). No es
blockchain ni firma: la garantía depende de la integridad del operador y de
los backups. El historial es la fuente de verdad del sistema, no una
prueba forense de terceros.

### 4. MFA protege la cuenta, no el dispositivo
TOTP reduce el riesgo de robo de credenciales, pero una sesión ya iniciada
(robada) sigue siendo válida hasta su expiración/rotación; la familia de
refresh y el logout ayudan a contenerlo. El usuario es responsable de su
dispositivo y de sus recovery codes.

### 5. Lockout y throttle no detienen al atacante distribuido infinito
El throttling es por IP y el lockout por (email, IP) + umbrales por cuenta.
Un botnet suficientemente grande puede degradar la disponibilidad de login;
el límite global por IP y el reverse proxy limitan el impacto. Para
protección adicional se recomienda WAF/rate limiting a nivel de borde.

## Prácticas operativas requeridas

- **Backups**: ejecutar `scripts/backup.sh` (pg_dump comprimido) con retención
  diaria (ver `DATABASE.md`). Probar restores periódicamente.
- **Secretos**: nunca en Git; en producción usar un secret manager o variables
  de entorno del orquestador. `JWT_ACCESS_SECRET` y
  `MFA_SECRET_ENCRYPTION_KEY` deben ser únicos y rotables.
- **Actualizaciones**: aplicar parches de dependencias (`npm audit`) y de
  PostgreSQL/nginx antes de cada despliegue.
- **Logs**: `audit_logs` no contiene tokens; los logs de aplicación no deben
  loguear passwords ni secrets (verificar antes de reportar incidentes).

## Reporte de vulnerabilidades

Contacto para reportes responsables (fuera de GitHub, sin explotar sistemas):
**security@neagold.com**. Incluir pasos de reproducción, impacto y
sugerencia de mitigación. No publicar la vulnerabilidad antes del fix.