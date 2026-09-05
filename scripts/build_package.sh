#!/usr/bin/env bash
# ============================================================================
# 打包发布：在联网构建机上制作可离线部署的 tar.gz
#   bash scripts/build_package.sh                 # 含 node_modules（推荐，服务器离线可用）
#   bash scripts/build_package.sh --no-deps       # 不含 node_modules（目标机可 npm install 时用）
# 产物：dist/transferhub-server_v<版本>.tar.gz
# 包内：app/ webapp/（内核+离线包+清单） scripts/ deploy/ package.json package-lock.json README.md
#       [+ node_modules/] [+ runtime/（若存在）] + SHA256SUMS.txt
# 永不打入：config.json（含密钥）、data/（运行数据）、.git、构建输出 dist/
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_DEPS=1
[ "${1:-}" = "--no-deps" ] && WITH_DEPS=0

NODE="$(command -v node || echo "$ROOT/runtime/bin/node")"
[ -x "$NODE" ] || NODE=node

say()  { printf '\033[1;32m[打包]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[失败]\033[0m %s\n' "$*" >&2; exit 1; }

# 1) 内核完整性前置校验（不通过坚决不出包）
"$NODE" scripts/prep.js || die "webapp/dist 完整性校验失败，禁止打包"

VERSION="$("$NODE" -p "require('./package.json').version")"
STAGE="$(mktemp -d)"
NAME="transferhub-server_v${VERSION}"
OUT_DIR="$ROOT/dist"
OUT="$OUT_DIR/${NAME}.tar.gz"
mkdir -p "$OUT_DIR"

say "组装 $NAME ..."
mkdir -p "$STAGE/$NAME"
for item in app webapp scripts deploy package.json package-lock.json config.example.json README.md; do
  [ -e "$item" ] && cp -a "$item" "$STAGE/$NAME/"
done
if [ "$WITH_DEPS" = "1" ]; then
  [ -d node_modules ] || die "node_modules 缺失：请先 npm install（或使用 --no-deps）"
  say "附带 node_modules（离线部署用）..."
  cp -a node_modules "$STAGE/$NAME/"
fi
[ -d runtime ] && { say "附带捆绑 Node 运行时 runtime/ ..."; cp -a runtime "$STAGE/$NAME/"; }

# 2) 关键产物校验和（部署/更新时可核验）
( cd "$STAGE/$NAME" && find app webapp scripts deploy -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS.txt )

# 3) 打 tar.gz（固定排序保证可重现；cd 到输出目录用纯文件名，兼容 Git Bash/Windows 的盘符路径）
OUT_NAME="${NAME}.tar.gz"
( cd "$OUT_DIR" && tar -czf "$OUT_NAME" -C "$STAGE" --sort=name --owner=0 --group=0 --numeric-owner "$NAME" )
rm -rf "$STAGE"
OUT="$OUT_DIR/$OUT_NAME"

SIZE=$(du -h "$OUT" | cut -f1)
say "============================================================"
say "  产物：$OUT  ($SIZE)"
say "  部署：解压到目标机 → sudo ./deploy/deploy.sh"
say "  更新：上传到目标机 → ./deploy/update.sh <该包路径>"
say "============================================================"
