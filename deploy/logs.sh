#!/usr/bin/env bash
# ============================================================================
# 日志：跟踪服务日志（systemd 或 nohup 自适应）
# 用法：./deploy/logs.sh [行数，默认 100]
# ============================================================================
set -euo pipefail
APP_NAME="transferhub-server"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINES="${1:-100}"

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "$APP_NAME"; then
  journalctl -u "$APP_NAME" -n "$LINES" --no-pager
else
  [ -f "$DIR/data/nohup.log" ] || { echo "暂无日志：$DIR/data/nohup.log"; exit 0; }
  tail -n "$LINES" "$DIR/data/nohup.log"
fi
