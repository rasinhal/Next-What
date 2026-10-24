# Bubble Pop

A first test game for a camera-based motion game: stand in front of the camera and pop floating bubbles with your hands. No controller, no extra hardware.

It exists to answer one question: is body tracking fast and accurate enough on the devices our players own?

## Games in this app

`index.html` is the game menu. Each game is its own page:

| Page | Game | Controls |
| --- | --- | --- |
| `runner.html` | Runner | Step left/right to change lanes, jump, crouch |
| `cricket.html` | Cricket | Swing your hands like a bat |
| `table-tennis.html` | Table Tennis | Move your hand to the ball |
| `bubble-pop.html` | Bubble Pop | Touch bubbles with your hands |

Runner, Cricket and Table Tennis share one game shell in `src/shared/`: `shell.js` (menu, "raise a hand to start", countdown, results), `players.js` (body positions and hand speeds in screen pixels), `sound.js` (synthesized sounds) and `tracking.js` (camera and body tracking, shared with Bubble Pop). A new game only needs its rules and drawing; see `src/runner.js` for the pattern, and add the page to `vite.config.js`.

To start, every player raises a hand above their head. A "Start now" button (or Enter on a keyboard or TV remote) starts straight away, for example when only one of two players is found.

### Testing without a camera

Add `?sim` to any new game's address (for example `runner.html?sim`) to use a pretend player instead of the camera. Arrow keys move, jump and crouch, H raises a hand, and the mouse moves the right hand. Automated tests can set `window.__sim.players[i]` directly and read the game through `window.__game`.

## How it works

- Body tracking: [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (`@mediapipe/tasks-vision` 0.10.14, "lite" model). It runs on the device; video is never uploaded.
- The model and WASM files are bundled in `public/`, so the game works offline.
- Age groups change bubble size, speed and how often bubbles appear. Bubble size also scales with the player's shoulder width, so small children and adults can both reach them.
- 1 or 2 players. With 2 players the screen is split down the middle: each player stands on their own side and gets their own score. Each half of the camera image is tracked separately (`src/shared/tracking.js`), because asking for two people in the whole frame often finds only one.
- Tick "Show tracking info" on the menu to see tracking frames per second. This is the number to write down for each device.

## Run it on a computer

Needs Node.js 18 or newer.

```
npm install
npm run dev
```

Open the address it prints. The camera only works on `localhost` or over `https`.

## Try it on a phone or tablet

Open https://rasinhal.github.io/Next-What/ on the phone. Every push to `main` rebuilds and republishes it through GitHub Pages (`.github/workflows/pages.yml`).

One-time setup: in the repository's Settings, open Pages and set Source to "GitHub Actions".

## Android app (for the Play Store later)

The project is already wrapped with [Capacitor](https://capacitorjs.com/) 6, which puts the same web game inside a native Android app. The `android/` folder is ready, with camera permission added.

1. Install [Android Studio](https://developer.android.com/studio).
2. Run `npm install`, then `npm run android`. This builds the game, copies it into the Android project and opens Android Studio.
3. In Android Studio, plug in a phone (with USB debugging on) and press Run.

Before publishing, change `appId` in `capacitor.config.json` (currently the placeholder `com.example.bubblepop`) to your own, for example `com.yourcompany.bubblepop`. It cannot be changed after the first Play Store release.

## What was tested

- Builds cleanly, loads the tracking model and runs the game loop in headless Chromium with a simulated camera.
- Not yet tested with a real person in front of a real camera, or on real phones. The Android app has not been compiled (no Android SDK was available where it was built).
