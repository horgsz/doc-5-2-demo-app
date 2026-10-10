#!/usr/bin/env bash
# Writes changes/: the net web-sdk patch since the baseline, the change log, and the SDK-free repro page.
set -euo pipefail
cd "$(dirname "$0")"
BASE="$(git rev-list --max-parents=0 HEAD)"
rm -rf changes && mkdir changes
git diff --relative=web-sdk "$BASE" HEAD -- web-sdk > changes/web-sdk-fixes.patch
cp CHANGES.md changes/
cp app/www/repro.html changes/
ls changes
