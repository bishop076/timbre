#!/bin/sh
# Vercel's Ignored Build Step, for both projects cut from this one repository.
#
# `web` (apps/web) and `sidecar` (apps/ytmusic) are separate Vercel projects
# pointed at the same GitHub repo, so by default every push builds both — a
# change to the Python sidecar rebuilt the Next app and vice versa. Worse, the
# release workflow's own version bump is a push to main too, so a single commit
# carrying a `fix` cost four deployments: two for the commit, two for the bump.
#
# Exit 0 to skip the build, exit 1 to run it. Those are the only two statuses
# Vercel documents — "when the command exits with code 1, the build will
# continue. When the command exits with 0, the build is ignored" — and it says
# nothing about any other. So no other is ever returned from here: `set -u`,
# a missing argument and a failed `git` would all otherwise abort with 2 or 127
# and leave the outcome to a rule nobody has written down.
#
# Everything below leans towards building. A build that did not need to happen
# wastes a minute of a free tier; a skip that should not have happened leaves
# production quietly stale, and nothing in the Vercel UI distinguishes that from
# a deploy that simply worked.
#
# Wired up from each project's vercel.json rather than the dashboard, so the rule
# is reviewable in the diff and cannot drift between the two projects.
#
# All of the reasoning lives here because neither vercel.json can hold any of it.
# That file is validated against openapi.vercel.sh/vercel.json, which sets
# `additionalProperties: false`, so a `_comment` key — the convention this repo
# uses freely in package.json, where npm ignores what it does not know — is not
# ignored there. It fails the deployment outright, with the only explanation
# behind `vercel inspect`. That is exactly how 0.4.4 shipped to a stale
# production: both projects rejected the file and kept serving the build before.

set -u

if [ "$#" -lt 1 ]; then
  echo "usage: vercel-ignore.sh web|sidecar — building rather than guessing." >&2
  exit 1
fi
project="$1"

# Vercel runs this from the project's Root Directory — apps/web or apps/ytmusic —
# and git pathspecs resolve against the working directory, not the repository root.
# Unanchored, `apps/ytmusic` read from inside apps/ytmusic means
# apps/ytmusic/apps/ytmusic, matches nothing, and `git diff --quiet` reports no
# changes: the sidecar skipped every build it was offered and would have done so
# for ever. `package.json` failed the other way round, matching apps/web/package.json
# from apps/web, so the web project built for a reason that had nothing to do with
# its rule. Anchor to the root, or decline to decide.
root=$(git rev-parse --show-toplevel 2>/dev/null) || root=""
if [ -z "$root" ] || ! cd "$root" 2>/dev/null; then
  echo "Could not reach the repository root — building $project." >&2
  exit 1
fi

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

# Redeploy, from the dashboard or the CLI, rebuilds a commit that *is* the last
# successful one — so the diff below is empty by definition and every path rule
# says skip. The button then appears to work and does nothing, with no failure to
# read and no deployment to open, which is exactly how it looked from outside.
#
# Pressing Redeploy is a request for this build in the only words Vercel offers,
# and there is no case where honouring it is wrong: the cost is one build the
# rules would have declined, and the alternative is a control that lies.
if [ "$(git rev-parse "$base^{commit}")" = "$(git rev-parse "HEAD^{commit}")" ]; then
  echo "Rebuild of the commit already deployed — building $project on request."
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
