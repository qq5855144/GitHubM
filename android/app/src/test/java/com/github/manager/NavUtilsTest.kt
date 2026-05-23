package com.github.manager

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

/**
 * NavUtils.resolveNavItemId 单元测试
 *
 * 覆盖场景：
 *  1. 精确路径匹配（根路径 "/"）
 *  2. 前缀路径匹配（/repos、/search、/ai-assistant、/settings）
 *  3. 子路径仍命中父前缀（/repos/owner/name → nav_repos）
 *  4. 未知路径 fallback 到 nav_home
 *  5. "/" 不误命中 "/repos" 等子路径（顺序敏感）
 */
class NavUtilsTest {

    // ── 精确路径 ────────────────────────────────────────────────────

    @Test
    fun `根路径斜杠命中 nav_home`() {
        assertEquals(R.id.nav_home, NavUtils.resolveNavItemId("/"))
    }

    // ── 前缀路径（精确） ─────────────────────────────────────────────

    @Test
    fun `repos 精确路径命中 nav_repos`() {
        assertEquals(R.id.nav_repos, NavUtils.resolveNavItemId("/repos"))
    }

    @Test
    fun `search 精确路径命中 nav_search`() {
        assertEquals(R.id.nav_search, NavUtils.resolveNavItemId("/search"))
    }

    @Test
    fun `ai-assistant 精确路径命中 nav_ai`() {
        assertEquals(R.id.nav_ai, NavUtils.resolveNavItemId("/ai-assistant"))
    }

    @Test
    fun `settings 精确路径命中 nav_settings`() {
        assertEquals(R.id.nav_settings, NavUtils.resolveNavItemId("/settings"))
    }

    // ── 子路径前缀匹配 ───────────────────────────────────────────────

    @Test
    fun `仓库详情子路径命中 nav_repos`() {
        assertEquals(R.id.nav_repos, NavUtils.resolveNavItemId("/repos/torvalds/linux"))
    }

    @Test
    fun `仓库 issues 子路径命中 nav_repos`() {
        assertEquals(R.id.nav_repos, NavUtils.resolveNavItemId("/repos/owner/name/issues"))
    }

    @Test
    fun `settings 子路径命中 nav_settings`() {
        assertEquals(R.id.nav_settings, NavUtils.resolveNavItemId("/settings/account"))
    }

    @Test
    fun `ai-assistant 子路径命中 nav_ai`() {
        assertEquals(R.id.nav_ai, NavUtils.resolveNavItemId("/ai-assistant/chat/123"))
    }

    // ── Fallback ─────────────────────────────────────────────────────

    @Test
    fun `未知路径 fallback 到 nav_home`() {
        assertEquals(R.id.nav_home, NavUtils.resolveNavItemId("/unknown-page"))
    }

    @Test
    fun `空字符串 fallback 到 nav_home`() {
        assertEquals(R.id.nav_home, NavUtils.resolveNavItemId(""))
    }

    // ── 顺序敏感性："/" 不应误命中子路径 ───────────────────────────

    @Test
    fun `repos 不应被根路径规则命中`() {
        assertNotEquals(R.id.nav_home, NavUtils.resolveNavItemId("/repos"))
    }

    @Test
    fun `settings 不应被根路径规则命中`() {
        assertNotEquals(R.id.nav_home, NavUtils.resolveNavItemId("/settings"))
    }

    // ── 自定义映射注入（测试隔离）───────────────────────────────────

    @Test
    fun `自定义映射注入可覆盖默认行为`() {
        val customMap = linkedMapOf(
            "/custom" to 999,
            "/"       to 0,
        )
        assertEquals(999, NavUtils.resolveNavItemId("/custom/page", customMap))
        assertEquals(0,   NavUtils.resolveNavItemId("/",            customMap))
        assertEquals(0,   NavUtils.resolveNavItemId("/other",       customMap))
    }
}
