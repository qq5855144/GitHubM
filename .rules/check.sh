#!/bin/bash
# 统一跑仓库内所有 ast-grep 规则。
# 设计原则：任何一条规则检出 error 级诊断，本脚本就必须返回非 0，
# 否则 `pnpm lint` 永远绿灯，规则形同虚设。

RULES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$RULES_DIR")"

cd "$REPO_ROOT" || exit 1

failed=0

run_rule() {
    local rule_file="$1"
    local target="${2:-.}"
    local name
    name="$(basename "$rule_file")"

    if [ ! -f "$rule_file" ]; then
        echo "⚠️  跳过 $name：规则文件不存在"
        return 0
    fi

    echo "=== ast-grep scan -r $name $target ==="

    if ! ast-grep scan -r "$rule_file" "$target"; then
        echo "❌ $name 检出问题"
        echo ""
        failed=1
        return 0
    fi

    echo ""
    return 0
}

for rule in SelectItem.yml contrast.yml supabase-google-sso.yml toast-hook.yml \
            slot-nesting.yml require-button-interaction.yml supabase-edge-function-get-body.yml \
            useAuth.yml; do
    run_rule "$RULES_DIR/$rule"
done

run_rule "$RULES_DIR/authProvider.yml" "src/App.tsx"

if [ "$failed" -ne 0 ]; then
    echo "⚠️  Issue detected: ast-grep 规则检出问题，请修复后重试。"
    echo ""
    echo "Suggested fixes:"
    echo "1. 按上方诊断定位到具体文件与行号"
    echo "2. 使用 useAuth 的组件必须处于 AuthProvider 作用域内"
    echo "3. 其余规则按对应 message 提示修改"
    exit 1
fi

echo "✅ 所有 ast-grep 规则通过"
exit 0
