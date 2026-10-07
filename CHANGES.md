# Changes to the doc-5-2 demo / web-sdk

Baseline commit: the package as received (`web-sdk` = upstream `92b8ef5` + `web-sdk-changes-since-92b8ef5.patch`).

To share with the dev, send the files in `changes/`:
- `changes/web-sdk-fixes.patch`: only the `web-sdk/` source changes, paths relative to `engines/web-sdk`.
  In their clone (with the original patch already applied): `cd engines/web-sdk && git apply /path/to/web-sdk-fixes.patch`
- `changes/*.patch` (numbered): one `git format-patch` file per commit, for `git am` if they prefer.

Regenerate after new commits: `./export-changes.sh`

## Log

### 1. iPhone camera preview shrunk to a small box (iOS, High tier)
- **Symptom:** On iPhone 15 the ID-capture camera preview is shown as a small box in the middle of the screen and never fills it.
- **Evidence:** In `[perf] video` the host and the `<video>` are both full-viewport (393x695, `object-fit: cover`), and the stream is `intrinsic=2160x3840`. So the layout is correct; it's iOS WebKit drawing the continuous 4K stream wrong.
- **Fix:** `core/lib/DeviceProfiler.ts`: iOS devices in the High tier now get a 1080p preview and a 4K still, using the existing `Scanner.dynamicCapture` bump. Android and desktop are unchanged.
- **Files:** `core/lib/DeviceProfiler.ts`, `core/lib/DeviceProfiler.spec.ts`, `ui/components/id-scan/id-scan.tsx` (comment only).
- **Tests:** `npx stencil test --spec -- src/core/lib/DeviceProfiler.spec.ts src/core/lib/Scanner.spec.ts` passes.
- **Note (not fixed):** `detectIphoneModel()` reports iPhone 15 as gen 14, because they have the same screen size. It makes no difference to the tier (>= 12 means High).
