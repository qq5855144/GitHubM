package com.github.manager

import android.content.res.ColorStateList
import android.graphics.Color
import androidx.annotation.VisibleForTesting

/**
 * 主题与颜色工具（纯逻辑，无 Context 依赖，可单元测试）。
 */
object ThemeUtils {

    /** 深色模式下未选中导航图标颜色（#9292A8） */
    const val UNSELECTED_DARK  = 0xFF9292A8.toInt()
    /** 浅色模式下未选中导航图标颜色（#64748B） */
    const val UNSELECTED_LIGHT = 0xFF64748B.toInt()

    /**
     * 解析 hex 颜色字符串，失败时返回 null（不抛异常）。
     *
     * @param hex 形如 "#7c3aed"、"#8B4CF8" 的颜色字符串
     * @return 解析成功的颜色 Int，格式非法时返回 null
     */
    @VisibleForTesting
    fun parseColorSafe(hex: String): Int? = runCatching {
        Color.parseColor(hex)
    }.getOrNull()

    /**
     * 根据当前是否为深色模式返回未选中导航图标颜色。
     *
     * @param isDark true = 深色模式
     * @return 对应的颜色 Int
     */
    @VisibleForTesting
    fun unselectedNavColor(isDark: Boolean): Int =
        if (isDark) UNSELECTED_DARK else UNSELECTED_LIGHT

    /**
     * 校验 hex 颜色字符串是否合法。
     *
     * @param hex 待检验的颜色字符串
     * @return true = 合法，false = 非法
     */
    @VisibleForTesting
    fun isValidHexColor(hex: String): Boolean = parseColorSafe(hex) != null

    /**
     * 生成 M3 BottomNavigationView Active Indicator 的 ColorStateList。
     *
     * Material 3 规范：
     *   - 浅色模式：accent 色 + alpha 20%（primaryContainer 淡色调，不喧宾夺主）
     *   - 深色模式：accent 色 × 55% 亮度（沉稳深紫，与深色 sidebar 形成可见对比）
     *   - 未选中项：完全透明（不渲染 indicator）
     *
     * @param accentColor 当前强调色（ARGB Int）
     * @param isDark      是否为深色模式
     * @return 可直接赋给 bottomNav.itemActiveIndicatorColor 的 ColorStateList
     */
    fun indicatorColor(accentColor: Int, isDark: Boolean): ColorStateList {
        val indicatorColor = if (isDark) {
            // 深色：accent × 0.55 亮度，产生「primaryContainer dark」效果
            val r = (Color.red(accentColor)   * 0.55f).toInt().coerceIn(0, 255)
            val g = (Color.green(accentColor) * 0.55f).toInt().coerceIn(0, 255)
            val b = (Color.blue(accentColor)  * 0.55f).toInt().coerceIn(0, 255)
            Color.argb(255, r, g, b)
        } else {
            // 浅色：accent + 20% alpha（51/255）→ primaryContainer 淡化色
            Color.argb(51, Color.red(accentColor), Color.green(accentColor), Color.blue(accentColor))
        }
        return ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(indicatorColor, Color.TRANSPARENT)
        )
    }
}
