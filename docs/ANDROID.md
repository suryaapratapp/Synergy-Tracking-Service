# Tex-Trak for Android

The Android app is the same web app wrapped with [Capacitor](https://capacitorjs.com).
The interface is not duplicated: `npm run build` produces `dist/`, and Capacitor
packages that into a native app. Changing the web code changes the Android app
the next time it is built.

- App id: `com.circai.textrak` (**cannot be changed once published to Google Play**)
- Min Android: 7.0 (API 24) · Target: Android 16 (API 36)
- Camera: Android's own permission dialog appears the moment a user first taps the
  camera button (`MainActivity.java` bridges this). If it was refused, the app says so and shows an
  **Open settings** button that goes to the app's page in Android Settings. Hardware scanners
  (Bluetooth rings, the Nordic ID HH83) need nothing — they type as a keyboard.

> Keys and passwords are never stored in this repository. See "Signing" below.

## Rebuilding after a change

```bash
npm run android:sync          # builds the web app and copies it into android/
cd android && ./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

One-off setup on a new machine (macOS, Homebrew):

```bash
brew install openjdk@21 && brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

## Installing on a phone (no Play Store)

1. Send `Tex-Trak.apk` to the phone (email, drive link, USB).
2. Open it. Android asks once to allow installs from that app — allow it.
3. Tap **Install**.

To update, install a newer APK over the top. Sign-in is kept.
A newer build must have a **higher `versionCode`** in `android/app/build.gradle`
or Android refuses to replace the old one.

## Signing

Release builds are signed with a key kept **outside the repo**:

```
~/.tex-trak-signing/tex-trak-release.jks
~/.tex-trak-signing/keystore.properties   (passwords)
```

`android/app/build.gradle` reads it from there. If the folder is missing the
release still builds, but unsigned and not installable.

**Back this folder up somewhere safe and private.** Android only accepts an
update signed by the same key as the installed app; if it is lost, existing
installs cannot be upgraded and the app would need a new id. It cannot be
recovered or reissued.

## Google Play

Play takes the bundle, not the APK: `app/build/outputs/bundle/release/app-release.aab`.
You need a Google Play developer account (one-off $25) and a privacy policy URL.
Opt in to Play App Signing when asked — Google then holds the final signing key,
and the key above becomes the *upload* key, which Google can reset if lost.

## Known limits

- No push notifications. Install, take-down, scanning and guest sign-in work with no
  signal (jobs are saved on the phone and sent later — see HANDOVER.md, *Working
  offline*); the dashboard, products and reports need a connection.
- The launcher icon is a plain teal square with a scan glyph — a placeholder until
  there is real branding (`android/app/src/main/res/mipmap-*`).
