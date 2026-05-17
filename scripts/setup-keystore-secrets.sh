#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  GitHub Manager — Release Keystore Secrets 一键配置脚本
#
#  用途：将项目内置的 release.keystore 配置到 GitHub 仓库 Secrets，
#        使每次 CI 构建使用同一证书，支持跨版本覆盖安装。
#
#  前提：已安装 GitHub CLI（gh），并已执行 gh auth login
#
#  用法：
#    bash scripts/setup-keystore-secrets.sh
#
#  Keystore 信息（证书已内置于 android/release.keystore）：
#    别名 (alias)     : github-manager
#    Keystore 密码    : GithubManager@2024
#    Key 密码         : GithubManager@2024
#    有效期           : 100 年（2026 - 2126）
# ══════════════════════════════════════════════════════════════
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYSTORE_PATH="${SCRIPT_DIR}/../android/release.keystore"

# ── 获取仓库名 ──────────────────────────────────────────────
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"
if [ -z "$REPO" ]; then
  echo "❌  无法自动识别仓库名，请手动指定："
  echo "    GITHUB_REPOSITORY=owner/repo bash scripts/setup-keystore-secrets.sh"
  exit 1
fi

if [ ! -f "$KEYSTORE_PATH" ]; then
  echo "❌  未找到 release.keystore：${KEYSTORE_PATH}"
  exit 1
fi

echo "🔑  正在配置 Release Keystore Secrets → ${REPO}"
echo ""

B64=$(base64 -w 0 "$KEYSTORE_PATH")
gh secret set RELEASE_KEYSTORE_BASE64 --body "$B64"              --repo "$REPO"
gh secret set RELEASE_KEY_ALIAS       --body "github-manager"    --repo "$REPO"
gh secret set RELEASE_STORE_PASSWORD  --body "GithubManager@2024" --repo "$REPO"
gh secret set RELEASE_KEY_PASSWORD    --body "GithubManager@2024" --repo "$REPO"

echo "✅  配置完成！已写入 4 个 Secrets："
echo "   RELEASE_KEYSTORE_BASE64  ← android/release.keystore（base64 编码）"
echo "   RELEASE_KEY_ALIAS        ← github-manager"
echo "   RELEASE_STORE_PASSWORD   ← GithubManager@2024"
echo "   RELEASE_KEY_PASSWORD     ← GithubManager@2024"
echo ""
echo "📦  下次推送 main 分支，CI 将使用此稳定证书构建 APK。"
echo "    每次构建生成的 APK 签名一致，支持跨版本直接覆盖安装。"
