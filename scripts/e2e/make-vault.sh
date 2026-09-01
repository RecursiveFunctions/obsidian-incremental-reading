#!/bin/bash
# Build /tmp/ir-vault from scratch with the current build of the plugin.
# The e2e vault is disposable: everything here is regenerated on each run.
set -e
V=${1:-/tmp/ir-vault}
SRC=$(cd "$(dirname "$0")/../.." && pwd)
rm -rf "$V"
mkdir -p "$V/.obsidian/plugins/incremental-reading"
cp "$SRC/main.js" "$SRC/manifest.json" "$SRC/styles.css" "$V/.obsidian/plugins/incremental-reading/"
echo '["incremental-reading"]' > "$V/.obsidian/community-plugins.json"
cat > "$V/.obsidian/app.json" <<'JSON'
{"promptDelete":false}
JSON
cat > "$V/Reading.md" <<'MD'
# Reading

Alpha paragraph explains spaced repetition and the forgetting curve in
plain prose, long enough to be a realistic extract target.

Beta paragraph covers incremental reading, where extracts become the
next generation of cards without leaving the source note behind.

Gamma paragraph is here so the note has a third block to select across.

- first bullet mentions the queue order
- second bullet mentions the priority slider
MD
echo "vault at $V"
