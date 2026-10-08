# Metronome Desktop

An independent offline desktop metronome for Windows. No server, hosting,
browser, or Node.js installation is needed to run the packaged app.
The `window_app/` directory has its own source, dependencies, and build
configuration within the existing repository. It does not read from or
modify the Render-hosted web project in the parent directory.

Includes BPM controls (30–300), 4/4, 3/4 and 6/8 meters, subdivisions,
accent toggle, saved presets, and keyboard shortcuts.

## Develop and build

With Node.js 22 or newer, run these commands from `window_app/`:

```sh
npm ci
npm test
npm start
npm run test:desktop
npm run build:win
npm run test:windows-build  # verify embedded icons and upload sizes after an x64 build
# For Windows on ARM:
npm run build:win:arm64
```

The source interface and its local event adapter live in `public/`.
`desktop/main.js` opens the app with a stable private origin so presets
persist across launches. No HTTP listener or Socket.IO dependency is used.

## Run on Windows

Double-click the portable EXE in `dist/`. For a portable ZIP, extract and
run its EXE. For the folder ZIP produced by electron-builder, extract the
whole folder and keep its support files together. Windows may prompt
because these builds are unsigned. Presets are saved in your user profile.

Builds include a custom metronome icon in the app and portable launcher.
`assets/icon.png` is the generated master; `assets/icon.ico` contains the
Windows sizes. `npm run icon` regenerates the ICO. The original artwork
prompt and generation method are recorded in `assets/icon-prompt.txt`.
The pure JavaScript packaging hook embeds icons without requiring Wine.

The `-portable.zip` contains just the portable EXE and fits Drive's 100 MiB
connector upload limit for the current x64 build. Extract and double-click.
Build outputs and dependencies are excluded from Git.
