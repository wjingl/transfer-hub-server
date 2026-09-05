#!/usr/bin/env bash
# ============================================================================
# 一键生成自签 HTTPS 证书（内网启用摄像头必需：非 localhost 的 HTTP 页面
# 浏览器禁止调用摄像头）。生成后自动写入 config.json 的 https 段。
# 用法：./deploy/gen-cert.sh [LAN IP 或域名]（缺省自动取第一块网卡 IP）
# 依赖：openssl（主流 Linux 自带）
# ============================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$DIR/data/certs"
DAYS=825

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  DOMAIN="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
[ -n "$DOMAIN" ] || { echo "无法探测本机 IP，请显式传入：./deploy/gen-cert.sh 192.168.1.10"; exit 1; }

mkdir -p "$CERT_DIR"
echo "== 生成自签证书（SAN: $DOMAIN, localhost）=="
openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS" -nodes \
  -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.crt" \
  -subj "/CN=$DOMAIN/O=Transfer Hub" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$DOMAIN" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

# 写入 config.json（未启用则启用并指向证书）
NODE="$(command -v node || echo "$DIR/runtime/bin/node")"
"$NODE" - "$CERT_DIR" <<'EOF'
const fs = require('fs');
const path = process.argv[2];
const file = 'config.json';
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.https = { enabled: true, keyFile: `${path}/server.key`, certFile: `${path}/server.crt` };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('[gen-cert] config.json 已开启 https：', cfg.https);
EOF

chmod 600 "$CERT_DIR/server.key" 2>/dev/null || true
echo "== 完成：重启服务后使用 https://$DOMAIN:$(grep -oP '"port"\s*:\s*\K[0-9]+' config.json | head -1) 访问 =="
echo "   浏览器首次访问会出现证书警告（自签），点击『高级 → 继续前往』即可；摄像头随即可用。"
