package com.github.manager

import androidx.annotation.VisibleForTesting

/**
 * 文件存储工具（纯逻辑，无 Android Context 依赖，可单元测试）。
 *
 * 将文件命名冲突解决逻辑从 MainActivity 中提取出来，便于独立验证。
 */
object FileUtils {

    /**
     * 计算无冲突的下载文件名。
     *
     * 策略：若 [fileName] 在 [existingNames] 中已存在，则追加 "(n)" 后缀，
     * 递增 n 直到找到空闲名称。
     *
     * 示例：
     *   "report.pdf" 已存在 → "report(1).pdf"
     *   "report.pdf"、"report(1).pdf" 均存在 → "report(2).pdf"
     *   无扩展名 "README" 已存在 → "README(1)"
     *
     * @param fileName     原始文件名（含扩展名）
     * @param existingNames 当前目录中已存在的文件名集合
     * @return 无冲突的文件名
     */
    @VisibleForTesting
    fun resolveFileName(fileName: String, existingNames: Set<String>): String {
        if (fileName !in existingNames) return fileName
        val base = fileName.substringBeforeLast(".")
        val ext  = fileName.substringAfterLast(".", "")
        var n = 1
        while (true) {
            val candidate = if (ext.isNotEmpty()) "$base($n).$ext" else "$base($n)"
            if (candidate !in existingNames) return candidate
            n++
        }
    }

    /**
     * 从 MIME 类型中提取有效的内容类型（去除参数部分）。
     *
     * 示例：
     *   "text/plain; charset=utf-8" → "text/plain"
     *   ""                         → "application/octet-stream"
     *   "  "                       → "application/octet-stream"
     *
     * @param mimeType 原始 MIME 字符串
     * @return 规范化的 MIME 类型
     */
    @VisibleForTesting
    fun normalizeMimeType(mimeType: String): String =
        mimeType.ifBlank { "application/octet-stream" }.substringBefore(";").trim()
}
