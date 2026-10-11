#!/usr/bin/env bash
# Builds the game and publishes dist/ to the gh-pages branch (served by GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
npm run build
touch dist/.nojekyll
src_rev=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
cp -r dist/. "$tmp"
cd "$tmp"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name || echo deploy)" \
    -c user.email="$(git -C "$OLDPWD" config user.email || echo deploy@localhost)" \
    commit -qm "Deploy $src_rev"
git push -f "$(git -C "$OLDPWD" remote get-url origin)" gh-pages:gh-pages
rm -rf "$tmp"
