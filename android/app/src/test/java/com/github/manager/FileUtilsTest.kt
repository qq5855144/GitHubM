package com.github.manager

import org.junit.Test
import kotlin.test.assertEquals

/**
 * FileUtils 单元测试
 *
 * 覆盖场景：
 *  resolveFileName：
 *    1. 文件名不冲突时直接返回原名
 *    2. 冲突时追加 (1) 后缀
 *    3. (1) 也冲突时递增到 (2)
 *    4. 无扩展名文件冲突处理
 *    5. 多扩展名（如 .tar.gz）边界处理
 *    6. 仅扩展名冲突（basename 相同）
 *
 *  normalizeMimeType：
 *    7. 带参数的 MIME 类型提取主类型
 *    8. 空字符串返回默认值
 *    9. 仅空白字符返回默认值
 *   10. 合法 MIME 直接返回
 */
class FileUtilsTest {

    // ── resolveFileName ──────────────────────────────────────────────

    @Test
    fun `文件名不存在时直接返回原名`() {
        val result = FileUtils.resolveFileName("report.pdf", emptySet())
        assertEquals("report.pdf", result)
    }

    @Test
    fun `文件名冲突时追加括号序号`() {
        val existing = setOf("report.pdf")
        val result = FileUtils.resolveFileName("report.pdf", existing)
        assertEquals("report(1).pdf", result)
    }

    @Test
    fun `序号1也冲突时递增到2`() {
        val existing = setOf("report.pdf", "report(1).pdf")
        val result = FileUtils.resolveFileName("report.pdf", existing)
        assertEquals("report(2).pdf", result)
    }

    @Test
    fun `多次冲突依次递增序号`() {
        val existing = setOf("data.csv", "data(1).csv", "data(2).csv", "data(3).csv")
        val result = FileUtils.resolveFileName("data.csv", existing)
        assertEquals("data(4).csv", result)
    }

    @Test
    fun `无扩展名文件冲突时不带点号`() {
        val existing = setOf("README")
        val result = FileUtils.resolveFileName("README", existing)
        assertEquals("README(1)", result)
    }

    @Test
    fun `无扩展名文件多次冲突`() {
        val existing = setOf("README", "README(1)", "README(2)")
        val result = FileUtils.resolveFileName("README", existing)
        assertEquals("README(3)", result)
    }

    @Test
    fun `文件名含多个点号只处理最后一个扩展名`() {
        // archive.tar.gz → base="archive.tar"，ext="gz"
        val existing = setOf("archive.tar.gz")
        val result = FileUtils.resolveFileName("archive.tar.gz", existing)
        assertEquals("archive.tar(1).gz", result)
    }

    @Test
    fun `目标名称不在集合中不受集合中其他文件影响`() {
        val existing = setOf("other.pdf", "another.pdf")
        val result = FileUtils.resolveFileName("report.pdf", existing)
        assertEquals("report.pdf", result)
    }

    // ── normalizeMimeType ────────────────────────────────────────────

    @Test
    fun `带参数的MIME类型只保留主类型`() {
        val result = FileUtils.normalizeMimeType("text/plain; charset=utf-8")
        assertEquals("text/plain", result)
    }

    @Test
    fun `空字符串返回默认MIME类型`() {
        val result = FileUtils.normalizeMimeType("")
        assertEquals("application/octet-stream", result)
    }

    @Test
    fun `仅空白字符返回默认MIME类型`() {
        val result = FileUtils.normalizeMimeType("   ")
        assertEquals("application/octet-stream", result)
    }

    @Test
    fun `合法MIME类型直接返回`() {
        val result = FileUtils.normalizeMimeType("application/json")
        assertEquals("application/json", result)
    }

    @Test
    fun `带分号参数的application类型提取正确`() {
        val result = FileUtils.normalizeMimeType("application/pdf; version=1.7")
        assertEquals("application/pdf", result)
    }
}
