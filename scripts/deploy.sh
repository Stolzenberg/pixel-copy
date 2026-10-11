#!/usr/bin/env bash
# Builds the game and publishes dist/ to the gh-pages branch (served by GitHub Pages).
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
npm test
npm run build
touch dist/.nojekyll
src_rev=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -r dist/. "$tmp"
git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" -c user.name="$(git config user.name || echo deploy)" \
  -c user.email="$(git config user.email || echo deploy@localhost)" \
  commit -qm "Deploy $src_rev"
# Push from the main checkout so its credentials (e.g. in CI) are used.
git fetch -q "$tmp" gh-pages
git push -f origin FETCH_HEAD:refs/heads/gh-pages
