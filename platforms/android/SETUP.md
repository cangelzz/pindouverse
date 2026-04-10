# Android Platform Setup

## Prerequisites
- Android Studio with SDK 24+ (Android 7.0)
- Android NDK (via SDK Manager → SDK Tools → NDK)
- Java JDK 17+
- Rust Android targets:
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```
- Set environment variables:
  ```bash
  export ANDROID_HOME=$HOME/Android/Sdk        # or your SDK path
  export NDK_HOME=$ANDROID_HOME/ndk/<version>
  ```

## First-time Setup
```bash
npm run android:init
```
This generates the Android project in `src-tauri/gen/android/`.

## Development
```bash
npm run android:dev
```

## Build
```bash
npm run android:build
```

## Entry Point
The Android build uses `platforms/android/main.tsx` which initializes `MobileAdapter`.

## Mobile-specific Rust Commands
- `get_mobile_documents_dir` — Returns app documents directory
- `share_file` — Placeholder for share sheet (needs `tauri-plugin-share`)

## TODO when build tools available
1. Run `npm run android:init`
2. Add `tauri-plugin-share` to Cargo.toml for native share sheet
3. Test touch interactions (pan/zoom/draw)
4. Adjust UI for smaller screens if needed
5. Configure signing keys for release builds
