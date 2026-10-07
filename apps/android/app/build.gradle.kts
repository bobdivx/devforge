import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

/** Version publiée = version DevForge (ex. 2.0.193), injectée par la CI de release. */
val appVersionName: String = (System.getenv("DEVFORGE_VERSION") ?: "0.1.0-dev").removePrefix("v")
val appVersionCode: Int = run {
    val parts = appVersionName.substringBefore('-').split('.').mapNotNull { it.toIntOrNull() }
    if (parts.size == 3) parts[0] * 1_000_000 + parts[1] * 1_000 + parts[2] else 1
}

/**
 * Signature release : variables d'environnement (CI) ou `keystore.properties` local (non versionné).
 * Sans clé, l'APK release est signé avec la clé debug (signalé dans le nom du fichier par la CI).
 */
val releaseSigning: Map<String, String>? = run {
    val props = Properties()
    rootProject.file("keystore.properties").takeIf { it.exists() }?.inputStream()?.use(props::load)
    fun v(env: String, prop: String) = System.getenv(env)?.takeIf { it.isNotBlank() } ?: props.getProperty(prop)
    val file = v("DEVFORGE_KEYSTORE_FILE", "storeFile")
    val storePw = v("DEVFORGE_KEYSTORE_PASSWORD", "storePassword")
    val alias = v("DEVFORGE_KEY_ALIAS", "keyAlias")
    val keyPw = v("DEVFORGE_KEY_PASSWORD", "keyPassword")
    if (file != null && storePw != null && alias != null && keyPw != null && File(file).exists()) {
        mapOf("file" to file, "storePw" to storePw, "alias" to alias, "keyPw" to keyPw)
    } else {
        null
    }
}

android {
    namespace = "app.jeser.devforge"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.jeser.devforge"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["oauthScheme"] = "app.jeser.devforge"
        // Instance par défaut : l'utilisateur n'a rien à saisir, juste « Se connecter ».
        buildConfigField("String", "DEFAULT_INSTANCE", "\"${System.getenv("DEVFORGE_DEFAULT_INSTANCE") ?: "https://web.jeser.app"}\"")
    }

    signingConfigs {
        releaseSigning?.let { s ->
            create("release") {
                storeFile = File(s.getValue("file"))
                storePassword = s.getValue("storePw")
                keyAlias = s.getValue("alias")
                keyPassword = s.getValue("keyPw")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (releaseSigning != null) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
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
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { test ->
                test.systemProperty("robolectric.pixelCopyRenderMode", "hardware")
                test.systemProperty("devforge.shotsDir", System.getenv("DEVFORGE_SHOTS_DIR") ?: "${project.layout.buildDirectory.get()}/shots")
                test.maxHeapSize = "2g"
            }
        }
    }
    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/LICENSE*")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.windowsize)
    implementation(libs.compose.material.icons)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.okhttp)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.work.runtime)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.junit)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
}
