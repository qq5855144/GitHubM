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
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
import com.google.android.material.bottomnavigation.BottomNavigationView
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var splashOverlay: View
    private lateinit var bottomNav: BottomNavigationView
    private lateinit var bottomNavContainer: android.widget.LinearLayout
    private lateinit var navDivider: View
    private lateinit var navBarSpacer: View
    private lateinit var statusBarSpacer: View
    private var splashDismissed = false

    // ── 启动画面双条件门禁 ──────────────────────────────────────────
    /** true = 3s 最小展示时间已到 */
    private var splashMinTimeReached = false
    /** true = React 首屏已就绪（notifyReady 已回调） */
    private var webViewReadyReceived = false
    /** 启动画面专用 Handler：管理打字动画、光标闪烁、定时任务 */
    private val splashHandler = Handler(Looper.getMainLooper())
    /** 光标闪烁 Runnable，dismissSplash 时停止 */
    private var cursorBlinkRunnable: Runnable? = null

    // ── 底部导航：hash 路径 → 菜单项 ID 映射 ───────────────────────
    /**
     * HashRouter 路径前缀 → BottomNavigationView 菜单项 ID。
     * 使用前缀匹配，确保仓库详情等子页面也能正确高亮「仓库」Tab。
     * 顺序很重要：精确路径（"/"）必须排在最后，避免被子路径误命中。
     */
    private val navPathMap = linkedMapOf(
        "/repos"         to R.id.nav_repos,
        "/search"        to R.id.nav_search,
        "/ai-assistant"  to R.id.nav_ai,
        "/settings"      to R.id.nav_settings,
        "/"              to R.id.nav_home,
    )
    /** 当前激活的菜单项，避免重复导航 */
    private var currentNavItemId: Int = R.id.nav_home
    /** 当前底部导航栏选中色（由 notifyAccent 更新，随主题色方案变化） */
    private var currentAccentColor: Int = Color.parseColor("#7c3aed")  // 默认与 Web 端浅色主题 primary 一致
    /** 当前是否为深色模式（用于 notifyAccent 确定未选中色；默认浅色） */
    private var darkTheme: Boolean = false
    /** 广播接收器是否已注册（防止 onDestroy 中 unregisterReceiver 二次崩溃） */
    private var isReceiverRegistered: Boolean = false

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
            val ctx = context ?: return
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: return
            if (id == -1L) return

            val dm = ctx.getSystemService(DOWNLOAD_SERVICE) as? DownloadManager ?: return
            val cursor = dm.query(DownloadManager.Query().setFilterById(id))
            cursor?.use { c ->
                if (!c.moveToFirst()) return
                val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    Toast.makeText(ctx, "✓ 文件已下载完成，保存至「下载」文件夹", Toast.LENGTH_SHORT).show()
                } else {
                    val reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                    val msg = when (reason) {
                        DownloadManager.ERROR_INSUFFICIENT_SPACE      -> "存储空间不足"
                        DownloadManager.ERROR_HTTP_DATA_ERROR          -> "数据传输错误"
                        DownloadManager.ERROR_UNHANDLED_HTTP_CODE      -> "服务器返回错误"
                        DownloadManager.ERROR_CANNOT_RESUME            -> "无法续传，请重试"
                        DownloadManager.ERROR_FILE_ALREADY_EXISTS      -> "文件已存在"
                        DownloadManager.ERROR_TOO_MANY_REDIRECTS       -> "重定向次数过多"
                        403                                            -> "权限不足（403），请检查 Token"
                        404                                            -> "资源不存在（404）"
                        else -> "下载失败（错误码 $reason）"
                    }
                    Toast.makeText(ctx, "❌ $msg", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    // ── JS 桥接口 ───────────────────────────────────────────────────
    inner class WebAppBridge {

        /** React 首屏就绪后调用，与 3s 最小时间共同触发启动遮罩淡出 */
        @JavascriptInterface
        fun notifyReady() {
            webViewReadyReceived = true
            runOnUiThread { tryDismissSplash() }
        }

        /**
         * 主题切换时由 ThemeContext 调用，同步更新原生状态栏与底部导航栏外观。
         *
         * 调用：window.AndroidBridge.notifyTheme(isDark: boolean)
         * @param isDark true = 深色主题，false = 浅色主题
         */
        @JavascriptInterface
        fun notifyTheme(isDark: Boolean) {
            runOnUiThread { applyNativeTheme(isDark) }
        }

        /**
         * 强调色方案切换时由 ThemeContext 调用，同步更新底部导航栏选中图标/文字颜色，
         * 并将 hex 持久化到 SharedPreferences，供下次冷启动时还原到启动画面。
         *
         * 调用：window.AndroidBridge.notifyAccent(primaryHex: string)
         * @param primaryHex 当前方案的主色调 hex 值，如 "#7c3aed"
         */
        @JavascriptInterface
        fun notifyAccent(primaryHex: String) {
            // 持久化 accent hex，供下次冷启动还原到启动画面
            getSharedPreferences("gm_prefs", MODE_PRIVATE)
                .edit().putString("accent_hex", primaryHex).apply()
            runOnUiThread {
                val color = ThemeUtils.parseColorSafe(primaryHex) ?: return@runOnUiThread
                val unselected = ThemeUtils.unselectedNavColor(darkTheme)
                val iconColors = android.content.res.ColorStateList(
                    arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                    intArrayOf(color, unselected)
                )
                bottomNav.itemIconTintList = iconColors
                bottomNav.itemTextColor   = iconColors
                currentAccentColor = color
                // Active Indicator 透明：选中仅靠图标/文字强调色区分
                bottomNav.itemActiveIndicatorColor = android.content.res.ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
            }
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
        val effectiveMime = FileUtils.normalizeMimeType(mimeType)
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
        val existingNames = dir.listFiles()?.map { it.name }?.toSet() ?: emptySet()
        val safeName = FileUtils.resolveFileName(fileName, existingNames)
        File(dir, safeName).writeBytes(bytes)
        return safeName
    }

    /**
     * 双条件门禁：只有「3s 最小展示时间到达」且「React 已就绪」同时满足才消除启动画面。
     * 任意一方先到达时只记录状态等待另一方，保证动画完整播放且不出现白屏闪烁。
     */
    private fun tryDismissSplash() {
        if (splashMinTimeReached && webViewReadyReceived) dismissSplash()
    }

    private fun dismissSplash() {
        if (splashDismissed) return
        splashDismissed = true
        // 停止光标闪烁，取消所有启动画面相关的 Handler 消息
        cursorBlinkRunnable?.let { splashHandler.removeCallbacks(it) }
        splashHandler.removeCallbacksAndMessages(null)

        // 恢复状态栏：启动画面结束，主界面需要显示状态栏
        val ctrl = WindowInsetsControllerCompat(window, window.decorView)
        ctrl.show(WindowInsetsCompat.Type.statusBars())
        ctrl.isAppearanceLightStatusBars = !darkTheme

        // 淡出 + 轻微放大，营造优雅的启动画面消散效果
        splashOverlay.animate()
            .alpha(0f)
            .scaleX(1.04f)
            .scaleY(1.04f)
            .setDuration(380)
            .withEndAction { splashOverlay.visibility = View.GONE }
            .start()
    }

    /**
     * 启动画面打字动画：
     * · 先停顿 300ms（光标独自闪烁，给 Logo/标题渲染留余量）
     * · 随后逐字符顺序填入，每字符间隔 119ms，21 字符共 2499ms
     * · 总时长约 2800ms，与 3s 最小展示窗口对齐，末字出现在 dismiss 之前
     * 使用顺序回调（而非批量投递），保证每字符都在上一帧渲染后才调度下一字符。
     */
    private fun startSplashTypingAnimation() {
        val terminalTextView = splashOverlay.findViewById<TextView>(R.id.splashTerminalText)
            ?: return
        val cursorView = splashOverlay.findViewById<View>(R.id.splashCursor)

        val fullText    = "git clone your_future"
        val startDelayMs = 300L   // 入场停顿：Logo/标题渲染完后才开始打字
        val charDelayMs  = 119L   // 每字符间隔（2499ms / 21 chars ≈ 119ms）

        // 初始清空
        terminalTextView.text = ""

        // 顺序回调：typeChar(0) → typeChar(1) → … 每次只调度下一个字符
        fun typeChar(index: Int) {
            if (splashDismissed || index >= fullText.length) return
            terminalTextView.text = fullText.substring(0, index + 1)
            splashHandler.postDelayed({ typeChar(index + 1) }, charDelayMs)
        }

        // 入场停顿后开始第一个字符
        splashHandler.postDelayed({ typeChar(0) }, startDelayMs)

        // 光标从一开始就闪烁（入场停顿期间也在跳动，增加生命感）
        if (cursorView != null) startCursorBlink(cursorView)
    }

    /** 光标闪烁：每 480ms 切换可见性，dismissSplash 时自动停止 */
    private fun startCursorBlink(cursor: View) {
        val runnable = object : Runnable {
            override fun run() {
                if (splashDismissed) return
                cursor.visibility =
                    if (cursor.visibility == View.VISIBLE) View.INVISIBLE else View.VISIBLE
                splashHandler.postDelayed(this, 480)
            }
        }
        cursorBlinkRunnable = runnable
        splashHandler.post(runnable)
    }

    /**
     * 读取 SharedPreferences 中上次保存的 accent hex，将主题色同步注入启动画面视图。
     * 首次安装或未存储时使用默认紫色（与 Web 端初始主题一致）。
     * 应在 setContentView 之后、WebView 加载之前调用。
     */
    private fun applySavedAccentToSplash() {
        val hex = getSharedPreferences("gm_prefs", MODE_PRIVATE)
            .getString("accent_hex", "#7c3aed") ?: "#7c3aed"  // 默认值与 Web 端浅色主题 primary 一致
        try {
            val color = Color.parseColor(hex)
            val tintList = android.content.res.ColorStateList.valueOf(color)

            // 进度条
            splashOverlay.findViewById<android.widget.ProgressBar>(R.id.splashProgress)
                ?.let { pb ->
                    pb.indeterminateTintList = tintList
                    pb.progressTintList      = tintList
                }

            // 光标块
            splashOverlay.findViewById<View>(R.id.splashCursor)
                ?.setBackgroundColor(color)

            // 终端提示符 $
            splashOverlay.findViewById<android.widget.TextView>(R.id.splashPrompt)
                ?.setTextColor(color)

            // 浅色模式：Octocat 图标跟随 accent 色；深色模式：用资源色 splash_icon_tint（淡紫白），
            // 在深色背景上散发光感，比纯白更协调
            val nightMask = resources.configuration.uiMode and
                android.content.res.Configuration.UI_MODE_NIGHT_MASK
            val isNight = nightMask == android.content.res.Configuration.UI_MODE_NIGHT_YES
            splashOverlay.findViewById<android.widget.ImageView>(R.id.splashLogo)
                ?.imageTintList = if (isNight) {
                    android.content.res.ColorStateList.valueOf(getColor(R.color.splash_icon_tint))
                } else {
                    tintList
                }

            // 四角装饰线：深色下用资源色（更高透明度紫色）；浅色下注入 accent + 透明度
            val cornerColor = if (isNight) {
                getColor(R.color.splash_corner_line)
            } else {
                val cornerAlpha = 0x40  // 25% 透明度
                (cornerAlpha shl 24) or (color and 0x00FFFFFF)
            }
            listOf(
                R.id.splashCornerTL, R.id.splashCornerTR,
                R.id.splashCornerBL, R.id.splashCornerBR
            ).forEach { id ->
                splashOverlay.findViewById<android.view.ViewGroup>(id)?.let { group ->
                    for (i in 0 until group.childCount) {
                        group.getChildAt(i).setBackgroundColor(cornerColor)
                    }
                }
            }
        } catch (_: Exception) { /* 非法 hex，使用 XML 默认色，静默忽略 */ }
    }

    // ── 生命周期 ────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 冷启动时读取上次保存的主题，默认浅色（light 模式）
        val savedTheme = getSharedPreferences("gm_prefs", MODE_PRIVATE)
            .getString("theme_mode", "light") ?: "light"
        val isInitialDark = when (savedTheme) {
            "light" -> false
            "dark"  -> true
            else    -> { // system
                val nightMode = resources.configuration.uiMode and
                    android.content.res.Configuration.UI_MODE_NIGHT_MASK
                nightMode == android.content.res.Configuration.UI_MODE_NIGHT_YES
            }
        }
        // 同步 darkTheme 与系统/用户偏好的初始值，避免 setupWebViewSettings 使用错误颜色
        darkTheme = isInitialDark

        // ── Android 15 边到边适配 ────────────────────────────────────
        // API 35 强制边到边（edge-to-edge），窗口内容延伸至系统栏后方。
        // 显式声明不由框架自动 fit，由我们手动通过 WindowInsets 处理 padding。
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // 系统栏颜色设为透明：边到边模式下内容填充整个窗口，
        // 颜色外观由 WindowInsetsControllerCompat 控制（浅色/深色图标）
        @Suppress("DEPRECATION")
        window.statusBarColor     = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.TRANSPARENT

        // 用 WindowInsetsControllerCompat 统一处理系统栏图标颜色（替代已废弃的 systemUiVisibility）
        val insetsController = WindowInsetsControllerCompat(window, window.decorView)
        insetsController.isAppearanceLightStatusBars     = !isInitialDark
        insetsController.isAppearanceLightNavigationBars = !isInitialDark

        // ── 启动画面沉浸全屏：隐藏状态栏 ────────────────────────────
        // shortEdges 模式 + 状态栏隐藏 = 内容延伸至刘海区域，视觉完全全屏。
        // dismissSplash 时自动恢复，避免主界面也无状态栏。
        insetsController.hide(WindowInsetsCompat.Type.statusBars())
        insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        splashOverlay = findViewById(R.id.splashOverlay)
        bottomNav = findViewById(R.id.bottomNav)
        bottomNavContainer = findViewById(R.id.bottomNavContainer)
        navDivider = findViewById(R.id.navDivider)
        navBarSpacer = findViewById(R.id.navBarSpacer)
        statusBarSpacer = findViewById(R.id.statusBarSpacer)

        // ── 边到边 Insets 处理 ──────────────────────────────────────
        // 【顶部】将系统状态栏高度同步给 statusBarSpacer，确保 WebView 内容
        //   从状态栏下方开始，不与状态栏时钟/电量图标重叠。
        //   启动画面期间状态栏被隐藏，insets.top = 0，spacer 高度 = 0 不占空间；
        //   dismissSplash 恢复状态栏后 insets 重新派发，spacer 自动撑开正确高度。
        ViewCompat.setOnApplyWindowInsetsListener(statusBarSpacer) { _, insets ->
            val statusBarHeight = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            val lp = statusBarSpacer.layoutParams
            lp.height = statusBarHeight
            statusBarSpacer.layoutParams = lp
            insets
        }

        // 【底部】将系统导航条高度同步给 navBarSpacer，使底部容器自然撑开，
        //   BottomNavigationView 始终保持固定 80dp，图标与文字不会因 padding 压缩而重叠。
        //   Kotlin 2.0 K2 编译器对 Java SAM 推断更严格：用 _ 丢弃未使用的 view 参数。
        ViewCompat.setOnApplyWindowInsetsListener(navBarSpacer) { _, insets ->
            val navBarHeight = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            val lp = navBarSpacer.layoutParams
            lp.height = navBarHeight
            navBarSpacer.layoutParams = lp
            insets
        }

        // 读取上次持久化的主题色，并同步应用到启动画面各元素
        applySavedAccentToSplash()
        // 启动打字动画（与 WebView 加载并行进行）
        startSplashTypingAnimation()

        // ── WebView 预加载优化 ───────────────────────────────────────
        // 先完成所有 WebView 配置，再尽早调用 loadUrl，
        // 确保 JS bundle 解析可以在启动画面展示的 3s 内完成。
        setupWebViewSettings()
        setupWebViewClient()
        setupWebChromeClient()
        setupDownloadListener()
        webView.addJavascriptInterface(WebAppBridge(), "AndroidBridge")

        // WebView 最早时机开始加载，充分利用 3s 启动时间预热 React
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl("file:///android_asset/index.html")
        }

        registerDownloadReceiver()
        setupBottomNav()

        // 使用 OnBackPressedDispatcher 替代废弃的 onBackPressed，兼容 Android 13+ 预测性返回手势
        onBackPressedDispatcher.addCallback(this) {
            webView.evaluateJavascript(
                "(function(){ var s=window.history.state; return (s&&s.idx>0)?'1':'0'; })()"
            ) { result ->
                runOnUiThread {
                    if (result?.trim('"') == "1") {
                        webView.evaluateJavascript("window.history.back()", null)
                    } else {
                        handleExitOnBack()
                    }
                }
            }
        }

        // 3s 最小展示时间到达后更新门禁状态，与 notifyReady 共同决定是否消除启动画面
        splashHandler.postDelayed({
            splashMinTimeReached = true
            tryDismissSplash()
        }, 3000L)

        // 6s 硬兜底：防止 notifyReady 永不触发（如 JS 崩溃）时启动画面卡死
        splashHandler.postDelayed({ dismissSplash() }, 6000L)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        super.onDestroy()
        splashHandler.removeCallbacksAndMessages(null)
        // 仅在已注册时注销，防止 onCreate 提前崩溃时 onDestroy 二次抛出 IllegalArgumentException
        if (isReceiverRegistered) {
            try { unregisterReceiver(downloadReceiver) } catch (_: Exception) {}
            isReceiverRegistered = false
        }
        // webView 为 lateinit，若 onCreate 未完成初始化需防止 NPE
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
    }

    /** 双击退出逻辑：2 秒内连按两次返回键才退出，避免误触。 */
    private var backPressedOnce = false
    private val backHandler = Handler(Looper.getMainLooper())

    private fun handleExitOnBack() {
        if (backPressedOnce) {
            // 第二次按下：退出应用
            backHandler.removeCallbacksAndMessages(null)
            finish()
            return
        }
        backPressedOnce = true
        Toast.makeText(this, "再按一次退出应用", Toast.LENGTH_SHORT).show()
        // 2 秒后重置标志
        backHandler.postDelayed({ backPressedOnce = false }, 2000)
    }

    // ── WebView 配置 ────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebViewSettings() {
        // WebView 背景色按 darkTheme 直接选取，避免 getColor 依赖系统 Configuration
        val initBg = if (darkTheme) 0xFF111117.toInt() else 0xFFF8F8FB.toInt()
        webView.setBackgroundColor(initBg)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            // 允许 file:// 页面访问其他 file:// 资源（同目录下 CSS/JS），
            // 解决 Vite 打包后相对路径资源在 WebView 中被跨域拦截导致的白屏问题
            @Suppress("SetJavaScriptEnabled")
            allowFileAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            displayZoomControls = false
            builtInZoomControls = false
            mediaPlaybackRequiresUserGesture = false
        }

        /*
         * 禁用 WebView 原生长按上下文菜单（复制/粘贴/链接预览等）。
         *
         * 根本原因：Android 原生 LongPressTimer (~500ms) 在任何 JS 事件触发之前就会
         * 接管手势，随后发出 touchcancel 通知 JS 层。Radix UI DismissableLayer 收到
         * touchcancel 后指针状态紊乱，遮罩的 pointer-events 无法复位 → 页面卡死。
         * JS 层的 onContextMenu/preventDefault 在此时序下无法拦截原生接管行为。
         *
         * setOnLongClickListener { true }  ：消费 View 级别的 long-click，阻止系统
         *   将长按事件继续向 WebView 内部手势识别器分发。
         * setOnCreateContextMenuListener   ：二次保险，如果菜单仍被创建则立即清空。
         */
        webView.setOnLongClickListener { true }
        webView.setOnCreateContextMenuListener { menu, _, _ -> menu.clear() }
    }

    private fun setupWebViewClient() {
        webView.webViewClient = object : WebViewClient() {

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                android.util.Log.d("WebView", "开始加载: $url")
            }

            /**
             * 主资源（index.html）加载失败时显示原生错误提示并尝试重新加载。
             * 子资源（JS/CSS）失败不阻断页面，由 React 自行处理。
             */
            override fun onReceivedError(
                view: WebView?,
                request: android.webkit.WebResourceRequest?,
                error: android.webkit.WebResourceError?,
            ) {
                super.onReceivedError(view, request, error)
                val url = request?.url?.toString() ?: ""
                val desc = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                    error?.description?.toString() ?: "未知错误"
                } else "加载失败"
                android.util.Log.e("WebView", "资源加载失败: $url — $desc")

                // 仅主 HTML 文件失败时展示 Toast 并触发兜底 dismiss（防止卡在启动画面）
                if (request?.isForMainFrame == true) {
                    android.util.Log.e("WebView", "主页面加载失败，触发启动画面兜底关闭")
                    runOnUiThread { dismissSplash() }
                }
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val url = request?.url?.toString() ?: return false

                // 本地资源：让 WebView 自己处理
                if (url.startsWith("file://")) return false

                // 外部链接（http/https）：一律用系统浏览器打开，避免破坏 React 应用历史栈。
                // 若允许 WebView 加载外部页面，React Router 的 history.state.idx
                // 会丢失，返回键无法回到应用内部路由。
                if (url.startsWith("https://") || url.startsWith("http://")) {
                    runCatching {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                    }
                    return true // 阻止 WebView 自行加载
                }

                // 其他协议（tel:、mailto: 等）：交系统处理
                return true
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

                // 首次加载完成后从 localStorage 读取主题并同步原生颜色
                // github_manager_theme 是 ThemeContext 使用的 key
                view?.evaluateJavascript(
                    "(function(){ return localStorage.getItem('github_manager_theme') || 'dark'; })()"
                ) { result ->
                    val raw = result?.trim('"') ?: "system"
                    // 持久化最新主题设置，供下次冷启动恢复
                    getSharedPreferences("gm_prefs", MODE_PRIVATE)
                        .edit().putString("theme_mode", raw).apply()
                    val resolved = when (raw) {
                        "light" -> false
                        "dark"  -> true
                        else    -> { // system
                            val nightMode = resources.configuration.uiMode and
                                android.content.res.Configuration.UI_MODE_NIGHT_MASK
                            nightMode == android.content.res.Configuration.UI_MODE_NIGHT_YES
                        }
                    }
                    runOnUiThread { applyNativeTheme(resolved) }

                    // 同时读取强调色方案，将选中色同步为存储的 previewColor
                    val accentMap = mapOf(
                        "purple" to "#8B4CF8",
                        "blue"   to "#1d6be3",
                        "green"  to "#16a34a",
                        "orange" to "#f97316",
                        "rose"   to "#e11d48",
                        "cyan"   to "#0891b2",
                    )
                    view?.evaluateJavascript(
                        "(function(){ return localStorage.getItem('github_manager_accent') || 'purple'; })()"
                    ) { accentResult ->
                        val accentId = accentResult?.trim('"') ?: "purple"
                        val hex = accentMap[accentId] ?: "#8B4CF8"
                        try {
                            val color = Color.parseColor(hex)
                            val isDark = darkTheme
                            val unselected = if (isDark) 0xFF9292A8.toInt() else 0xFF64748B.toInt()
                            val iconColors = android.content.res.ColorStateList(
                                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                                intArrayOf(color, unselected)
                            )
                            runOnUiThread {
                                currentAccentColor = color
                                bottomNav.itemIconTintList = iconColors
                                bottomNav.itemTextColor   = iconColors
                                // Active Indicator 透明：选中仅靠图标/文字强调色区分
                                bottomNav.itemActiveIndicatorColor = android.content.res.ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
                            }
                        } catch (_: Exception) { /* 静默忽略 */ }
                    }
                }
            }
        }
    }

    /**
     * 根据当前路径前缀匹配导航菜单项，并更新 BottomNavigationView 选中状态。
     * 采用静默更新方式（禁用监听器 → 修改选中项 → 恢复监听器），避免触发重复导航。
     */
    private fun syncBottomNavSelection(path: String) {
        val targetId = NavUtils.resolveNavItemId(path)

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

    /**
     * 根据 Web 端传来的主题信号，同步更新原生系统 UI 颜色：
     *  - 状态栏背景色 & 图标颜色（深色主题用浅色图标，浅色主题用深色图标）
     *  - 系统导航栏（手势条/按键条）背景色
     *  - 底部导航栏背景色及图标/文字颜色
     *
     * 颜色值与 Web 端 index.css 的 HSL 变量保持一致：
     *   深色：background=#111117，sidebar-background=#0d0d11
     *   浅色：background=#f8f8fb，sidebar-background=#f6f4fa
     * 主题切换时通过 ValueAnimator 平滑过渡颜色，消除生硬跳变。
     */
    private fun applyNativeTheme(isDark: Boolean) {
        darkTheme = isDark

        // ── 目标颜色（直接按 isDark 选择，避免依赖 Android Configuration 的 day/night 资源。
        //    当 Web 端主题与系统主题不同步时（如系统浅色但用户切到深色），
        //    getColor(R.color.xxx) 会读取系统当前 Configuration 对应的资源而非 isDark 参数，
        //    导致颜色始终为系统主题色而非 Web 主题色。硬编码颜色保证 100% 与 Web 端一致。）─────
        val targetMainBg     = if (isDark) 0xFF111117.toInt() else 0xFFF8F8FB.toInt()
        val targetSidebarBg  = if (isDark) 0xFF0D0D11.toInt() else 0xFFF6F4FA.toInt()
        val targetDivider    = if (isDark) 0xFF21212B.toInt() else 0xFFE2DDF5.toInt()
        val targetUnselected = if (isDark) 0xFF9292A8.toInt() else 0xFF64748B.toInt()

        // ── 辅助：从 View 当前 ColorDrawable 中提取颜色，缺省 fallback ─
        fun View.currentBgColor(fallback: Int): Int =
            (background as? android.graphics.drawable.ColorDrawable)?.color ?: fallback

        // ── WebView 背景：平滑过渡，消除主题切换时的白/黑闪烁 ─────────
        val fromWebBg = webView.solidColor.takeIf { it != 0 } ?: targetMainBg
        ValueAnimator.ofObject(ArgbEvaluator(), fromWebBg, targetMainBg).apply {
            duration = 250
            addUpdateListener { webView.setBackgroundColor(it.animatedValue as Int) }
            start()
        }

        // ── 状态栏占位区域背景：与 WebView 背景保持一致，同步切换 ────────
        val fromStatusBg = statusBarSpacer.currentBgColor(targetMainBg)
        ValueAnimator.ofObject(ArgbEvaluator(), fromStatusBg, targetMainBg).apply {
            duration = 250
            addUpdateListener { statusBarSpacer.setBackgroundColor(it.animatedValue as Int) }
            start()
        }

        // ── 系统栏图标颜色（浅色图标=深色主题，深色图标=浅色主题）──────
        val insetsController = WindowInsetsControllerCompat(window, window.decorView)
        insetsController.isAppearanceLightStatusBars     = !isDark
        insetsController.isAppearanceLightNavigationBars = !isDark

        // ── 底部导航容器（含分割线）背景：平滑过渡 ────────────────────
        val fromContainerBg = bottomNavContainer.currentBgColor(targetSidebarBg)
        ValueAnimator.ofObject(ArgbEvaluator(), fromContainerBg, targetSidebarBg).apply {
            duration = 250
            addUpdateListener {
                val c = it.animatedValue as Int
                bottomNavContainer.setBackgroundColor(c)
                navBarSpacer.setBackgroundColor(c)
            }
            start()
        }

        // ── 分割线颜色：平滑过渡 ──────────────────────────────────────
        val fromDivider = navDivider.currentBgColor(targetDivider)
        ValueAnimator.ofObject(ArgbEvaluator(), fromDivider, targetDivider).apply {
            duration = 250
            addUpdateListener { navDivider.setBackgroundColor(it.animatedValue as Int) }
            start()
        }

        // ── 底部导航栏背景（BottomNavigationView 本体，透明）────────────
        val fromNavBg = bottomNav.currentBgColor(targetSidebarBg)
        ValueAnimator.ofObject(ArgbEvaluator(), fromNavBg, targetSidebarBg).apply {
            duration = 250
            addUpdateListener { bottomNav.setBackgroundColor(it.animatedValue as Int) }
            start()
        }

        // ── 底部导航栏图标与文字颜色（选中色保持 accent，未选中色跟随主题）
        val iconColors = android.content.res.ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(currentAccentColor, targetUnselected)
        )
        bottomNav.itemIconTintList = iconColors
        bottomNav.itemTextColor   = iconColors

        // ── M3 Active Indicator 设为透明：选中状态仅通过图标/文字强调色区分，
        //    点击涟漪覆盖整个 item 区域（图标+文字视为整体）
        bottomNav.itemActiveIndicatorColor = android.content.res.ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
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
    /**
     * 解析 GitHub 下载链接重定向，并通过 DownloadManager 入队。
     *
     * 原实现使用裸 Thread { }.start()，无线程池管控：
     *   - 并发下载时每次触发均创建新线程，线程数无上界
     *   - Activity 销毁后线程仍存活，可能泄漏 Activity 引用（通过 this 捕获）
     *
     * 新实现使用 lifecycleScope + Dispatchers.IO：
     *   - IO Dispatcher 底层是共享线程池（默认 64 线程上限），无限制创建线程问题
     *   - lifecycleScope 绑定 Activity 生命周期，onDestroy 时自动取消所有挂起协程
     *   - 无需 runOnUiThread：withContext(Dispatchers.Main) 回到主线程，语义更清晰
     *
     * 重定向解析逻辑（不变）：
     *   1. IO 线程：HttpURLConnection（禁止自动重定向）→ 取状态码 + Location
     *   2. 3xx → Location（预签名 URL，不携带 Authorization）
     *   3. 200 → 原始 URL（携带 Authorization）
     *   4. 其他 / 异常 → 降级直接用原始 URL 提交 DownloadManager
     */
    private fun resolveAndDownload(url: String, fileName: String, token: String) {
        Toast.makeText(this, "准备下载：$fileName", Toast.LENGTH_SHORT).show()

        // lifecycleScope 绑定 Activity 生命周期，Activity 销毁时自动取消
        lifecycleScope.launch {
            // 返回 Pair<finalUrl, finalToken>，null 表示彻底失败
            val result: Pair<String, String>? = withContext(Dispatchers.IO) {
                runCatching {
                    var currentUrl = url
                    var currentToken = token
                    var hops = 0
                    val maxHops = 5   // 防止重定向死循环

                    while (hops < maxHops) {
                        val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                            if (currentToken.isNotBlank()) {
                                setRequestProperty("Authorization", "Bearer $currentToken")
                            }
                            setRequestProperty("User-Agent", "GitHub Manager Android")
                            instanceFollowRedirects = false // 手动跟随重定向，防止 auth 头泄露给 S3/CDN
                            requestMethod = "GET"
                            connectTimeout = 20_000  // 增大：国内访问 GitHub 延迟较高
                            readTimeout = 20_000     // 增大：等待响应头超时
                        }
                        conn.connect()
                        val code = conn.responseCode
                        val location = conn.getHeaderField("Location")
                        conn.disconnect()

                        when {
                            code in 301..308 && !location.isNullOrBlank() -> {
                                // 跟随重定向：一旦离开 api.github.com，清空 token
                                // 防止 Bearer token 被转发给 S3/CDN 预签名 URL 造成签名冲突
                                val isGitHubApi = location.startsWith("https://api.github.com")
                                currentToken = if (isGitHubApi) currentToken else ""
                                currentUrl = location
                                hops++
                            }
                            code == 200 -> {
                                // 无重定向直链，保留原 token（raw.githubusercontent.com 等）
                                return@runCatching Pair(currentUrl, currentToken)
                            }
                            else -> {
                                // 非预期状态码（401/403/404 等），返回 null 进入降级分支
                                return@runCatching null
                            }
                        }
                    }
                    // 超过最大跳数，返回当前解析到的最终 URL（不带 token，已是预签名 URL）
                    Pair(currentUrl, currentToken)
                }.getOrNull() // 网络异常时 getOrNull() 返回 null，走降级分支
            }

            if (result == null) {
                // 解析失败：降级直接提交 DownloadManager，不带 token
                // （对公开仓库有效；私有仓库需依赖 resolveAndDownload 成功路径）
                enqueueDownload(url, fileName, "")
            } else {
                enqueueDownload(result.first, fileName, result.second)
            }
        }
    }

    /** 将最终 URL 提交给 DownloadManager，token 为空时不发送 Authorization header */
    private fun enqueueDownload(url: String, fileName: String, token: String) {
        // 安全化文件名：移除路径分隔符及非法字符，防止 setDestinationInExternalPublicDir 抛异常
        val safeFileName = fileName
            .replace(Regex("[/\\\\:*?\"<>|]"), "_")  // Windows/Unix 非法字符
            .trim()
            .takeIf { it.isNotBlank() } ?: "download_${System.currentTimeMillis()}"

        runCatching {
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                if (token.isNotBlank()) {
                    addRequestHeader("Authorization", "Bearer $token")
                }
                addRequestHeader("User-Agent", "GitHub Manager Android")
                setTitle(safeFileName)
                setDescription("正在从 GitHub 下载：$safeFileName")
                setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                )
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeFileName)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(true) // 允许漫游网络下载（流量用户不应被拒绝）
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
        isReceiverRegistered = true
    }
}
