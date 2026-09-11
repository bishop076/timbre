#!/bin/sh

set -u

if [ "$#" -lt 1 ]; then
  echo "usage: vercel-ignore.sh web|sidecar — building rather than guessing." >&2
  exit 1
fi
project="$1"

root=$(git rev-parse --show-toplevel 2>/dev/null) || root=""
if [ -z "$root" ] || ! cd "$root" 2>/dev/null; then
  echo "Could not reach the repository root — building $project." >&2
  exit 1
fi

case "$project" in
  web)     paths="apps/web packages pnpm-lock.yaml pnpm-workspace.yaml package.json" ;;
  sidecar) paths="apps/ytmusic" ;;
  *) echo "Unknown project '$project' — building rather than guessing." >&2; exit 1 ;;
esac

case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  "chore(release):"*)
    echo "Version bump only — skipping $project."
    exit 0
    ;;
esac

base="${VERCEL_GIT_PREVIOUS_SHA:-}"

if [ -z "$base" ]; then
  echo "No previous deployment of $project on this branch — building."
  exit 1
fi

if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "$base is outside this shallow clone — building $project."
  exit 1
fi

if [ "$(git rev-parse "$base^{commit}")" = "$(git rev-parse "HEAD^{commit}")" ]; then
  echo "Rebuild of the commit already deployed — building $project on request."
  exit 1
fi

git diff --quiet "$base" HEAD -- $paths
status=$?

case "$status" in
  0) echo "Nothing under [$paths] since $base — skipping $project."; exit 0 ;;
  1) echo "Changes under [$paths] since $base — building $project."; exit 1 ;;
  *) echo "git diff failed ($status) — building $project rather than assuming." >&2; exit 1 ;;
esac
