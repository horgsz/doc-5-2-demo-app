# IDVerse Web SDK: local copy

This is the IDVerse Web SDK demo as it was deployed on the SG and AU demo servers on 2026-10-06, packaged to run on one computer. It contains:

- the SDK source;
- the prebuilt SDK;
- both OCR engines (5.2 and 6.0) and their on-demand data;
- the test page;
- a mock session server.

It was put together to investigate an SDK UI issue on iPhone 15. The issue is in the SDK, not the engines.

## Quick start

You need macOS or Linux, Node 20 (`nvm install 20`) and `openssl` (built into macOS). To get past the capture screen, you also need a card to point the camera at.

```bash
./start.sh
```

Open https://localhost:8443 and accept the certificate warning. Then, on the page:

1. Click **Use bundled mock**, then **Connect**.
2. Click **Start ID scan**.

The first run installs the server's dependencies and makes a self-signed certificate.

## On an iPhone

1. Put the phone on the same Wi-Fi as the computer, and open the **Phone** address that `start.sh` prints (`https://<computer's LAN IP>:8443`).
2. Safari says the connection is not private. Tap **Show Details**, then **visit this website**, then **Visit Website**. Allow the camera.
3. To see the console and DOM:
   - On the iPhone, turn on **Settings > Apps > Safari > Advanced > Web Inspector**.
   - Connect the phone by USB.
   - On the Mac, open Safari's **Develop** menu, choose the iPhone, then the page. If there is no Develop menu, turn on **Safari > Settings > Advanced > Show features for web developers**.
4. Or tap **Debug UI** at the top left of the page to show the SDK's `[perf]` lines over the camera, including the preview geometry (see "iPhone notes" below).

The iOS Simulator has no camera, so the capture screens need a real phone.

If the certificate warning gets in the way, a trusted certificate removes it (see "Troubleshooting").

## The test page

| Control | What it does |
|---|---|
| Use bundled mock, Connect | Uses this server as the session API, and checks it answers |
| Start ID scan, Start face scan, Close | Start or stop the SDK |
| Engine: 5.2 / 6.0 | Switches the OCR engine and reloads the page |
| Capture: SemiAuto / Live | Shutter button, or automatic capture from the video |
| Field review, Result screen, Scan both sides, Frame backdrop, Recording, Good-location (green), Camera | SDK settings, applied from the next scan. The page remembers them. |
| Debug UI | Shows the SDK's `[perf]` log on screen; a phone console is hard to read |
| Log, Last result | What the SDK reported; Last result is the JSON a host app receives |

## Change the SDK

Build once, then switch the server to your build:

```bash
cd web-sdk
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
npm run build:worker && npx stencil build --dev
cd .. && ./use-local-sdk.sh
```

`PUPPETEER_SKIP_DOWNLOAD=1` skips the Chromium download, which only the end-to-end tests need. After `./use-local-sdk.sh`, the server serves `web-sdk`'s build output instead of the prebuilt copy.

After each change:

1. Run `npx stencil build --dev` in `web-sdk`. If you changed code the worker uses (anything reachable from `src/worker.ts`, mostly `src/core`), run `npm run build:worker` first.
2. Reload the page.

`./use-local-sdk.sh --undo` goes back to the prebuilt SDK.

To run the unit tests (Jest, no browser needed): `npx stencil test --spec`.

Traps, each of which has cost time before:

- **`--dev` is required.** A plain `stencil build` writes only `dist/`, and leaves `www/build`, which the page loads, untouched.
- **The worker bundle (`src/ui/assets/IDVerseSDK.worker.min.js`) is built by Rollup (`npm run build:worker`), not by Stencil.** Stencil only copies it into `www/assets/`, which is where the page loads it from.
- **A new `@Prop` passed in JSX fails the worker build with TS2322** until `components.d.ts` is regenerated. Run `npx stencil build --dev` first.
- **The server sends `Cache-Control: max-age=0`, so a normal reload picks up a new build.** If a phone still shows the old one, close the tab and reopen it.

## How it fits together

```
app/www/index.html                      test page
 └─ <idv-sdk-web>                       the SDK (app/www/build, from web-sdk/src)
     ├─ POST /initialise                session from app/server.js; /e6/initialise = Engine 6.0
     │    → module_urls                 where the engine files are
     ├─ /assets/IDVerseSDK.worker.min.js
     │    └─ engine  /wasm/  (5.2; /wasm/basic for phones without SIMD)
     │               /wasm6/ (6.0)
     │         └─ per-document data, on demand: /models (5.2), /models6 (6.0)
     └─ PUT /uploads/<id>               captured images
```

| Path | What |
|---|---|
| `app/server.js`, `app/ondemand-db.js` | Mock session API and static server (Express) |
| `app/www/` | Web root: test page, prebuilt SDK (`build/`, `assets/`, worker), engines (`wasm/`, `wasm6/`) |
| `app/models/` | 5.2 on-demand data: `Lookup.dat`, `IDRecognizer.dat`, language models |
| `app/models6/` | 6.0 on-demand files (16,370). They must match the 6.0 engine build; don't mix them with another build's. |
| `web-sdk/` | SDK source (Stencil and TypeScript) |
| `web-sdk-changes-since-92b8ef5.patch` | The same source, as a patch on the repo (see "Source and the repo") |
| `start.sh`, `use-local-sdk.sh` | The helpers above |

