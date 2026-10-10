#!/usr/bin/env bash
# Writes changes/: the final web-sdk patch against the baseline, incremental patches
# from the two earlier fixes that were shared, the change log, and the repro page.
set -euo pipefail
cd "$(dirname "$0")"
BASE="$(git rev-list --max-parents=0 HEAD)"
DELAY_FIX=c496de7   # "1px / 700 ms relayout" fix as shared
CANVAS_FIX=00c3558  # canvas preview fix as shared
rm -rf changes && mkdir changes
git diff --relative=web-sdk "$BASE" HEAD -- web-sdk > changes/web-sdk-fixes.patch
git diff --relative=web-sdk "$DELAY_FIX" HEAD -- web-sdk > changes/from-delay-fix.patch
git diff --relative=web-sdk "$CANVAS_FIX" HEAD -- web-sdk > changes/from-canvas-fix.patch
cp CHANGES.md changes/
cp app/www/repro.html changes/
ls changes
