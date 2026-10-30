#!/usr/bin/env bash
# Publishes a live update: builds the app's screens, zips them into ota/, and prints the
# one SQL statement that makes phones pick it up.
#
#   1. Bump versionName in android/app/build.gradle (e.g. 1.8.0 -> 1.8.1)  <- the update's version
#   2. ./scripts/publish-update.sh
#   3. git add ota && git commit && git push      (the zip must be online BEFORE step 4)
#   4. Run the printed SQL in the Supabase SQL editor.
#
# Phones then update the next time someone taps Update (or signs in, or opens the app).
# To withdraw a bad release: update public.app_releases set published = false where version = '...';
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*versionName "\([^"]*\)".*/\1/p' android/app/build.gradle | head -1)
MIN_NATIVE=${MIN_NATIVE:-1.8.0}
NOTES=${1:-"Update $VERSION"}
REPO_RAW="https://raw.githubusercontent.com/suryaapratapp/Synergy-Tracking-Service/main/ota"

echo "Building version $VERSION ..."
npm run build >/dev/null
mkdir -p ota
ZIP="ota/tex-trak-$VERSION.zip"
rm -f "$ZIP"
(cd dist && zip -r -X "../$ZIP" . -x "sw.js" >/dev/null)
SHA=$(shasum -a 256 "$ZIP" | cut -d' ' -f1)

echo
echo "Created $ZIP ($(du -h "$ZIP" | cut -f1)), sha256 $SHA"
echo
echo "Next: git add ota && git commit -m 'Live update $VERSION' && git push"
echo "Then run this in the Supabase SQL editor:"
echo
cat <<SQL
insert into public.app_releases (version, url, sha256, min_native, notes)
values ('$VERSION', '$REPO_RAW/tex-trak-$VERSION.zip', '$SHA', '$MIN_NATIVE', '${NOTES//\'/\'\'}');
SQL
