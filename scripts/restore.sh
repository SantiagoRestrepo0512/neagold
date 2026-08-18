#!/usr/bin/env bash
# NEAGOLD - restore de PostgreSQL desde un backup de scripts/backup.sh.
# Uso (¡destructivo! reemplaza el contenido de la BD de DATABASE_URL):
#   DATABASE_URL="postgresql://neagold:pass@host:5432/neagold" \
#   BACKUP="./backups/neagold_20260817_030000.sql.gz" ./scripts/restore.sh
#   (o pasar el backup como primer argumento)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL es obligatorio}"
BACKUP="${BACKUP:-${1:-}}"
: "${BACKUP:?Indica el backup: BACKUP=archivo o primer argumento}"
[ -f "$BACKUP" ] || { echo "No existe el backup: $BACKUP" >&2; exit 1; }

echo "Se restaurará '$BACKUP' sobre la BD de DATABASE_URL."
echo "¡ATENCIÓN: los datos actuales se perderán!"
read -r -p "Escribe 'restaurar' para continuar: " CONFIRM
[ "$CONFIRM" = "restaurar" ] || { echo "Cancelado."; exit 1; }

gzip -dc "$BACKUP" | psql "$DATABASE_URL"
echo "Restaurado: $BACKUP"