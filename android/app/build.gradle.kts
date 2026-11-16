plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.savanocine.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.savanocine.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 2
        versionName = "1.1.0"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            val ksFile = file("C:/Android/savano-cine-release.jks")
            if (ksFile.exists()) {
                storeFile = ksFile
                storePassword = "savanocine-local-key"
                keyAlias = "savanocine"
                keyPassword = "savanocine-local-key"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val releaseCfg = signingConfigs.getByName("release")
            if (releaseCfg.storeFile?.exists() == true) {
                signingConfig = releaseCfg
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
