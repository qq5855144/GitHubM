#!/usr/bin/env bash
# 生成新的 Release Keystore（仅一次）。生成后请立即离线备份，并把
# base64 与口令写入 GitHub Actions Secrets；不要提交到仓库。
#
# 用法：
#   RELEASE_STORE_PASSWORD='强随机口令' ./generate-keystore.sh /path/to/release.keystore
#   不传口令时会自动生成随机口令并打印一次。
set -euo pipefail

OUT="${1:-$HOME/githubm-release.keystore}"
ALIAS="${KEY_ALIAS:-github-manager}"
STORE_PASS="${RELEASE_STORE_PASSWORD:-$(openssl rand -base64 33 | tr -dc 'A-Za-z0-9' | head -c 32)}"
KEY_PASS="${RELEASE_KEY_PASSWORD:-$STORE_PASS}"

if [ -e "$OUT" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "❌ 文件已存在：$OUT"
  echo "   覆盖会改变签名，导致旧版本无法升级。确需覆盖请设置 FORCE=1。"
  exit 1
fi

keytool -genkeypair -v \
  -keystore "$OUT" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
  -dname "CN=GitHub Manager, OU=Android, O=GitHubM, L=CN, S=CN, C=CN" \
  -noprompt

chmod 600 "$OUT"
echo
 echo "✅ 已生成：$OUT"
echo "别名：$ALIAS"
echo "Store 密码：$STORE_PASS"
echo "Key 密码：$KEY_PASS"
echo
echo "请离线备份 keystore 与口令，然后配置 4 个 Actions Secrets："
echo "  RELEASE_KEYSTORE_BASE64=$(base64 -w 0 "$OUT")"
echo "  RELEASE_KEY_ALIAS=$ALIAS"
echo "  RELEASE_STORE_PASSWORD=$STORE_PASS"
echo "  RELEASE_KEY_PASSWORD=$KEY_PASS"
