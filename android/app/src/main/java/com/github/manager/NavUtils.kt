package com.github.manager

import androidx.annotation.VisibleForTesting

/**
 * 底部导航栏路径匹配工具（纯逻辑，无 Android Context 依赖，可单元测试）。
 *
 * 路由规则（顺序敏感）：
 *   - 精确路径 "/" 必须排在最后，避免被子路径误命中
 *   - 其他路径按前缀匹配，确保子页面（如仓库详情）高亮正确的 Tab
 */
object NavUtils {

    /**
     * HashRouter 路径前缀 → BottomNav 菜单项 ID。
     * 使用 linkedMapOf 保证插入顺序（"/" 必须最后匹配）。
     */
    val NAV_PATH_MAP: LinkedHashMap<String, Int> = linkedMapOf(
        "/repos"        to R.id.nav_repos,
        "/search"       to R.id.nav_search,
        "/ai-assistant" to R.id.nav_ai,
        "/settings"     to R.id.nav_settings,
        "/"             to R.id.nav_home,
    )

    /**
     * 根据当前 HashRouter 路径返回对应的菜单项 ID。
     *
     * @param path    形如 "/repos"、"/repos/owner/name"、"/"、"/settings" 的路径字符串
     * @param pathMap 可替换的路径映射，测试时可注入自定义映射
     * @return 匹配的菜单项 ID，未匹配时返回 [R.id.nav_home]
     */
    @VisibleForTesting
    fun resolveNavItemId(
        path: String,
        pathMap: LinkedHashMap<String, Int> = NAV_PATH_MAP,
    ): Int = pathMap.entries.firstOrNull { (prefix, _) ->
        if (prefix == "/") path == "/" else path.startsWith(prefix)
    }?.value ?: R.id.nav_home
}
