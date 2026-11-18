#!/usr/bin/env bash
# 将已备份的 Release Keystore 写入 GitHub Actions Secrets。
# 需要已安装 gh 并执行 gh auth login。
#
# 用法：
#   RELEASE_STORE_PASSWORD='...' RELEASE_KEY_PASSWORD='...' \
#   bash scripts/setup-keystore-secrets.sh /path/to/release.keystore
set -euo pipefail

KEYSTORE_PATH="${1:-$HOME/githubm-release.keystore}"
ALIAS="${RELEASE_KEY_ALIAS:-github-manager}"
: "${RELEASE_STORE_PASSWORD:?请通过 RELEASE_STORE_PASSWORD 提供 store 密码}"
KEY_PASS="${RELEASE_KEY_PASSWORD:-$RELEASE_STORE_PASSWORD}"
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

[ -f "$KEYSTORE_PATH" ] || { echo "❌ 找不到 keystore：$KEYSTORE_PATH"; exit 1; }

grep -q '^-----BEGIN' "$KEYSTORE_PATH" && { echo "❌ 请传入二进制 keystore，不要传 PEM"; exit 1; } || true

B64=$(base64 -w 0 "$KEYSTORE_PATH")
gh secret set RELEASE_KEYSTORE_BASE64 --body "$B64" --repo "$REPO"
gh secret set RELEASE_KEY_ALIAS       --body "$ALIAS" --repo "$REPO"
gh secret set RELEASE_STORE_PASSWORD  --body "$RELEASE_STORE_PASSWORD" --repo "$REPO"
gh secret set RELEASE_KEY_PASSWORD    --body "$KEY_PASS" --repo "$REPO"

echo "✅ 已写入 4 个 Release 签名 Secrets → $REPO"
