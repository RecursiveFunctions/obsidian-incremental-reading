#!/bin/bash
# Clone a real vault into a disposable copy for agent-driven smoke tests.
#   make-vault-real.sh [source-vault] [dest-vault]
# Copies notes, attachments and the existing .ir store, replaces the installed
# plugin with the current build, drops other community plugins, and disables
# Obsidian Sync so the copy never talks to the account.
set -e
SRC=${1:-/home/ray/Documents/vault}
DST=${2:-/tmp/ir-vault-real}
REPO=$(cd "$(dirname "$0")/../.." && pwd)

[ -d "$SRC/.obsidian" ] || { echo "not an Obsidian vault: $SRC" >&2; exit 1; }
[ -f "$REPO/main.js" ] || { echo "run npm run build first (main.js missing)" >&2; exit 1; }

rm -rf "$DST"
mkdir -p "$DST"
rsync -a --exclude '.obsidian/workspace.json' --exclude '.obsidian/workspace-mobile.json' \
  "$SRC/" "$DST/"

PLUGDIR="$DST/.obsidian/plugins"
rm -rf "$PLUGDIR"
mkdir -p "$PLUGDIR/incremental-reading"
cp "$REPO/main.js" "$REPO/manifest.json" "$REPO/styles.css" "$PLUGDIR/incremental-reading/"
echo '["incremental-reading"]' > "$DST/.obsidian/community-plugins.json"

python3 - "$DST/.obsidian/core-plugins.json" <<'PY'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path))
except Exception:
    data = {}
data["sync"] = False
json.dump(data, open(path, "w"), indent=4)
PY

echo "$DST"
