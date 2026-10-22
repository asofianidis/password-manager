import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Same version as the desktop app (package.json at the repo root).
@Suppress("UNCHECKED_CAST")
val desktopVersion = (JsonSlurper().parse(File(rootDir.parentFile, "package.json")) as Map<String, Any>)["version"] as String

android {
    namespace = "com.asofianidis.passwordmanager"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.asofianidis.passwordmanager"
        // 28: onSaveRequest can hand off to an activity, and browsers report the page's scheme
        minSdk = 28
        targetSdk = 36
        versionName = desktopVersion
        versionCode = desktopVersion.split(".").map { it.toInt() }.let { (a, b, c) -> a * 10_000_000 + b * 100_000 + c }
    }

    // Release signing comes from the environment (CI secrets); without it, release builds are unsigned.
    val keystore = System.getenv("PM_ANDROID_KEYSTORE")?.takeIf { it.isNotBlank() && File(it).exists() }
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = File(keystore)
                storePassword = System.getenv("PM_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("PM_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("PM_ANDROID_KEY_PASSWORD") ?: System.getenv("PM_ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        // A separate package id lets a debug build sit next to the release app instead of
        // replacing it (and wiping its vault).
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            // R8 drops the unused parts of the icon set and BouncyCastle (55 MB → a few MB)
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources.excludes += setOf("META-INF/{AL2.0,LGPL2.1}", "META-INF/versions/9/OSGI-INF/MANIFEST.MF")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended:1.7.8")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.fragment:fragment-ktx:1.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-process:2.11.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.autofill:autofill:1.3.0")

    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.86")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
