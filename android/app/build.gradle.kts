plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.github.manager"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.github.manager"
        minSdk = 26          // Android 8.0+，覆盖主流设备
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            // Release 开启代码混淆与资源压缩，减小 APK 体积
            isMinifyEnabled = true
            isShrinkResources = true
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
