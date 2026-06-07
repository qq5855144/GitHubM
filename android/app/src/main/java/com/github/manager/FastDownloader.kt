package com.github.manager

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import kotlinx.coroutines.*
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max

object FastDownloader {
    private const val THREAD_COUNT = 8
    private const val NOTIFICATION_ID_BASE = 1000

    suspend fun download(
        context: Context,
        originalUrl: String,
        fileName: String,
        originalToken: String
    ) = withContext(Dispatchers.IO) {
        val safeFileName = fileName
            .replace(Regex("[/\\\\:*?\"<>|]"), "_")
            .trim()
            .takeIf { it.isNotBlank() } ?: "download_${System.currentTimeMillis()}"

        val notificationManager = NotificationManagerCompat.from(context)
        val channelId = "fast_download_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId, "快速下载", NotificationManager.IMPORTANCE_LOW
            )
            notificationManager.createNotificationChannel(channel)
        }

        val notifyId = NOTIFICATION_ID_BASE + (System.currentTimeMillis() % 10000).toInt()
        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("正在下载: $safeFileName")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)

        fun updateNotification(buildAction: NotificationCompat.Builder.() -> Unit) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                builder.buildAction()
                notificationManager.notify(notifyId, builder.build())
            }
        }

        updateNotification {
            setProgress(100, 0, true)
            setContentText("解析下载地址...")
        }

        try {
            // 1. Resolve URL
            var currentUrl = originalUrl
            var currentToken = originalToken
            var hops = 0
            var contentLength = -1L
            var acceptRanges = false

            while (hops < 5) {
                val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                    if (currentToken.isNotBlank()) {
                        setRequestProperty("Authorization", "Bearer $currentToken")
                    }
                    setRequestProperty("User-Agent", "GitHub Manager Android/FastDownloader")
                    instanceFollowRedirects = false
                    requestMethod = "GET"
                    connectTimeout = 20_000
                    readTimeout = 20_000
                }
                conn.connect()
                val code = conn.responseCode
                val location = conn.getHeaderField("Location")
                
                if (code in 301..308 && !location.isNullOrBlank()) {
                    val isGitHubApi = location.startsWith("https://api.github.com")
                    currentToken = if (isGitHubApi) currentToken else ""
                    currentUrl = location
                    hops++
                    conn.disconnect()
                } else if (code == 200 || code == 206) {
                    val lenHeader = conn.getHeaderField("Content-Length")
                    if (!lenHeader.isNullOrBlank()) {
                        contentLength = lenHeader.toLongOrNull() ?: -1L
                    }
                    val rangeHeader = conn.getHeaderField("Accept-Ranges")
                    acceptRanges = rangeHeader?.equals("bytes", ignoreCase = true) == true
                    conn.disconnect()
                    break
                } else {
                    conn.disconnect()
                    throw Exception("意外状态码: $code")
                }
            }

            val cacheFile = File(context.cacheDir, safeFileName)
            if (cacheFile.exists()) cacheFile.delete()

            if (contentLength > 0 && acceptRanges) {
                // Multi-thread
                RandomAccessFile(cacheFile, "rw").use { it.setLength(contentLength) }
                val chunkSize = contentLength / THREAD_COUNT
                val downloadedBytes = AtomicLong(0)
                var lastBytes = 0L
                var lastTime = System.currentTimeMillis()

                val progressJob = launch {
                    while (isActive) {
                        delay(1000)
                        val currentBytes = downloadedBytes.get()
                        val now = System.currentTimeMillis()
                        val speed = (currentBytes - lastBytes) * 1000 / max(1, now - lastTime)
                        lastBytes = currentBytes
                        lastTime = now
                        val progress = (currentBytes * 100 / contentLength).toInt()
                        val speedStr = formatBytes(speed) + "/s"
                        updateNotification {
                            setProgress(100, progress, false)
                            setContentText(speedStr)
                        }
                    }
                }

                coroutineScope {
                    val deferreds = (0 until THREAD_COUNT).map { i ->
                        async(Dispatchers.IO) {
                            val start = i * chunkSize
                            val end = if (i == THREAD_COUNT - 1) contentLength - 1 else (i + 1) * chunkSize - 1
                            downloadChunk(currentUrl, currentToken, start, end, cacheFile, downloadedBytes)
                        }
                    }
                    deferreds.awaitAll()
                }
                progressJob.cancel()
            } else {
                // Single thread fallback
                updateNotification {
                    setProgress(100, 0, contentLength <= 0)
                    setContentText("单线程下载中...")
                }
                downloadSingle(currentUrl, currentToken, cacheFile, contentLength) { current, total ->
                    if (total > 0) {
                        val progress = (current * 100 / total).toInt()
                        updateNotification {
                            setProgress(100, progress, false)
                            setContentText("已下载: ${formatBytes(current)}")
                        }
                    }
                }
            }

            updateNotification {
                setProgress(100, 100, true)
                setContentText("正在保存文件...")
            }

            val finalUri = moveToDownloads(context, cacheFile, safeFileName)
            cacheFile.delete()

            val ext = File(safeFileName).extension
            val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(finalUri, mimeType)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val pendingIntent = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE)

            updateNotification {
                setContentTitle("下载完成: $safeFileName")
                setContentText("点击打开")
                setProgress(0, 0, false)
                setOngoing(false)
                setSmallIcon(android.R.drawable.stat_sys_download_done)
                setContentIntent(pendingIntent)
                setAutoCancel(true)
            }

            withContext(Dispatchers.Main) {
                Toast.makeText(context, "$safeFileName 下载完成", Toast.LENGTH_SHORT).show()
            }

        } catch (e: Exception) {
            e.printStackTrace()
            updateNotification {
                setContentTitle("下载失败: $safeFileName")
                setContentText(e.message)
                setProgress(0, 0, false)
                setOngoing(false)
                setSmallIcon(android.R.drawable.stat_sys_warning)
            }
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "下载失败: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun downloadChunk(url: String, token: String, start: Long, end: Long, file: File, downloadedBytes: AtomicLong) {
        var currentStart = start
        val maxRetries = 3
        var retryCount = 0
        while (retryCount < maxRetries) {
            try {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("Range", "bytes=$currentStart-$end")
                    setRequestProperty("User-Agent", "GitHub Manager Android/FastDownloader")
                    connectTimeout = 20000
                    readTimeout = 20000
                }
                conn.connect()
                val code = conn.responseCode
                if (code != 206 && code != 200) throw Exception("Chunk error code: $code")
                
                conn.inputStream.use { input ->
                    RandomAccessFile(file, "rw").use { raf ->
                        raf.seek(currentStart)
                        val buffer = ByteArray(32768) // 32KB buffer
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            raf.write(buffer, 0, read)
                            downloadedBytes.addAndGet(read.toLong())
                            currentStart += read
                        }
                    }
                }
                return
            } catch (e: Exception) {
                retryCount++
                if (retryCount >= maxRetries) throw e
            }
        }
    }

    private fun downloadSingle(url: String, token: String, file: File, totalLength: Long, onProgress: (Long, Long) -> Unit) {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("User-Agent", "GitHub Manager Android/FastDownloader")
            connectTimeout = 20000
            readTimeout = 20000
        }
        conn.connect()
        val code = conn.responseCode
        if (code != 200) throw Exception("Download error code: $code")
        
        conn.inputStream.use { input ->
            FileOutputStream(file).use { output ->
                val buffer = ByteArray(32768)
                var read: Int
                var current = 0L
                var lastTime = System.currentTimeMillis()
                while (input.read(buffer).also { read = it } != -1) {
                    output.write(buffer, 0, read)
                    current += read
                    val now = System.currentTimeMillis()
                    if (now - lastTime > 500) {
                        onProgress(current, totalLength)
                        lastTime = now
                    }
                }
            }
        }
    }

    private fun moveToDownloads(context: Context, source: File, fileName: String): Uri {
        val resolver = context.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val contentValues = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream")
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                ?: throw Exception("无法创建 MediaStore 记录")
            resolver.openOutputStream(uri)?.use { output ->
                FileInputStream(source).use { input ->
                    input.copyTo(output)
                }
            }
            return uri
        } else {
            val destDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!destDir.exists()) destDir.mkdirs()
            val destFile = File(destDir, fileName)
            source.copyTo(destFile, overwrite = true)
            return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", destFile)
        }
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        val exp = (Math.log(bytes.toDouble()) / Math.log(1024.0)).toInt()
        val pre = "KMGTPE"[exp - 1]
        return String.format("%.1f %cB", bytes / Math.pow(1024.0, exp.toDouble()), pre)
    }
}
