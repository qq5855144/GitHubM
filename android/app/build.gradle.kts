plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ── CI 注入的版本信息（本地构建回退到 1 / "1.0.local"）──────────────
val ciVersionCode  = System.getenv("VERSION_CODE")?.toIntOrNull() ?: 1
val ciVersionName  = System.getenv("VERSION_NAME") ?: "1.0.local"

// ── Release 签名（CI 注入；本地 fallback 到 debug keystore）──────────
val ciKeystorePath = System.getenv("KEYSTORE_PATH") ?: ""
val ciStorePass    = System.getenv("STORE_PASSWORD") ?: "android"
val ciKeyAlias     = System.getenv("KEY_ALIAS")      ?: "androiddebugkey"
val ciKeyPass      = System.getenv("KEY_PASSWORD")   ?: "android"

android {
    namespace = "com.github.manager"
    compileSdk = 35   // Android 15

    defaultConfig {
        applicationId = "com.github.manager"
        minSdk = 26          // Android 8.0+，覆盖主流设备
        targetSdk = 35       // Android 15
        versionCode = ciVersionCode
        versionName = ciVersionName
    }

    // ── 签名配置 ─────────────────────────────────────────────────────
    signingConfigs {
        create("release") {
            // CI 提供 KEYSTORE_PATH 时使用 release 签名，否则使用 debug keystore
            if (ciKeystorePath.isNotEmpty()) {
                storeFile = file(ciKeystorePath)
                storePassword = ciStorePass
                keyAlias = ciKeyAlias
                keyPassword = ciKeyPass
            } else {
                // 本地开发：使用 Android 默认 debug.keystore，签名一致可覆盖安装
                val debugKeystore = File(System.getProperty("user.home"), ".android/debug.keystore")
                storeFile = debugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            // Release 开启代码混淆与资源压缩，减小 APK 体积
            isMinifyEnabled = true
            isShrinkResources = true
            // 使用上方声明的 release 签名配置，确保覆盖安装兼容
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // Robolectric 单元测试：使用 includeAndroidResources 允许测试读取 R 资源
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all {
                it.jvmArgs("-Djunit.jupiter.extensions.autodetection.enabled=true")
            }
        }
    }

    // assets 目录由 CI workflow 在构建前填充（dist/ 内容）
    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
        }
    }
}

dependencies {
    // core-ktx 1.13.1：最新稳定版，WindowInsetsCompat / ViewCompat 完整支持
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // activity-ktx：registerForActivityResult / OnBackPressedDispatcher / EdgeToEdge / lifecycleScope
    implementation("androidx.activity:activity-ktx:1.9.3")
    // lifecycle-runtime-ktx：显式声明 lifecycleScope / repeatOnLifecycle，避免依赖传递版本不一致
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    // Material3 组件：BottomNavigationView（material 1.12.0 默认使用 Material3 属性体系）
    implementation("com.google.android.material:material:1.12.0")
    // Kotlin Coroutines Android：lifecycleScope / Dispatchers.IO / Dispatchers.Main
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // ── 单元测试依赖（仅参与 test 源集，不打包进 APK）──────────────
    // JUnit 4：标准 Android 单元测试运行器
    testImplementation("junit:junit:4.13.2")
    // Kotlin Test：assertThat / assertEquals 等断言扩展
    testImplementation("org.jetbrains.kotlin:kotlin-test:2.0.21")
    // Kotlin Test JUnit4 集成
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.0.21")
    // Robolectric：在 JVM 上模拟 Android 环境（android.graphics.Color 等）
    testImplementation("org.robolectric:robolectric:4.12.2")
    // AndroidX Test Core（ApplicationProvider / ActivityScenario）
    testImplementation("androidx.test:core-ktx:1.6.1")
    // MockK：Kotlin 原生 mock 框架
    testImplementation("io.mockk:mockk:1.13.12")
}
