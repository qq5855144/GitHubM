package com.github.manager

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
}
