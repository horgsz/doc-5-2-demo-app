#!/usr/bin/env bash
# Writes changes/ : a combined web-sdk patch plus one format-patch per commit since the baseline.
set -euo pipefail
cd "$(dirname "$0")"
BASE="$(git rev-list --max-parents=0 HEAD)"
rm -rf changes && mkdir changes
git diff --relative=web-sdk "$BASE" HEAD -- web-sdk > changes/web-sdk-fixes.patch
git format-patch -q --relative=web-sdk -o changes "$BASE"..HEAD -- web-sdk
ls changes
