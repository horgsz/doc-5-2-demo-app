# Changes to the doc-5-2 demo / web-sdk

Baseline commit: the package as received (`web-sdk` = upstream `92b8ef5` + `web-sdk-changes-since-92b8ef5.patch`).

To share with the dev, send the files in `changes/`:
- `changes/web-sdk-fixes.patch`: only the `web-sdk/` source changes, paths relative to `engines/web-sdk`.
  In their clone (with the original patch already applied): `cd engines/web-sdk && git apply /path/to/web-sdk-fixes.patch`
- `changes/*.patch` (numbered): one `git format-patch` file per commit, for `git am` if they prefer.

Regenerate after new commits: `./export-changes.sh`

## Log

### 1. iPhone camera preview drawn shrunk in the middle of the screen (FIXED)
- **Symptom:** On iPhone 15 (iOS Safari, and the Slack in-app browser) the ID-capture preview is drawn as a small box (about 221x393 pt) in the middle of the screen and never recovers.
- **Diagnosis (measured on the device):**
  - The host and the `<video>` are both full-viewport (393x695), with `object-fit: cover` and no transform, clip or mask.
  - The rendered size matches a 9:16 portrait frame contain-fitted at its unrotated landscape size and then rotated. WebKit is drawing the video wrong; the CSS layout is correct.
  - Not resolution-related: it happens at both 4K and 1080p. An earlier attempt that changed the iOS preview resolution was reverted.
  - WebKit only redraws the video when the element's box changes. The update pinned the `<video>` with `position:absolute; inset:0`, so its box never changes. Before the update, a late `resize` made the box change and "snapped" the preview to full screen.
  - Live tests on the device:
    - Holding a style change (`object-fit` or a 1px height change) for 600 ms fixes it.
    - Undoing the change within 2 frames, or after 100 ms, does not.
- **Fix:** `ui/components/shared/idv-video/idv-video.tsx`: shrinks the `<video>` height by 1px for 700 ms on `loadedmetadata`, `resize` and `playing`, again 1 s after each, and when the preview is shown. Each run posts a `[perf] video: relayout (...)` line.
- **Verified:** iPhone 15, iOS Safari. The preview fills the screen from the start, and through capture and the flip to the back.
- **Note (not fixed):** `detectIphoneModel()` reports iPhone 15 as gen 14, because they have the same screen size. It makes no difference to the tier.

## Test harness only (app/, not the SDK)
- `app/server.js` + `app/www/index.html`: the `[perf]` lines and DOM probes are relayed to the server console (`POST /__log`), and there is a remote console (`/__cmd`) for running experiments on the device. Don't ship these.
