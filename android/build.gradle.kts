// 顶层构建文件，子模块通过 apply false 各自声明插件版本
plugins {
    id("com.android.application") version "8.3.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.25" apply false
}
