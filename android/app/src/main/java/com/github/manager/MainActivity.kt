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
import com.google.android.material.bottomnavigation.BottomNavigationView
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var splashOverlay: View
    private lateinit var bottomNav: BottomNavigationView
    private var splashDismissed = false

    // ── 底部导航：hash 路径 → 菜单项 ID 映射 ───────────────────────
    /**
     * HashRouter 路径前缀 → BottomNavigationView 菜单项 ID。
     * 使用前缀匹配，确保仓库详情等子页面也能正确高亮「仓库」Tab。
     * 顺序很重要：精确路径（"/"）必须排在最后，避免被子路径误命中。
     */
    private val navPathMap = linkedMapOf(
        "/repos"         to R.id.nav_repos,
        "/search"        to R.id.nav_search,
        "/notifications" to R.id.nav_notifications,
        "/settings"      to R.id.nav_settings,
        "/"              to R.id.nav_home,
    )
    /** 当前激活的菜单项，避免重复导航 */
    private var currentNavItemId: Int = R.id.nav_home

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
    private var pendingDownloadToken: String = ""

    private val writeStoragePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            resolveAndDownload(pendingDownloadUrl, pendingDownloadFileName, pendingDownloadToken)
        } else {
            Toast.makeText(this, "存储权限被拒绝，无法保存文件", Toast.LENGTH_LONG).show()
        }
        pendingDownloadUrl = ""; pendingDownloadFileName = ""; pendingDownloadToken = ""
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
         * ArtifactsPage 调用：传原始 GitHub URL + token，由原生完成"解析重定向 → 下载"流程。
         *
         * GitHub 所有下载链接（releases/archive/artifacts）均会 302 重定向到
         * S3/CDN 预签名 URL。直接把 Authorization header 转发给预签名 URL 会
         * 触发 S3 签名冲突，导致下载失败。此方法先解析最终 URL 再下载，避免此问题。
         *
         * 调用：window.AndroidBridge.downloadFile(url, fileName, token)
         */
        @JavascriptInterface
        fun downloadFile(url: String, fileName: String, token: String) {
            runOnUiThread {
                checkStoragePermissionAndDownload(url, fileName, token)
            }
        }

        /**
         * ExportPage 调用：传内存文本内容（Base64 编码），由原生写入「下载」文件夹。
         * 适用于 JSON/CSV 导出等纯文本内容，不经过 DownloadManager。
         *
         * 调用：window.AndroidBridge.saveBlobData(fileName, mimeType, base64Content)
         * 此方法运行在 JavascriptInterface 后台线程。
         */
        @JavascriptInterface
        fun saveBlobData(fileName: String, mimeType: String, base64Content: String) {
            if (base64Content.isEmpty()) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "保存失败：内容为空", Toast.LENGTH_SHORT).show()
                }
                return
            }
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

    // ── MediaStore / Legacy 存储写入 ────────────────────────────────

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
        window.navigationBarColor = Color.parseColor("#161b22")

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        splashOverlay = findViewById(R.id.splashOverlay)
        bottomNav = findViewById(R.id.bottomNav)

        registerDownloadReceiver()
        setupWebViewSettings()
        setupWebViewClient()
        setupWebChromeClient()
        setupDownloadListener()
        setupBottomNav()

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

            /**
             * 每次页面导航完成后，从 URL fragment（HashRouter）中解析当前路径，
             * 并同步更新底部导航栏的选中状态。
             * 例如：file:///android_asset/index.html#/repos/owner/name → path = "/repos/..."
             */
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                val hash = url?.substringAfter("#", "") ?: return
                val path = if (hash.startsWith("/")) hash else "/$hash"
                syncBottomNavSelection(path)
            }
        }
    }

    /**
     * 根据当前路径前缀匹配导航菜单项，并更新 BottomNavigationView 选中状态。
     * 采用静默更新方式（禁用监听器 → 修改选中项 → 恢复监听器），避免触发重复导航。
     */
    private fun syncBottomNavSelection(path: String) {
        val targetId = navPathMap.entries.firstOrNull { (prefix, _) ->
            if (prefix == "/") path == "/" else path.startsWith(prefix)
        }?.value ?: R.id.nav_home

        if (targetId == currentNavItemId) return
        currentNavItemId = targetId

        // 静默更新：临时移除监听器，防止 setSelectedItemId 触发重复路由跳转
        bottomNav.setOnItemSelectedListener(null)
        bottomNav.selectedItemId = targetId
        setupBottomNavListener()
    }

    /**
     * 初始化底部导航栏：绑定点击监听，通过 evaluateJavascript 修改 HashRouter location。
     * 仅在目标 Tab 与当前页面不同时才执行导航，避免重刷当前页。
     */
    private fun setupBottomNav() {
        bottomNav.selectedItemId = R.id.nav_home
        setupBottomNavListener()
    }

    private fun setupBottomNavListener() {
        bottomNav.setOnItemSelectedListener { item ->
            val path = navPathMap.entries.firstOrNull { it.value == item.itemId }?.key ?: "/"
            val targetId = item.itemId
            if (targetId == currentNavItemId) return@setOnItemSelectedListener false

            // 通过修改 location.hash 触发 HashRouter 路由跳转
            val safeHash = path.replace("'", "\\'")
            webView.evaluateJavascript(
                "(function(){ window.location.hash = '$safeHash'; })()", null
            )
            true
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
     * 2. https: URL——从 localStorage 读取 token，走"解析重定向 → DownloadManager"流程。
     */
    private fun setupDownloadListener() {
        webView.setDownloadListener { url, _, contentDisposition, mimetype, _ ->
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimetype)

            if (url.startsWith("blob:")) {
                // blob: URL 安全网：通过 JS 读内容再传给 saveBlobData
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

            // https: URL：读取 token 后解析重定向再下载
            webView.evaluateJavascript(
                "(function(){ try { return localStorage.getItem('github_manager_token') || '' } catch(e){ return '' } })()"
            ) { result ->
                val token = result?.removeSurrounding("\"")?.trim() ?: ""
                checkStoragePermissionAndDownload(url, fileName, token)
            }
        }
    }

    // ── 下载流程 ────────────────────────────────────────────────────

    private fun checkStoragePermissionAndDownload(url: String, fileName: String, token: String) {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            val granted = checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) {
                pendingDownloadUrl = url
                pendingDownloadFileName = fileName
                pendingDownloadToken = token
                writeStoragePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                return
            }
        }
        resolveAndDownload(url, fileName, token)
    }

    /**
     * 核心修复：先在后台线程解析 GitHub 下载链接的最终 URL，再交给 DownloadManager。
     *
     * 问题根因：
     *   GitHub 所有下载端点（browser_download_url / zipball / tarball / archive_download_url）
     *   均会返回 302 重定向到 AWS S3 或 CDN 的预签名 URL。
     *   DownloadManager 默认跟随重定向并转发所有自定义请求头，
     *   将 Authorization header 发送给 S3 预签名 URL 会触发签名冲突（403 SignatureDoesNotMatch），
     *   下载任务立刻失败——这就是"有通知但下载失败"的原因。
     *
     * 修复逻辑：
     *   1. 用 HttpURLConnection（禁止自动重定向）向原始 URL 发一次带 auth 的请求
     *   2. 若收到 3xx：取出 Location 头，用该预签名 URL 给 DownloadManager（不带 auth）
     *   3. 若收到 200（无重定向）：直接下载，携带 auth
     *   4. 若发生异常：回退到原始 URL + auth（降级处理）
     */
    private fun resolveAndDownload(url: String, fileName: String, token: String) {
        Toast.makeText(this, "准备下载：$fileName", Toast.LENGTH_SHORT).show()

        Thread {
            runCatching {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("User-Agent", "GitHub Manager Android")
                    // ⚠️ 不设置 Accept 头：
                    //   GitHub API 端点（api.github.com）仅接受 application/vnd.github+json，
                    //   发送 application/octet-stream 会触发 415 Unsupported Media Type。
                    //   此步骤只需要拿到 Location 头完成重定向解析，无需指定内容类型。
                    instanceFollowRedirects = false   // 手动处理重定向，避免 auth 头泄露给 S3
                    requestMethod = "GET"
                    connectTimeout = 15_000
                    readTimeout = 5_000
                }
                conn.connect()
                val code = conn.responseCode
                val location = conn.getHeaderField("Location")
                conn.disconnect()

                when {
                    code in 300..399 && !location.isNullOrBlank() -> {
                        // GitHub → 重定向到预签名 URL，不携带 auth（预签名 URL 已含鉴权参数）
                        runOnUiThread { enqueueDownload(location, fileName, token = "") }
                    }
                    code == 200 -> {
                        // 直链，无重定向，携带 auth
                        runOnUiThread { enqueueDownload(url, fileName, token) }
                    }
                    else -> {
                        runOnUiThread {
                            Toast.makeText(
                                this, "下载准备失败（HTTP $code）", Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            }.onFailure {
                // 网络异常等：直接尝试（DownloadManager 自行处理）
                runOnUiThread { enqueueDownload(url, fileName, token) }
            }
        }.start()
    }

    /** 将最终 URL 提交给 DownloadManager，token 为空时不发送 Authorization header */
    private fun enqueueDownload(url: String, fileName: String, token: String) {
        runCatching {
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                if (token.isNotBlank()) {
                    addRequestHeader("Authorization", "Bearer $token")
                }
                addRequestHeader("User-Agent", "GitHub Manager Android")
                // 不设置 Accept 头：S3/CDN 预签名 URL 不需要，设置反而可能引发问题
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
