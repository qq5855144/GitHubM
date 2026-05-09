# ── WebView JavaScript 桥接口 ──────────────────────────────────────────
# 防止 @JavascriptInterface 方法被 R8 混淆或裁剪（JS 通过字符串名调用）
-keepclassmembers class com.github.manager.MainActivity$WebAppBridge {
    public *;
}

# ── AndroidX / AppCompat ───────────────────────────────────────────────
-keep class androidx.appcompat.** { *; }
-keep class androidx.core.content.FileProvider { *; }

# ── WebView 相关 ───────────────────────────────────────────────────────
-keep class android.webkit.** { *; }

# ── 保留行号，便于 Crash 堆栈定位 ─────────────────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
