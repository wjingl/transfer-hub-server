#!/usr/bin/env bash
# ============================================================================
# 更新：停服 → 备份数据 → 替换代码（保留 data/ 与 config.json/secrets）→ 重启
# 用法：./deploy/update.sh <新部署包目录或 tar.gz 路径>
# 安全：更新前自动备份数据，并保留上一版代码便于回滚。
# ============================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="transferhub-server"
NODE="$DIR/runtime/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"

SRC="${1:-}"
[ -n "$SRC" ] || { echo "用法: $0 <新部署包目录或 tar.gz>"; exit 1; }

# 解析来源（cd 后用相对文件名调用 tar，兼容 Git Bash/Windows 盘符路径；自动剥离包内顶层目录）
TMP=""
if [ -f "$SRC" ] && [[ "$SRC" == *.tar.gz ]]; then
  TMP="$(mktemp -d)"
  SRC_ABS="$(cd "$(dirname "$SRC")" && pwd)"
  ( cd "$SRC_ABS" && tar -xzf "$(basename "$SRC")" -C "$TMP" )
  if [ -f "$TMP/package.json" ]; then
    SRC="$TMP"
  else
    SUB="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n1)"
    [ -n "$SUB" ] && SRC="$SUB" || { echo "更新包结构异常"; rm -rf "$TMP"; exit 1; }
  fi
elif [ -d "$SRC" ]; then
  SRC="$(cd "$SRC" && pwd)"
else
  echo "无法识别更新来源：$SRC"; exit 1
fi

[ -f "$SRC/package.json" ] && [ -d "$SRC/node_modules" ] || { echo "更新包不完整（缺 package.json 或 node_modules）"; [ -n "$TMP" ] && rm -rf "$TMP"; exit 1; }

echo "== 1/4 停服 =="
"$DIR/deploy/stop.sh" || true

echo "== 2/4 备份数据 =="
"$DIR/deploy/backup.sh" || echo "（备份告警，继续）"

STAMP="$(date +%Y%m%d-%H%M%S)"
echo "== 3/4 替换代码（保留 data/ 与 config.json、secrets） =="
# 保留项
for keep in data config.json; do
  [ -e "$DIR/$keep" ] && cp -a "$DIR/$keep" "$DIR/.update-keep-$keep"
done
# 回滚备份（上一版代码）
[ -d "$DIR/.update-prev" ] && rm -rf "$DIR/.update-prev"
mkdir -p "$DIR/.update-prev"
for item in app webapp scripts deploy package.json package-lock.json; do
  [ -e "$DIR/$item" ] && cp -a "$DIR/$item" "$DIR/.update-prev/"
done
# 覆盖代码
for item in app webapp scripts deploy package.json package-lock.json node_modules runtime; do
  [ -e "$SRC/$item" ] && { rm -rf "$DIR/$item"; cp -a "$SRC/$item" "$DIR/"; }
done
# 恢复保留项
for keep in data config.json; do
  [ -e "$DIR/.update-keep-$keep" ] && { rm -rf "$DIR/$keep"; mv "$DIR/.update-keep-$keep" "$DIR/$keep"; }
done
chmod +x "$DIR"/deploy/*.sh 2>/dev/null || true

echo "== 4/5 内核完整性校验 =="
NODE="$(command -v node || echo "$DIR/runtime/bin/node")"
[ -x "$NODE" ] || NODE=node
if ! "$NODE" scripts/prep.js; then
  echo "新包内核校验失败，已中止启动。可回滚："
  echo "  rm -rf $DIR/app $DIR/webapp $DIR/scripts $DIR/deploy && cp -a $DIR/.update-prev/* $DIR/ && $DIR/deploy/start.sh"
  exit 1
fi

echo "== 5/5 启动 =="
"$DIR/deploy/start.sh" || { echo "启动失败，可回滚："; echo "  mv $DIR/.update-prev/* $DIR/ 后再次启动"; exit 1; }
sleep 1
"$DIR/deploy/status.sh" || true

[ -n "$TMP" ] && rm -rf "$TMP"
echo "更新完成（上一版代码保留在 $DIR/.update-prev/ 供回滚）"
