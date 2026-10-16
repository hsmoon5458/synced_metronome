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

**Recommended:** run the `-Setup.exe` once. It installs for the current user
without administrator rights and creates Start menu and desktop shortcuts.
Open **Synced Metronome** from the Start menu and pin that shortcut to the
taskbar. Unpin any shortcut created from the old portable build first.
Later launches use the installed files immediately, without extracting the
entire runtime again. Existing saved presets use the same app data profile.

The portable EXE still works without installation, but extracts its runtime
on every launch and is slower. For the portable ZIP, extract and run its EXE.
New portable builds use a separate temporary folder per launch and direct
taskbar pins to the original launcher. Keep that launcher at a stable path.
The full folder ZIP is another option: extract once, keep all support files
together, and run `Synced Metronome.exe` in that folder.

Windows may prompt because these builds are unsigned. Presets are saved in
your user profile and are preserved on uninstall.

## Troubleshooting

Errors are recorded locally in `diagnostics.log` in the app's user-data
folder (`%APPDATA%/metronome-desktop` in the Windows build). The
renderer recovery dialog shows the exact log path and offers to reopen the
window; saved presets are retained and playback restarts only when you press
Start. Crash dumps stay on your computer and are never uploaded. If an
error happens again, include the message and the diagnostic log when reporting
it. A crash without its error details cannot be conclusively diagnosed.

Playback now cancels pending starts and scheduled audio on Stop, disconnects
finished audio nodes, and keeps at most one pending visual update while hidden.

Builds include a custom metronome icon in the app and portable launcher.
`assets/icon.png` is the generated master; `assets/icon.ico` contains the
Windows sizes. `npm run icon` regenerates the ICO. The original artwork
prompt and generation method are recorded in `assets/icon-prompt.txt`.
The pure JavaScript packaging hook embeds icons without requiring Wine.

The `-Setup.zip` contains the recommended installer and fits Drive's 100 MiB
connector upload limit for the current x64 build. Extract and run Setup once.
The optional `-portable.zip` contains the slower portable launcher and may
exceed the connector's upload limit.
Build outputs and dependencies are excluded from Git.