### Where the UI lives (in `web-sdk/src`)

| File | Role |
|---|---|
| `ui/components/sdk-ui.tsx` (+ `.scss`) | Root `<idv-sdk-web>`: moves between screens; the iPad class switch |
| `ui/components/id-scan/id-scan.tsx` (+ `.scss`) | ID capture: camera, semi-auto and Live loop, flip, review, result, and the `[perf] video` diagnostics |
| `ui/components/id-scan/id-scan-capture/` | Shutter (`capture-button`), guide frame (`capture-guide`), feedback pill (`capture-feedback`), review (`capture-issues`), result (`capture-result`), scan line (`capture-scan`) |
| `ui/components/id-scan/id-scan-intro/`, `id-scan-flip-id/`, `id-scan-exception/`, `id-scan-feedback/` | Intro, flip prompt, error and tips screens, messages |
| `ui/components/shared/idv-video/` | Camera preview |
| `ui/components/shared/` (the rest) | Shared pieces: landscape, loading, modal, buttons, icons |
| `ui/global/_variables.scss` | Sizes, colours, breakpoints |
| `ui/language/en.ts` | All UI text |
| `core/lib/Browser.ts`, `Camera.ts`, `DeviceProfiler.ts`, `Orientation.ts` | Device detection; camera choice, constraints and mirroring; camera resolution per device; orientation |
| `worker.ts`, `core/SDKWorker.ts`, `core/recognizers/` | The worker side, which drives the engine |

## iPhone notes

History that may matter for an iPhone 15 layout issue:

- **Camera preview:** on iPhone 15, WebKit once squeezed the 9:16 camera feed into a square, and on the Pro Max it was letterboxed. The preview and the frozen frame now use `height: 100%; object-fit: cover` (`idv-video.scss`, `id-scan.scss`). Cover only changes the display; the engine always receives the full frame.
- **`[perf] video:` lines** (Debug UI, or the console):
  - once at the start: the viewport, screen size, devicePixelRatio and orientation;
  - then at each sizing event of the feed (`loadedmetadata`, `resize`, `playing`) and on a timer: the preview's box, the video's box, the camera's intrinsic size, the CSS size and `object-fit`.
  - A late `resize` is the stream switching to its final resolution.
- **Camera resolution:** chosen per device before the camera opens (`core/lib/DeviceProfiler.ts`: 4K, 2K or 1080p tiers; iPhones are ranked by screen generation).
- **Sideways phones:** they get a landscape layout, keyed off a CSS media query.
- **iPad:** iPadOS Safari reports a Mac user agent. `Browser.isIPad()` and the `idv-ipad` class handle that; phones are not affected.

## Engines and data

- **5.2:** `app/www/wasm/` (SIMD) and `app/www/wasm/basic/` (no SIMD, for older iOS). The face-scan module files (`IDVerseSDK_bg.*`) are in `app/www/wasm/` too.
- **6.0:** `app/www/wasm6/`, built 2026-10-06 (includes the NZ driver licence Live fix).
- Both engines, and their data, are byte-identical to what the SG and AU demo servers serve as of 2026-10-06.
- Engine source code is not included.

## Source and the repo

`web-sdk/` is the working tree of `idverse-platform/engines/web-sdk`. That is branch `lahsen/semi-auto-capture`, which is commit `92b8ef5` (it is on `origin/release/1.5.6`) plus uncommitted changes.

To get the same source in your own clone:

```bash
git checkout 92b8ef543c8378c13de79490a66150b182124071
cd engines/web-sdk
git apply --binary /path/to/web-sdk-changes-since-92b8ef5.patch
git lfs pull
```

`git lfs pull` is needed because the fonts and sounds are Git LFS files. The patch was checked against a clean export of `92b8ef5`: the result is identical to `web-sdk/` here.

## Not included

- Real ID test images, and the UI simulator that uses them.
- Deploy scripts, server keys and certificates. `start.sh` makes a local certificate.
- Engine source code.
- `node_modules`; `npm ci` installs them.

## Troubleshooting

- **"Camera not available":** the page must be served over https, or over plain http only from `localhost`.
- **Port in use:** `PORT=9443 ./start.sh`.
- **Node too old:** `nvm install 20 && nvm use 20`.
- **Engine 6.0 says "Check your internet connection and try again":** the 6.0 engine could not download its data from `/models6`. Check that `app/models6/` is there and came with this package.
- **The phone can't open the address:**
  - Make sure the phone and the computer are on the same Wi-Fi.
  - Allow incoming connections for `node`; macOS asks the first time.
- **To avoid the certificate warning,** use a trusted local certificate made with [mkcert](https://github.com/FiloSottile/mkcert). `start.sh` never replaces a certificate it did not make.

  ```bash
  brew install mkcert && mkcert -install
  mkcert -cert-file app/cert.pem -key-file app/key.pem localhost 127.0.0.1 <computer's LAN IP>
  ```

  Then trust mkcert's root certificate on the iPhone:
  1. Run `mkcert -CAROOT` to find `rootCA.pem`, and AirDrop that file to the phone.
  2. Install the profile in **Settings > General > VPN & Device Management**.
  3. Turn it on in **Settings > General > About > Certificate Trust Settings**.
