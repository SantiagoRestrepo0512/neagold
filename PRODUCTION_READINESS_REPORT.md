# NEAGOLD — PRODUCTION READINESS REPORT

**Fecha**: 2026-08-17 · **Versión**: API 0.2.0 / Web 0.1.0

## Resumen ejecutivo

NEAGOLD está **lista para producción** dentro de los límites documentados en
`SECURITY.md`: la plataforma de identidad digital y trazabilidad (registro,
venta con reclamación post-venta, transferencias P2P, certificados verificables,
incidentes, servicios y webhooks firmados) pasó un ciclo completo de auditoría
de arquitectura y seguridad con correcciones aplicadas y verificadas por tests
automatizados contra PostgreSQL real.

**Estado de validación (2 corridas estables):**

| Suite | Resultado |
|---|---|
| e2e (14 specs) | **102/102** |
| unit (5 specs) | **42/42** |
| Integridad de BD + seed idempotente | **17/17** |
| Lint API (eslint src + test) | limpio |
| Build API (NestJS) | ok |
| Build Web (vue-tsc + vite) | ok |
| Migraciones (6) sobre BD de tests | aplicadas sin pendientes |

## Cobertura por fase

| Fase | Alcance | Estado |
|---|---|---|
| F1 | API base: NestJS, Prisma, salud, configuración validada | ✅ |
| F2 | Seguridad crítica: entropía 128 bits de claims, redacción de logs, SSRF webhooks, bloqueo transfer+venta, dummy verify, IN_SERVICE, incidente único, JWT issuer/audience/jti, throttles | ✅ |
| F3 | Idempotencia con respaldo en PostgreSQL (slot único por usuario, replay, concurrencia), driver adapter, fix de race en infra de tests | ✅ |
| F4 | Auth endurecida: lockout distribuido por IP, MFA TOTP (setup/recover), sesiones con rotación y familias, 17 unit + e2e | ✅ |
| F5 | Producción: Dockerfiles (slim, no Alpine), compose prod con migración one-shot, CSP/HSTS, graceful shutdown, fail-fast de env, backup/restore, SECURITY.md | ✅ |
| F6 | Tests: entropía de claims, bloqueos cruzados, SSRF, throttles, incidente concurrente, services → IN_SERVICE; suite completa verificada | ✅ |
| F7 | Documentación: DEPLOYMENT.md, PRODUCTION_CHECKLIST.md, este reporte, README y psql | ✅ |
| F8 | Integridad de BD (17 tests) + seed demo idempotente | ✅ |
| F9 | SPA Vue completa (productos, piezas, ventas, claims, transferencias, certificados, servicios, incidentes, webhooks, notificaciones, verificación pública) | ✅ |

## Threat model — estado final

| Amenaza | Mitigación implementada |
|---|---|
| Brute force de claim codes | Hash en BD + 128 bits de entropía + throttle |
| Robo de propiedad vía transfer+venta | Venta/canje bloqueados con transferencia PENDING; partial unique index por pieza |
| SSRF vía webhooks | Validador de destino (protocolo, credenciales, puertos, IPs privadas/reservadas, DNS en entrega) |
| Account takeover (reset token) | Tokens de 256 bits hasheados, single-use, con expiración; redacción en logs |
| Enumeración de usuarios | Respuestas genéricas + dummy argon2 (timing constante) |
| Brute force login | Throttle 15/min por IP + lockout con ventana (single-IP sin bloqueo, multi-IP con bloqueo) |
| Token theft (XSS) | Cookies httpOnly + SameSite=Lax, CSP estricta, CSRF double-submit |
| Replay CSRF | Doble submit + SameSite=Lax |
| Race claims/transfer/serial | Constraints en BD (índices parciales únicos, trigger de owner único) + e2e de concurrencia |
| Manipulación del historial | Append-only con FK RESTRICT + trigger owner único; hash encadenado evaluado y descartado (ver §5 del audit) |

## Garantías y límites (resumen de SECURITY.md)

- **Hash ≠ firma**: los certificados son verificables por hash del documento
  canónico, no firmados (sin PKI). La firma sobre el mismo documento canónico
  está lista para añadirse si el negocio lo exige.
- **QR ≠ autenticidad física**: el QR autentica la identidad digital de la pieza,
  no demuestra que el objeto físico coincida. La verificación pública lo indica.
- **Auditoría**: cada acción sensible queda en `audit_logs` (actor, acción,
  entidad, IP, UA, metadata) sin tokens ni secrets.
- **Email**: el envío real requiere SMTP; en producción es obligatorio
  (fail-fast). En dev/test los enlaces se devuelven en la respuesta.

## Despliegue

- Local: `npm install` → postgres → `npm run db:migrate` → `api: npm run start:dev`
  → `web: npm run dev`. URLs y credenciales en `README.md` y `DEPLOYMENT.md`.
- Producción: Docker Compose v2.20+ (`docker-compose.prod.yml`), nginx expuesto
  en :80, TLS por reverse proxy frontal, migraciones one-shot, backups con
  retención y restore probado. Checklist en `PRODUCTION_CHECKLIST.md`.

## Riesgos residuales y recomendaciones post-go

1. **Revisar límites de negocio**: throttling global (120/min por IP) y de login
   (15/min por IP) según el volumen esperado.
2. **Probar el despliegue en un entorno staging** con las imágenes Docker
   reales (en el equipo de desarrollo no había Docker disponible; los comandos
   de los stages se validaron en limpio contra PostgreSQL real).
3. **Firma digital** de certificados si el mercado lo exige (preparado sobre el
   documento canónico).
4. **Monitoreo**: exponer `/health` y `/ready` al orquestador y vigilar
   `failureCount` de webhooks.
5. **Rotación** de la password del seed y de los secretos en el primer
   despliegue de producción.
6. **Escalado**: el bus de eventos es in-process (single instance). Para N
   réplicas de la API se requiere un bus externo (Redis/Postgres LISTEN-NOTIFY)
   y re-evaluar la idempotencia multi-instancia (ya persistida en BD).