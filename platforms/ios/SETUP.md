# iOS Platform Setup

## Prerequisites
- macOS with Xcode 15+
- Xcode Command Line Tools: `xcode-select --install`
- Rust iOS targets: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
- CocoaPods: `sudo gem install cocoapods`

## First-time Setup
```bash
npm run ios:init
```
This generates the Xcode project in `src-tauri/gen/apple/`.

## Development
```bash
npm run ios:dev
```

## Build
```bash
npm run ios:build
```

## Entry Point
The iOS build uses `platforms/ios/main.tsx` which initializes `MobileAdapter`.
To wire it up, update `src-tauri/tauri.conf.json` iOS-specific `frontendDist` 
or use the shared `src/main.tsx` and conditionally detect platform.

## Mobile-specific Rust Commands
- `get_mobile_documents_dir` — Returns app documents directory
- `share_file` — Placeholder for share sheet (needs `tauri-plugin-share`)

## TODO when build tools available
1. Run `npm run ios:init`
2. Add `tauri-plugin-share` to Cargo.toml for native share sheet
3. Test touch interactions (pan/zoom/draw)
4. Adjust UI for smaller screens if needed
