# Agent instructions for obsidian-incremental-reading

This file is the contract for any agent (Cursor, Claude, OpenCode, etc.) doing work in this repo. Read it before you touch code. The rules in `.cursor/rules/` repeat the most important parts; this file is the canonical version.

## The single most important rule: ship = release

A code change is **not done** when the commit lands on `main`. A code change is done when a **GitHub Release** exists at the new tag with `main.js`, `manifest.json`, and `styles.css` attached and the **Release** workflow is green. BRAT installs from Releases. Skipping the release means every user of the plugin stays pinned at the previous version no matter what you committed.

If you finish a code change and stop at `git push origin main`, you have broken the deploy. Do not do this.

## The one command you should use

```bash
npm run ship:patch    # bugfix / extract / cloze fix
npm run ship:minor    # new user-facing feature
npm run ship:major    # breaking change (rare)
```

This script runs tests + build, then `npm version <kind>`, which:

1. Bumps `package.json` `version`.
2. Runs `version-bump.mjs` (via the `version` npm hook) to sync `manifest.json` and append to `versions.json`.
3. Commits with the version string as the message (e.g. `0.0.23`).
4. Creates a semver tag (e.g. `0.0.23` — no `v` prefix; enforced by `.npmrc`).
5. Pushes branch + tag via the `postversion` hook.

The pushed tag triggers `.github/workflows/release.yml`, which builds `main.js` in CI and creates the GitHub Release with all three assets.

Feature / channel builds may use intentional prerelease tags such as
`0.5.6-feat.neural-review.1` or `0.5.6-feat.extract-to-note.1` (see
`docs/RELEASE.md` → Version naming). Those are valid: set `package.json` /
`manifest.json` to that string, tag the same string, and let Release publish
it. **Never rename a deliberate feat tag to plain `X.Y.Z` to "fix BRAT"** —
and **never jump the `X.Y.Z` prefix** past the next planned stable (after
`0.5.5`, use `0.5.6-feat.*`, not `0.6.0-feat.*`) unless you mean a minor/major.

## Tests and GitHub CI

`npm test` (Node's test runner, `test/*.test.ts`) is the suite. **Build**
(`.github/workflows/build.yml`) runs it plus `npm run build` on every push
and every pull request — including feature branches, not only `main`.

That is the public gate:

- Open a PR (or push a branch) and wait for the **test** check. Do not
  merge or tag a release while it is red.
- `npm run ship:*` already runs the same tests locally *before* it pushes
  `main` + the tag. CI is the second net, not a substitute for a red local
  run.
- Direct pushes to `main` still become public immediately; CI on `push`
  cannot rewind that. Prefer a PR into `main` when you want GitHub to
  fail the merge before the commit is on `main`.

## Done bar — verify before you say "shipped"

After `npm run ship:patch` returns, you must confirm:

```bash
gh release view "$(node -p 'require(\"./manifest.json\").version')" --json assets \
  --jq '.assets[].name' | sort
```

Expected output (exact, three lines):

```
main.js
manifest.json
styles.css
```

If any of those is missing, or `gh release view` errors with "release not found", the Release workflow hasn't finished or failed. Watch it with `gh run watch` or repair using `docs/RELEASE.md` ("Repair a tag that has no Release"). Do **not** report the task complete until those three assets are on the release.

## Common failure modes (don't repeat these)

- **Bumped `manifest.json` only, no tag, no release.** BRAT sees nothing. (Happened on 0.0.8 — see auto-memory.)
- **Tag pushed with `v` prefix (`v0.0.23`).** Prefer no `v` prefix; `.npmrc` prevents this when you use `npm version`.
- **Flattening an intentional `X.Y.Z-feat.*` tag to plain `X.Y.Z`.** That destroys the channel name BRAT users freeze to. Fix CI / publish under the feat tag instead.
- **Commit on `main` without bumping any of the three version files.** Skip the bump only for non-shipping changes (docs, tests, CI). Code in `src/` or `main.ts` always ships.
- **Saying "done" before `gh release view` shows all three assets.** Always verify.

## Other ground rules

- Commits are the user's. Never add `Co-authored-by:` (Cursor or otherwise), never set the git author to an agent, and never claim authorship in the message. If a trailer is injected, strip it before push; do not rewrite pushed/tagged history to clean it up unless asked.
- `main.js` is gitignored on purpose — CI builds it. Don't commit `main.js`.
- Tests live in `test/*.test.ts`, run with `npm test`. Add tests for behavior you change.
- The Workflow A handoff oracle expects a `RESULT.txt` if you're called via the delegation kit — see `~/docker/chatops/delegation/` for the format.
- For UI changes that affect the reader/review flow, also smoke-test by loading the built `main.js` via BRAT after release (or symlink into the test vault).
- The repo uses a worktree-based cursor lane (`cur-<thread>` branches). If you're a cursor agent, your branch will be merged into `main` by the human; you still own the release once code lands on `main`.

## Where to look

- `docs/RELEASE.md` — release runbook, repair commands.
- `.cursor/rules/brat-version-on-commit.mdc` — same rules, in Cursor's rule format.
- `.github/workflows/release.yml` — the CI that builds + uploads.
- `version-bump.mjs` — syncs `manifest.json` and `versions.json` from `package.json`.
