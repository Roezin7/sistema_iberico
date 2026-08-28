#!/usr/bin/env bash
set -Eeuo pipefail

# Run from the server/Coolify environment. The script never prints a URL or a
# password. A restore is deliberately opt-in and must point to a separate
# database; production is only read as the backup source.
: "${DATABASE_READONLY_URL:?Define DATABASE_READONLY_URL para respaldar}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/iberico-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/iberico-${STAMP}.dump"

echo "[1/4] Respaldando producción (sólo lectura)…"
pg_dump --format=custom --no-owner --no-privileges --file="$BACKUP_FILE" "$DATABASE_READONLY_URL"
pg_restore --list "$BACKUP_FILE" >/dev/null
echo "[2/4] Backup válido: $BACKUP_FILE"

if [[ "${ALLOW_RESTORE:-}" == "YES" ]]; then
  : "${RESTORE_DATABASE_URL:?Define RESTORE_DATABASE_URL para restaurar en una base aislada}"
  if [[ "$RESTORE_DATABASE_URL" == "$DATABASE_READONLY_URL" ]]; then
    echo "RESTORE_DATABASE_URL debe ser distinta del origen de producción" >&2
    exit 2
  fi
  echo "[3/4] Restaurando en destino aislado…"
  pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error \
    --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
  echo "[4/4] Restauración verificada en destino aislado."
else
  echo "[3/4] Restauración omitida: define ALLOW_RESTORE=YES y RESTORE_DATABASE_URL aislada."
  echo "[4/4] El backup queda listo para restauración controlada."
fi
