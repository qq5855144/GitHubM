package com.github.manager

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var splashOverlay: View
    private var splashDismissed = false

    // ── 文件上传 ────────────────────────────────────────────────────
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var cameraImageUri: Uri? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
            result.data?.let { data ->
                when {
                    data.clipData != null ->
                        Array(data.clipData!!.itemCount) { i ->
                            data.clipData!!.getItemAt(i).uri
                        }
                    data.data != null -> arrayOf(data.data!!)
                    else -> cameraImageUri?.let { arrayOf(it) }
                }
            }
        } else null
        fileChooserCallback?.onReceiveValue(uris)
        fileChooserCallback = null
    }

    // ── 按需权限：相机 ──────────────────────────────────────────────
    private var pendingFileChooserParams: WebChromeClient.FileChooserParams? = null
    private var pendingFilePathCallback: ValueCallback<Array<Uri>>? = null

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val params = pendingFileChooserParams
        val callback = pendingFilePathCallback
        pendingFileChooserParams = null
        pendingFilePathCallback = null
        if (params != null && callback != null) {
            if (granted) launchFileChooser(params, callback)
            else launchFileChooserWithoutCamera(params, callback)
        }
    }

    // ── 按需权限：写存储（仅 API 26–28） ───────────────────────────
    private var pendingDownloadUrl: String = ""
    private var pendingDownloadFileName: String = ""
    private var pendingDownloadUserAgent: String = ""
    private var pendingDownloadToken: String = ""

    private val writeStoragePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            startAuthenticatedDownload(
                pendingDownloadUrl, pendingDownloadFileName,
                pendingDownloadUserAgent, pendingDownloadToken
            )
        } else {
            Toast.makeText(this, "存储权限被拒绝，无法保存文件", Toast.LENGTH_LONG).show()
        }
        pendingDownloadUrl = ""; pendingDownloadFileName = ""
        pendingDownloadUserAgent = ""; pendingDownloadToken = ""
    }

    // ── 下载完成广播 ────────────────────────────────────────────────
    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            Toast.makeText(context, "✓ 文件已下载完成，保存至「下载」文件夹", Toast.LENGTH_SHORT).show()
        }
    }

    // ── JS 桥接口 ───────────────────────────────────────────────────
    inner class WebAppBridge {

        /** React 首屏就绪后调用，触发启动遮罩淡出 */
        @JavascriptInterface
        fun notifyReady() {
            runOnUiThread { dismissSplash() }
        }

        /**
         * ArtifactsPage 调用：传原始 GitHub URL + token，由 DownloadManager 带认证下载。
         * 调用：window.AndroidBridge.downloadFile(url, fileName, token)
         */
        @JavascriptInterface
        fun downloadFile(url: String, fileName: String, token: String) {
            runOnUiThread {
                checkStoragePermissionAndDownload(url, fileName, "GitHub Manager Android", token)
            }
        }

        /**
         * ExportPage 调用：传内存文本内容（Base64 编码），由原生写入「下载」文件夹。
         * 调用：window.AndroidBridge.saveBlobData(fileName, mimeType, base64Content)
         *
         * 此方法运行在 JavascriptInterface 后台线程，文件 I/O 在此线程完成，
         * Toast 切回主线程显示。
         */
        @JavascriptInterface
        fun saveBlobData(fileName: String, mimeType: String, base64Content: String) {
            if (base64Content.isEmpty()) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "保存失败：内容为空", Toast.LENGTH_SHORT).show()
                }
                return
            }

            // API 26–28：先检查写存储权限
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                val granted = checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED
                if (!granted) {
                    runOnUiThread {
                        Toast.makeText(this@MainActivity, "请授予存储权限后重试", Toast.LENGTH_LONG).show()
                    }
                    return
                }
            }

            runCatching {
                val bytes = Base64.decode(base64Content, Base64.DEFAULT)
                val savedName = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saveToMediaStore(bytes, fileName, mimeType)
                } else {
                    saveToLegacyStorage(bytes, fileName)
                }
                runOnUiThread {
                    Toast.makeText(
                        this@MainActivity,
                        "✓ 已保存至「下载」文件夹：$savedName",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }.onFailure { e ->
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "保存失败：${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    /** API 29+：通过 MediaStore.Downloads 写文件（无需存储权限） */
    private fun saveToMediaStore(bytes: ByteArray, fileName: String, mimeType: String): String {
        val effectiveMime = mimeType.ifBlank { "application/octet-stream" }.substringBefore(";")
        val cv = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, effectiveMime)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)
            ?: throw IOException("无法在 MediaStore 创建下载记录")
        resolver.openOutputStream(uri)?.use { it.write(bytes) }
        cv.clear()
        cv.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, cv, null, null)
        return fileName
    }

    /** API 26–28：通过 File API 写入公共 Downloads 目录 */
    private fun saveToLegacyStorage(bytes: ByteArray, fileName: String): String {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        dir.mkdirs()
        var target = File(dir, fileName)
        val base = fileName.substringBeforeLast(".")
        val ext = fileName.substringAfterLast(".", "")
        var n = 1
        while (target.exists()) {
            target = File(dir, if (ext.isNotEmpty()) "$base($n).$ext" else "$base($n)")
            n++
        }
        target.writeBytes(bytes)
        return target.name
    }

    private fun dismissSplash() {
        if (splashDismissed) return
        splashDismissed = true
        splashOverlay.animate().alpha(0f).setDuration(250)
            .withEndAction { splashOverlay.visibility = View.GONE }.start()
    }

    // ── 生命周期 ────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.parseColor("#0d1117")
        window.navigationBarColor = Color.parseColor("#0d1117")

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        splashOverlay = findViewById(R.id.splashOverlay)

        registerDownloadReceiver()
        setupWebViewSettings()
        setupWebViewClient()
        setupWebChromeClient()
        setupDownloadListener()

        webView.addJavascriptInterface(WebAppBridge(), "AndroidBridge")

        Handler(Looper.getMainLooper()).postDelayed({ dismissSplash() }, 5000)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl("file:///android_asset/index.html")
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(downloadReceiver)
        webView.stopLoading()
        webView.destroy()
    }

    @Deprecated("onBackPressed is deprecated but still needed for WebView navigation")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    // ── WebView 配置 ────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebViewSettings() {
        webView.setBackgroundColor(Color.parseColor("#0d1117"))
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            @Suppress("SetJavaScriptEnabled")
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            displayZoomControls = false
            builtInZoomControls = false
            mediaPlaybackRequiresUserGesture = false
        }
    }

    private fun setupWebViewClient() {
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                return !url.startsWith("file://") &&
                    !url.startsWith("https://") &&
                    !url.startsWith("http://")
            }
        }
    }

    private fun setupWebChromeClient() {
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback

                val acceptTypes = fileChooserParams.acceptTypes?.toList() ?: emptyList()
                val needsCamera = acceptTypes.any { it.contains("image") || it.isEmpty() }
                val cameraGranted = checkSelfPermission(Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED

                return when {
                    needsCamera && !cameraGranted -> {
                        pendingFileChooserParams = fileChooserParams
                        pendingFilePathCallback = filePathCallback
                        fileChooserCallback = null
                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        true
                    }
                    else -> launchFileChooser(fileChooserParams, filePathCallback)
                }
            }
        }
    }

    /**
     * DownloadListener：拦截 WebView 触发的下载。
     *
     * 两种场景：
     * 1. blob: URL（安全网）——前端通常已通过 AndroidBridge 处理，此处作为兜底。
     *    通过 JS fetch + FileReader 将 blob 内容以 Base64 传给 saveBlobData。
     *    注意：若前端已调用 URL.revokeObjectURL，此时 blob URL 已失效，fetch 会失败，
     *    但前端代码检测到 AndroidBridge 后会跳过 blob 创建，不会走到这里。
     *
     * 2. https: URL ——从 localStorage 读取 GitHub token，通过 DownloadManager 带认证下载。
     */
    private fun setupDownloadListener() {
        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimetype)

            if (url.startsWith("blob:")) {
                // ── blob: URL 安全网 ──────────────────────────────────
                // 以单引号转义 URL 和文件名，防止 JS 注入
                val safeUrl = url.replace("\\", "\\\\").replace("'", "\\'")
                val safeName = fileName.replace("\\", "\\\\").replace("'", "\\'")
                val safeMime = mimetype.replace("\\", "\\\\").replace("'", "\\'")

                val js = """
                    (function(){
                        fetch('$safeUrl')
                            .then(function(r){return r.blob();})
                            .then(function(blob){
                                var reader=new FileReader();
                                reader.onloadend=function(){
                                    var b64=(reader.result||'').toString().split(',')[1]||'';
                                    window.AndroidBridge&&window.AndroidBridge.saveBlobData('$safeName','$safeMime',b64);
                                };
                                reader.readAsDataURL(blob);
                            })
                            .catch(function(e){
                                console.warn('[AndroidDownload] blob fetch failed:',e.message);
                                window.AndroidBridge&&window.AndroidBridge.saveBlobData('$safeName','','');
                            });
                    })()
                """.trimIndent()
                webView.evaluateJavascript(js, null)
                return@setDownloadListener
            }

            // ── https: URL ────────────────────────────────────────────
            // 从 localStorage 读取 GitHub token，注入 Authorization header
            webView.evaluateJavascript(
                "(function(){ try { return localStorage.getItem('github_manager_token') || '' } catch(e){ return '' } })()"
            ) { result ->
                val token = result?.removeSurrounding("\"")?.trim() ?: ""
                checkStoragePermissionAndDownload(url, fileName, userAgent, token)
            }
        }
    }

    // ── 下载流程 ────────────────────────────────────────────────────

    private fun checkStoragePermissionAndDownload(
        url: String,
        fileName: String,
        userAgent: String,
        token: String,
    ) {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            val granted = checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) {
                pendingDownloadUrl = url
                pendingDownloadFileName = fileName
                pendingDownloadUserAgent = userAgent
                pendingDownloadToken = token
                writeStoragePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                return
            }
        }
        startAuthenticatedDownload(url, fileName, userAgent, token)
    }

    private fun startAuthenticatedDownload(
        url: String,
        fileName: String,
        userAgent: String,
        token: String,
    ) {
        runCatching {
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                if (token.isNotBlank()) {
                    addRequestHeader("Authorization", "token $token")
                }
                addRequestHeader("User-Agent", userAgent)
                addRequestHeader("Accept", "application/octet-stream")
                setTitle(fileName)
                setDescription("正在从 GitHub 下载：$fileName")
                setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                )
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(false)
            }
            val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            Toast.makeText(this, "开始下载：$fileName", Toast.LENGTH_SHORT).show()
        }.onFailure { e ->
            Toast.makeText(this, "下载失败：${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    // ── 文件选择辅助 ────────────────────────────────────────────────

    private fun launchFileChooser(
        fileChooserParams: WebChromeClient.FileChooserParams,
        filePathCallback: ValueCallback<Array<Uri>>,
    ): Boolean {
        fileChooserCallback = filePathCallback
        val fileIntent = runCatching { fileChooserParams.createIntent() }.getOrNull()
            ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        val cameraIntent = createCameraIntent()
        val chooserIntent = Intent.createChooser(fileIntent, "选择文件或拍照").apply {
            val extras = listOfNotNull(cameraIntent).toTypedArray()
            if (extras.isNotEmpty()) putExtra(Intent.EXTRA_INITIAL_INTENTS, extras)
        }
        return runCatching { fileChooserLauncher.launch(chooserIntent); true }
            .getOrElse { fileChooserCallback = null; false }
    }

    private fun launchFileChooserWithoutCamera(
        fileChooserParams: WebChromeClient.FileChooserParams,
        filePathCallback: ValueCallback<Array<Uri>>,
    ): Boolean {
        fileChooserCallback = filePathCallback
        val fileIntent = runCatching { fileChooserParams.createIntent() }.getOrNull()
            ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        return runCatching {
            fileChooserLauncher.launch(Intent.createChooser(fileIntent, "选择文件"))
            true
        }.getOrElse { fileChooserCallback = null; false }
    }

    private fun createCameraIntent(): Intent? = runCatching {
        val imageFile = File.createTempFile("camera_capture_", ".jpg", externalCacheDir)
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", imageFile)
        cameraImageUri = uri
        Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
        }
    }.getOrNull()

    // ── 广播 ────────────────────────────────────────────────────────

    private fun registerDownloadReceiver() {
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(downloadReceiver, filter)
        }
    }
}
