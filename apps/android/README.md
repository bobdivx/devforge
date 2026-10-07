# DevForge Android

Kotlin and Jetpack Compose (Material 3) remote for DevForge. minSdk 26.

- **Connexion**: a single « Se connecter » button. It runs OAuth 2.1 + PKCE (dynamic client registration) in a Custom Tab against the instance SSO, with redirect `app.jeser.devforge:/oauth/callback` and scope `api offline_access`. Tokens are stored encrypted, and the refresh token rotates.
- **Instance**: baked in at build time through `DEVFORGE_DEFAULT_INSTANCE` (default `https://web.jeser.app`). « Autre serveur » lets you pick another one.
- **Alertes**: WorkManager polls `GET /api/v1/mobile/inbox` every 15 min (deploy failed, app down, Braise waiting for an OK) and posts to two notification channels. No Firebase.
- **Téléchargement**: the DevForge web UI serves the APK at `/app/android` (backend `GET /api/v1/android/apk`, cached from the GitHub Release asset).

## Build

```bash
export JAVA_HOME=/path/to/jdk-17 ANDROID_HOME=/path/to/android-sdk
./gradlew :app:testDebugUnitTest          # unit tests + Robolectric
DEVFORGE_SHOTS_DIR=/tmp/shots ./gradlew :app:recordRoborazziDebug   # screenshots
./gradlew :app:assembleDebug
```

Release signing reads `DEVFORGE_KEYSTORE_FILE`, `DEVFORGE_KEYSTORE_PASSWORD`, `DEVFORGE_KEY_ALIAS` and `DEVFORGE_KEY_PASSWORD`, or a local `keystore.properties` that is never committed. CI (`release.yml`) signs the APK with the `ANDROID_*` repo secrets and attaches `DevForge-Android-<version>.apk` to the GitHub Release.
