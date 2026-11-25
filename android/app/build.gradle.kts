import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val keystoreProps = Properties()
val keystorePropsFile = rootProject.file("keystore.properties")
if (keystorePropsFile.exists()) {
    keystorePropsFile.inputStream().use { keystoreProps.load(it) }
}

fun resolveSigningValue(propKey: String, envKey: String): String? {
    val fromProp = keystoreProps.getProperty(propKey)?.trim()
    if (!fromProp.isNullOrEmpty()) return fromProp
    val fromEnv = System.getenv(envKey)?.trim()
    return if (!fromEnv.isNullOrEmpty()) fromEnv else null
}

android {
    namespace = "com.savanocine.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.savanocine.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 10000
        versionName = "1.0.0"

        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            val storePath = resolveSigningValue("storeFile", "SAVANO_CINE_KEYSTORE_PATH")
            val storePass = resolveSigningValue("storePassword", "SAVANO_CINE_KEYSTORE_PASSWORD")
            val alias = resolveSigningValue("keyAlias", "SAVANO_CINE_KEY_ALIAS")
            val keyPass = resolveSigningValue("keyPassword", "SAVANO_CINE_KEY_PASSWORD")
            if (storePath != null && storePass != null && alias != null && keyPass != null) {
                val ksFile = file(storePath)
                if (ksFile.exists()) {
                    storeFile = ksFile
                    storePassword = storePass
                    keyAlias = alias
                    keyPassword = keyPass
                }
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
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
