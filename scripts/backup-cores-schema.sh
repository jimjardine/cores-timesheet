#!/usr/bin/env bash
# On-demand backup of just the Cores schema — handy as a manual checkpoint
# before a risky migration or bulk data change. The nightly GitHub Action
# (.github/workflows/backup-cores-schema.yml) does this automatically too.
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "Set SUPABASE_DB_URL (Supabase Dashboard -> Project Settings -> Database -> Connection string, direct/session URI, not the transaction pooler)." >&2
  exit 1
fi

OUT="cores_backup_$(date +%Y%m%d_%H%M%S).sql"
supabase db dump --db-url "$SUPABASE_DB_URL" --schema Cores -f "$OUT"
echo "Wrote $OUT"
