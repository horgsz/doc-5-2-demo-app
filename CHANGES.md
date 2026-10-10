# Changes to the doc-5-2 demo / web-sdk

Baseline: the package as received (`web-sdk` = upstream `92b8ef5` + `web-sdk-changes-since-92b8ef5.patch`).

## What to send the developer (`changes/`)

| File | Use it when |
|---|---|
| `web-sdk-fixes.patch` | **The fix.** Against the original source, with no earlier fix from me applied. |
| `from-delay-fix.patch` | They already applied my first fix, the "1px / 700 ms relayout" delay. This undoes it and applies the final fix. |
| `from-canvas-fix.patch` | They already applied my second fix, the canvas-drawn preview. This undoes it and applies the final fix. |
| `from-display-fix.patch` | They already applied my third fix, the first version of the display `<video>` that still failed on some retakes and backs. This adds the rest. |
| `CHANGES.md` | This file. |
| `repro.html` | A test page that shows the WebKit bug without the SDK. Use it for a WebKit bug report. |

All patches use paths relative to `engines/web-sdk`. To apply one:
`cd engines/web-sdk && git apply --check X.patch && git apply X.patch`

To regenerate them: `./export-changes.sh`

## 1. iPhone camera preview drawn shrunk in the middle of the screen

**Status:** fixed. Tested on iPhone 15, iOS Safari 27.2, over several full scans: full screen for the front, the back, repeated retakes, and Try again. The preview is smooth and recognition is normal.

### Symptom
On iPhone 15 (iOS Safari and the Slack in-app browser) the ID-capture preview is drawn as a small box, about 221x393 pt, in the middle of the screen. It happens on the front, the back and after retakes, and never corrects itself.

### Cause
iOS WebKit can get a `<video>` element's video layer stuck drawing a camera stream wrong: the portrait frame fitted at its unrotated landscape size, then rotated.
- The element's box, `object-fit` and `videoWidth`/`videoHeight` are all correct throughout, so the page can't detect the bad state.
- Once an element is stuck it stays stuck. Re-attaching the stream (`srcObject = null; srcObject = stream`) doesn't fix it. Because the SDK keeps the same element for the front, the back and retakes, all three were affected.
- Trigger: the element gets the stream, or keeps playing it, while it isn't on screen, and is uncovered afterwards. The SDK does this in two places:
  - `startScanning` opens the camera (`createScanner`) and only then sets `showVideo`. This reproduces without the SDK (`repro.html`: attach while `display:none`, then show).
  - The feed keeps running under the frozen capture, the review panel and the flip-to-back animation. It was also seen when the element was replaced while those covered it.
- The update made it visible. It pinned the `<video>` with `position:absolute; inset:0`. Before that, a late `resize` changed the element's box, which made WebKit redraw the layer and snap the preview back to full screen.

How this was established, live on the device:
- The same stream on a **new** `<video>`, attached while visible, drew full screen. That held both on the page and inside the SDK's own preview container, while the SDK's element next to it stayed small.
- A new `<video>` attached **while the preview was still covered** (by the review panel or the flip animation) ended up small after it was uncovered. A new one attached after it was uncovered drew full screen.
- The camera frames themselves were always portrait (2160x3840), including around the capture's track disable and re-enable.
- Things that were **not** the cause, each tested:
  - camera resolution (4K or 1080p);
  - how the camera is opened (capabilities probe stream, `deviceId`);
  - the blur on the feedback pill;
  - the frame backdrop;
  - frame reads by the placement and guide-shape checks;
  - session recording.

### Fix
In `src/ui/components/shared/idv-video/` (`idv-video.tsx`, `idv-video.scss`):
- **The SDK's `<video>` (now `.idv-video-sink`) is unchanged for the SDK.** `getVideoRef()` still returns it, and the SDK still binds the camera to it, reads frames from it, records it, styles it and pauses it. It's now `visibility: hidden`, not `display: none`, so it keeps its box.
- **A second `<video>` (`.idv-video-display`) plays the same `MediaStream` and is what the user sees.**
  - A new one is attached when the stream starts while the preview is showing (sink `playing`), after the render that shows the preview, and when `refreshDisplay()` is called.
  - When one is replaced, the old one stays on screen until the new one has a frame, so there's no flash.
  - Display videos are removed when the preview is hidden or the stream is removed (`emptied`).
  - The display pauses when the sink pauses.
  - It copies the sink's inline `opacity`, `transition` and `transform`, so the fade-in and webcam mirroring still work.
- New method `refreshDisplay()` attaches a new display video.

In `src/ui/components/id-scan/id-scan.tsx`:
- `liveFeedUncovered` is true when the preview is showing and nothing covers it. Covering screens are:
  - the intro;
  - the frozen capture;
  - the flip animation;
  - the review, result and success screens.
- In `componentDidRender`, on the render where it changes from false to true, `idv-video.refreshDisplay()` is called. The new display video is therefore always attached after the screen has updated and the feed is uncovered.
- This covers a retake, a rejected capture, the flip to the back, and the first open.

General:
- Video is still composited natively by the browser: no timers, no per-frame script and no canvas.
- `src/components.d.ts` is regenerated by Stencil (the new method and doc comments).

### Tests
- `npx stencil test --spec -- src/ui/components/id-scan src/core/lib` passes (138/138).
- Tested on iPhone 15 Safari only. Still to test:
  - other iPhones and iOS versions;
  - the Slack in-app browser;
  - Android, desktop, landscape and the desktop embed layout;
  - face scan, which also uses `idv-video`. It passes `visible={false}`, so no display element is created there.

## Reverted: earlier attempts, not in the final fix
1. **1080p preview on high-tier iPhones** (`core/lib/DeviceProfiler.ts`). It had no effect, because the bug happens at 1080p too. Never shared.
2. **The "1px / 700 ms relayout" delay** (`idv-video.tsx`). It worked on the first open only, and it depended on timing tuned on one phone. Shared earlier; `from-delay-fix.patch` removes it.
3. **Hiding the preview with `opacity` instead of `display: none`** (`idv-video.scss`). Still small in the SDK. Never shared.
4. **Re-attaching the stream on `playing` and after each capture** (`Camera.ts`, `Scanner.ts`). Re-attaching doesn't fix a stuck element. Never shared.
5. **Canvas-drawn preview** (`idv-video.tsx`, `idv-video.scss`). It fixed the layout, but drawing every 4K frame took 7–18 ms on the main thread, and recognition started failing after a few captures. Shared earlier; `from-canvas-fix.patch` removes it.
6. **Display `<video>` replaced only when the stream starts or the preview is shown.** It still failed on some retakes and on the back. Shared earlier; `from-display-fix.patch` completes it.
7. **Replacing the display `<video>` when the track is re-enabled after a capture** (a `Scanner.ts` event). The track comes back while the review panel or flip animation still covers the feed, so the new element got stuck too. Never shared.
8. **Replacing it only when the frozen capture is dropped.** It fixed retakes, but the flip animation still covers the feed at that point, so the back of the card could stay small. Never shared; replaced by the "uncovered" rule above.

## Note (not fixed)
`detectIphoneModel()` reports iPhone 15 as gen 14, because they have the same screen size. It makes no difference to the tier.

## Test harness only (`app/`, not the SDK; don't ship)
- `app/server.js` and `app/www/index.html`:
  - The `[perf]` lines and DOM probes are sent to the server console (`POST /__log`).
  - A remote console (`/__cmd`) runs experiments on the device.
  - The ancestors of the `<video>` are logged when a stream is attached.
  - The frame size and `track.enabled` are logged frame by frame.
- `app/www/repro.html`: the test page without the SDK.
