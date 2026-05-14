# ── WebView JavaScript 桥接口 ──────────────────────────────────────────
# 防止 @JavascriptInterface 方法被 R8 混淆或裁剪（JS 通过字符串名调用）
-keepclassmembers class com.github.manager.MainActivity$WebAppBridge {
    public *;
}

# ── AndroidX / AppCompat ───────────────────────────────────────────────
-keep class androidx.appcompat.** { *; }
-keep class androidx.core.content.FileProvider { *; }

# ── Material3 / BottomNavigationView ──────────────────────────────────
# material 1.12.0 部分组件通过反射访问内部方法，防止 R8 裁剪
-keep class com.google.android.material.** { *; }
-dontwarn com.google.android.material.**

# ── WebView 相关 ───────────────────────────────────────────────────────
-keep class android.webkit.** { *; }

# ── Kotlin 协程 / Lambda / 内部类 ─────────────────────────────────────
-keep class kotlin.** { *; }
-keep class kotlinx.** { *; }
-dontwarn kotlin.**
-dontwarn kotlinx.**

# ── Activity Result API（registerForActivityResult） ──────────────────
-keep class androidx.activity.** { *; }
-keep class androidx.fragment.** { *; }

# ── 保留行号，便于 Crash 堆栈定位 ─────────────────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
