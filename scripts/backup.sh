#!/usr/bin/env bash
# NEAGOLD - backup de PostgreSQL (comprimido en gzip).
# Uso (en el servidor de producción, con herramientas cliente de PostgreSQL):
#   DATABASE_URL="postgresql://neagold:pass@host:5432/neagold" ./scripts/backup.sh [directorio]
# Retención: se conservan los backups de los últimos BACKUP_RETENTION_DAYS días (default 14).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL es obligatorio (ej: postgresql://user:pass@host:5432/db)}"

DIR="${1:-./backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$DIR/neagold_${STAMP}.sql.gz"

mkdir -p "$DIR"
pg_dump "$DATABASE_URL" | gzip > "$FILE"

echo "Backup creado: $FILE ($(du -h "$FILE" | cut -f1))"

RETENTION="${BACKUP_RETENTION_DAYS:-14}"
PRUNED="$(find "$DIR" -name 'neagold_*.sql.gz' -mtime "+$RETENTION" -print)"
if [ -n "$PRUNED" ]; then
  echo "$PRUNED" | xargs -r rm -v
fi

# Sugerencia para automatizar con cron (todos los días a las 03:00):
#   0 3 * * * cd /opt/neagold && DATABASE_URL="..." ./scripts/backup.sh >> /var/log/neagold-backup.log 2>&1