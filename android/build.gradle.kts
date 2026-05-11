// 顶层构建文件，子模块通过 apply false 各自声明插件版本
plugins {
    id("com.android.application") version "8.5.2" apply false   // AGP 8.5+ 正式支持 compileSdk 35
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false  // Kotlin 2.0 适配 API 35
}
