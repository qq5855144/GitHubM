#!/usr/bin/env bash
# ============================================================
# GitHub Manager — Release Keystore 生成脚本
# 首次设置时执行一次，将输出内容配置到 GitHub Repository Secrets
#
# 用法：
#   chmod +x generate-keystore.sh
#   ./generate-keystore.sh
# ============================================================

set -euo pipefail

KEYSTORE_FILE="release.keystore"
KEY_ALIAS="github-manager"
STORE_PASS="GithubManager@2024"
KEY_PASS="GithubManager@2024"
VALIDITY_DAYS=10000   # ~27 年

echo ""
echo "🔑  正在生成 Release Keystore..."
echo "    文件：${KEYSTORE_FILE}"
echo "    别名：${KEY_ALIAS}"
echo ""

# 如果文件已存在则跳过生成（避免覆盖旧签名导致覆盖安装失败）
if [ -f "${KEYSTORE_FILE}" ]; then
    echo "⚠️  ${KEYSTORE_FILE} 已存在，跳过生成（避免签名证书变更）。"
    echo "   如需重新生成，请先手动删除该文件。"
else
    keytool -genkeypair -v \
        -keystore "${KEYSTORE_FILE}" \
        -alias "${KEY_ALIAS}" \
        -keyalg RSA \
        -keysize 2048 \
        -validity ${VALIDITY_DAYS} \
        -storepass "${STORE_PASS}" \
        -keypass "${KEY_PASS}" \
        -dname "CN=GitHub Manager, OU=Android, O=Developer, L=CN, S=CN, C=CN"

    echo ""
    echo "✅  Keystore 生成成功！"
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  📋  请将以下内容配置到 GitHub Repository Secrets"
echo "  路径：Settings → Secrets and variables → Actions"
echo "══════════════════════════════════════════════════"
echo ""

echo "Secret 名称: RELEASE_KEYSTORE_BASE64"
echo "Secret 值（请完整复制下方 base64 内容）:"
echo "---BEGIN BASE64---"
base64 -w 0 "${KEYSTORE_FILE}"
echo ""
echo "---END BASE64---"

echo ""
echo "Secret 名称: RELEASE_KEY_ALIAS"
echo "Secret 值:   ${KEY_ALIAS}"
echo ""
echo "Secret 名称: RELEASE_STORE_PASSWORD"
echo "Secret 值:   ${STORE_PASS}"
echo ""
echo "Secret 名称: RELEASE_KEY_PASSWORD"
echo "Secret 值:   ${KEY_PASS}"
echo ""
echo "══════════════════════════════════════════════════"
echo "  ⚠️   重要提示"
echo "══════════════════════════════════════════════════"
echo "  1. 请妥善备份 ${KEYSTORE_FILE}，一旦丢失无法覆盖"
echo "     安装已分发给用户的旧版本 APK。"
echo "  2. release.keystore 已加入 .gitignore，"
echo "     切勿将 keystore 文件提交到 Git 仓库。"
echo "  3. 配置好 Secrets 后，下次 push main 分支即会"
echo "     自动构建签名 APK 并发布 GitHub Release。"
echo "══════════════════════════════════════════════════"
echo ""
