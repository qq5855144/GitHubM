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
    compileSdk = 34

    defaultConfig {
        applicationId = "com.github.manager"
        minSdk = 26          // Android 8.0+，覆盖主流设备
        targetSdk = 34
        versionCode = ciVersionCode
        versionName = ciVersionName
    }

    // ── 签名配置 ─────────────────────────────────────────────────────
    signingConfigs {
        create("release") {
            if (ciKeystorePath.isNotEmpty()) {
                // CI 环境：使用 workflow 传入的 keystore 路径
                storeFile = file(ciKeystorePath)
                storePassword = ciStorePass
                keyAlias = ciKeyAlias
                keyPassword = ciKeyPass
            } else {
                // 本地构建：优先使用仓库默认签名，否则回退到 debug keystore
                val defaultKeystore = rootProject.file("release.keystore")
                if (defaultKeystore.exists()) {
                    storeFile = defaultKeystore
                    storePassword = "GithubManager@CI"
                    keyAlias = "github-manager"
                    keyPassword = "GithubManager@CI"
                } else {
                    val debugKeystore = File(System.getProperty("user.home"), ".android/debug.keystore")
                    storeFile = debugKeystore
                    storePassword = "android"
                    keyAlias = "androiddebugkey"
                    keyPassword = "android"
                }
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

    // assets 目录由 CI workflow 在构建前填充（dist/ 内容）
    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // activity-ktx：registerForActivityResult / ActivityResultContracts
    implementation("androidx.activity:activity-ktx:1.9.3")
    // Material 组件：BottomNavigationView
    implementation("com.google.android.material:material:1.12.0")
}
