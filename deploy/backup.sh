#!/usr/bin/env bash
set -euo pipefail
umask 077

DATA_DIR="${DATA_DIR:-/var/lib/content-engine}"
DEST="${DEST:-/var/backups/content-engine}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$DEST"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

sqlite3 "$DATA_DIR/content.db" ".backup '$work/content.db'"
tar -czf "$DEST/content-$(date +%F).tar.gz" -C "$work" content.db -C "$DATA_DIR" workspace media
find "$DEST" -name 'content-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
