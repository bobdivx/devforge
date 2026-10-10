# DevForge Android

Kotlin and Jetpack Compose (Material 3) remote for DevForge. minSdk 26.

- **Connexion**: a single « Se connecter » button. It runs OAuth 2.1 + PKCE (dynamic client registration) in a Custom Tab against the instance SSO, with redirect `app.jeser.devforge:/oauth/callback` and scope `api offline_access`. Tokens are stored encrypted, and the refresh token rotates.
- **Instance**: baked in at build time through `DEVFORGE_DEFAULT_INSTANCE` (default `https://web.jeser.app`). « Autre serveur » lets you pick another one.
- **Tuiles et feuilles**: the home is Apps · Braise · Réglages. Apps is a tile grid (2 columns on phones, 3 to 5 on tablets), like the web HubGrid: icon, name and real status, no switches; current alerts are the « À traiter » tile. The app page mirrors the web dashboard: one status card (a single status, URL chip with open + copy), one action bar (Mettre en ligne / Réessayer / Reconstruire as primary, Redémarrer, Arrêter or Démarrer, Logs; 48 dp targets, labels on tablets) and tiles that open sheets: Braise (chat), Workspace (brouillon, aperçu), Déploiements (history + logs), Paramètres (état, domaine, GitHub, équipe). On wide screens (≥ 900 dp) Braise stays visible on the right. Mettre en ligne, Reconstruire, Redémarrer and Arrêter always ask for confirmation. Logs are cleaned up for mobile (no ANSI codes, short local timestamps).
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
