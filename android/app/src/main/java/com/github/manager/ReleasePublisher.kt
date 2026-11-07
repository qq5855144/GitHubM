package com.github.manager

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * 将 Actions Artifact 下载到本地后，上传为 GitHub Release Asset。
 *
 * 浏览器无法直传 uploads.github.com（该域不支持 CORS 预检），
 * 因此 Android 端通过原生 HTTP 完成下载和上传。
 */
object ReleasePublisher {
    data class Result(
        val success: Boolean,
        val message: String,
        val assetName: String,
        val browserDownloadUrl: String = "",
    )

    suspend fun publish(
        context: Context,
        uploadUrl: String,
        artifactUrl: String,
        fileName: String,
        token: String,
    ): Result = withContext(Dispatchers.IO) {
        if (token.isBlank()) return@withContext Result(false, "缺少 GitHub Token", fileName)
        val tempFile = File.createTempFile("release-asset-", ".zip", context.cacheDir)
        try {
            downloadArtifact(artifactUrl, token, tempFile)
            if (tempFile.length() <= 0L) throw IOException("Artifact 下载结果为空")
            uploadAsset(uploadUrl, token, tempFile, fileName)
        } catch (e: Exception) {
            Result(false, e.message ?: "发布失败", fileName)
        } finally {
            runCatching { tempFile.delete() }
        }
    }

    private fun downloadArtifact(artifactUrl: String, token: String, target: File) {
        var currentUrl = artifactUrl
        var hops = 0
        var connection: HttpURLConnection? = null
        try {
            while (hops < 6) {
                val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    requestMethod = "GET"
                    connectTimeout = 30_000
                    readTimeout = 120_000
                    setRequestProperty("User-Agent", "GitHubM-Android/ReleasePublisher")
                    if (URL(currentUrl).host == "api.github.com") {
                        setRequestProperty("Authorization", "Bearer $token")
                        setRequestProperty("Accept", "application/vnd.github+json")
                    }
                }
                conn.connect()
                val code = conn.responseCode
                val location = conn.getHeaderField("Location")
                if (code in 301..308 && !location.isNullOrBlank()) {
                    conn.disconnect()
                    currentUrl = location
                    hops++
                    continue
                }
                if (code !in 200..299) {
                    val body = conn.errorStream?.bufferedReader()?.use { it.readText() }?.take(300).orEmpty()
                    conn.disconnect()
                    throw IOException("Artifact 下载失败 HTTP $code${if (body.isBlank()) "" else "：$body"}")
                }
                connection = conn
                break
            }
            val conn = connection ?: throw IOException("Artifact 下载重定向次数过多")
            conn.inputStream.use { input ->
                FileOutputStream(target).buffered().use { output ->
                    input.copyTo(output, 64 * 1024)
                }
            }
            conn.disconnect()
            connection = null
        } finally {
            connection?.disconnect()
        }
    }

    private fun uploadAsset(uploadUrl: String, token: String, file: File, fileName: String): Result {
        val conn = (URL(uploadUrl).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            requestMethod = "POST"
            doOutput = true
            setFixedLengthStreamingMode(file.length())
            connectTimeout = 30_000
            readTimeout = 180_000
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("Content-Type", "application/zip")
            setRequestProperty("User-Agent", "GitHubM-Android/ReleasePublisher")
        }
        conn.connect()
        FileInputStream(file).buffered().use { input ->
            conn.outputStream.buffered().use { output ->
                input.copyTo(output, 64 * 1024)
            }
        }
        val code = conn.responseCode
        val response = (if (code in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() }.orEmpty()
        conn.disconnect()
        if (code !in 200..299) {
            throw IOException("上传失败 HTTP $code${if (response.isBlank()) "" else "：${response.take(300)}"}")
        }
        val downloadUrl = Regex("\"browser_download_url\"\\s*:\\s*\"([^\"]+)\"")
            .find(response)?.groupValues?.getOrNull(1).orEmpty()
        return Result(true, "发布成功", fileName, downloadUrl)
    }
}
