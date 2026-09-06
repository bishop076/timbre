#!/bin/sh
# Vercel's Ignored Build Step, for both projects cut from this one repository.
#
# `web` (apps/web) and `sidecar` (apps/ytmusic) are separate Vercel projects
# pointed at the same GitHub repo, so by default every push builds both — a
# change to the Python sidecar rebuilt the Next app and vice versa. Worse, the
# release workflow's own version bump is a push to main too, so a single commit
# carrying a `fix` cost four deployments: two for the commit, two for the bump.
#
# Exit 0 to skip the build, non-zero to run it. Everything below leans towards
# running it. A build that did not need to happen wastes a minute of a free tier;
# a skip that should not have happened leaves production quietly stale, and
# nothing in the Vercel UI distinguishes that from a deploy that simply worked.
#
# Wired up from each project's vercel.json rather than the dashboard, so the rule
# is reviewable in the diff and cannot drift between the two projects.

set -u

project="${1:?usage: vercel-ignore.sh web|sidecar}"

# What each project is actually built from. Anything outside these paths — docs,
# notes, the workflows, the root README — cannot change either deployment, which
# is most of what lands here.
case "$project" in
  # apps/web resolves `@timbre/core` and `@timbre/providers` through the pnpm
  # workspace, so packages/ and the lockfile are inputs to it as much as its own
  # source is.
  web)     paths="apps/web packages pnpm-lock.yaml pnpm-workspace.yaml package.json" ;;
  # The sidecar is a Python function and is not in the pnpm workspace at all;
  # nothing outside its own directory reaches it.
  sidecar) paths="apps/ytmusic" ;;
  *) echo "Unknown project '$project' — building rather than guessing." >&2; exit 1 ;;
esac

# `chore(release): x.y.z [skip ci]`, pushed by .github/workflows/release.yml.
# GitHub honours `[skip ci]` and Vercel does not, which is how the bump kept
# deploying. It rewrites package.json, apps/web/package.json and CHANGELOG.md —
# all of them inputs above — so the path check alone would not catch it. Skipping
# is safe because nothing the app serves reads its own version.
case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  "chore(release):"*)
    echo "Version bump only — skipping $project."
    exit 0
    ;;
esac

# The SHA of the last *successful* deployment of this project on this branch, not
# simply HEAD^. That difference matters: after a skip, the next commit is still
# compared against the last thing actually built, so a change cannot fall through
# the gap between two commits that were each skipped for their own reason.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"

if [ -z "$base" ]; then
  echo "No previous deployment of $project on this branch — building."
  exit 1
fi

# Vercel clones shallow, so a base far enough back may not be present. Unknown
# history means an unknown diff, and an unknown diff has to build.
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "$base is outside this shallow clone — building $project."
  exit 1
fi

# Deliberately unquoted: $paths is a list of pathspecs and must word-split. None
# of them contain spaces.
# shellcheck disable=SC2086
git diff --quiet "$base" HEAD -- $paths
status=$?

case "$status" in
  0) echo "Nothing under [$paths] since $base — skipping $project."; exit 0 ;;
  1) echo "Changes under [$paths] since $base — building $project."; exit 1 ;;
  *) echo "git diff failed ($status) — building $project rather than assuming." >&2; exit 1 ;;
esac
