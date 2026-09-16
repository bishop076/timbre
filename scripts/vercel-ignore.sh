#!/bin/sh

set -u
project="${1:-}"

case "$project" in
  web)     paths="apps/web packages pnpm-lock.yaml pnpm-workspace.yaml package.json" ;;
  sidecar) paths="apps/ytmusic" ;;
  "") echo "usage: vercel-ignore.sh web|sidecar — building rather than guessing." >&2; exit 1 ;;
  *) echo "Unknown project '$project' — building rather than guessing." >&2; exit 1 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || root=""
if [ -z "$root" ] || ! cd "$root" 2>/dev/null; then
  echo "Could not reach the repository root — building $project." >&2
  exit 1
fi

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

# release.yml pushes `chore(release): <version>` onto main a couple of minutes after the work
# it versions, so a version bump is usually what Vercel finds at the tip. Reading only the
# tip's own message, which this used to do, throws that commit away however much undeployed
# work is sitting underneath it — and VERCEL_GIT_PREVIOUS_SHA only ever moves on a build
# that succeeded, so a deployment that errored, was superseded, or was never created at all
# leaves its work to be carried by the bump, and the bump was the one thing guaranteed to be
# skipped. Production then stays on the older build until some unrelated push comes along.
# Ask the whole range instead: a version bump is only a version bump when there is nothing
# else since the commit this project last put live.
subjects=$(git log --format=%s "$base..HEAD" 2>/dev/null) || subjects=""
if [ -n "$subjects" ] && ! printf '%s\n' "$subjects" | grep -qv '^chore(release):'; then
  echo "Nothing but version bumps since $base — skipping $project."
  exit 0
fi

git diff --quiet "$base" HEAD -- $paths
status=$?
case "$status" in
  0) echo "Nothing under [$paths] since $base — skipping $project."; exit 0 ;;
  1) echo "Changes under [$paths] since $base — building $project."; exit 1 ;;
  *) echo "git diff failed ($status) — building $project rather than assuming." >&2; exit 1 ;;
esac
