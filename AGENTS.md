# Agent instructions for obsidian-incremental-reading

This file is the contract for any agent (Cursor, Claude, OpenCode, etc.) doing work in this repo. Read it before you touch code. The rules in `.cursor/rules/` repeat the most important parts; this file is the canonical version.

## Commits vs releases (read this first)

**Commits and BRAT releases are separate steps.**

- **Commits** land on `main` often. Each commit should be **small and sensible**: one logical change, conventional message (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`), tests when behavior changes. Do **not** bump `package.json` / `manifest.json` / `versions.json` on every commit.
- **Releases** happen when a **milestone is complete** — a user-facing feature, a fix set you want BRAT users to pick up, or a deliberate patch/minor bump. Only then run `npm run ship:*` (see below).

Docs-only, test-only, and CI-only changes: commit and push; **no** tag or GitHub Release.

Code changes in `src/`, `main.ts`, or `styles.css` can sit on `main` unreleased until the maintainer (or you, when asked) ships. Do **not** run `ship:*` unless the user asked for a BRAT release or you are closing out a agreed milestone.

## When a milestone is ready: ship for BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs from **GitHub Releases**, not from `main` alone. A release is **done** when a tag exists and the Release workflow attached **`main.js`**, **`manifest.json`**, and **`styles.css`**.

```bash
npm run ship:patch    # bugfix / small completed fix milestone
npm run ship:minor    # new user-facing feature milestone
npm run ship:major    # breaking change (rare)
```

Before shipping, update `CHANGELOG.md` (move `[Unreleased]` notes into the new version section, or add an entry there). Then `npm run ship:*`, which:

1. Runs `npm run test:ci`.
2. Bumps `package.json` `version` and syncs `manifest.json` / `versions.json` via `version-bump.mjs`.
3. Commits with the version as the message (e.g. `0.12.2`).
4. Creates a semver tag (no `v` prefix; `.npmrc`).
5. Pushes branch + tag (`postversion`).

The tag triggers `.github/workflows/release.yml` to build `main.js` in CI and publish the Release.

Feature / channel builds may use prerelease tags such as
`0.5.6-feat.neural-review.1` (see `docs/RELEASE.md` → Version naming). **Never flatten** a deliberate `…-feat.*` tag to plain `X.Y.Z` to “fix BRAT,” and **do not jump** the stable prefix past the next planned release without intent.

## Verify before you say “released”

After `npm run ship:*`:

```bash
gh release view "$(node -p 'require(\"./manifest.json\").version')" --json assets \
  --jq '.assets[].name' | sort
```

Expected:

```
main.js
manifest.json
styles.css
```

If the release is missing or the workflow failed, repair per `docs/RELEASE.md`. Do not claim a BRAT release is complete until this passes.

## Tests and GitHub CI

`npm test` (`test/*.test.ts`) and **Build** (`.github/workflows/build.yml`) run on every push and PR. Do not tag while CI is red. `npm run ship:*` runs the same gates locally first.

Prefer PRs into `main` when you want GitHub to block a bad merge; direct pushes to `main` still trigger CI but cannot be undone by CI alone.

## Common failure modes

- **Manifest bump with no tag/release.** BRAT sees nothing. (Historical: 0.0.8.)
- **`v`-prefixed tags.** Use `npm version` / `ship:*` so `.npmrc` keeps tags unprefixed.
- **Flattening `…-feat.*` tags** destroys BRAT freeze names.
- **Mega version commits** that mix a semver bump with large feature diffs. Prefer feature commits first, then a version-only bump via `ship:*` (or a tight final commit) so history stays readable.
- **`origin/main` behind latest tag.** After shipping, ensure `main` contains the tag commit (fast-forward or merge). Tags without `main` confuse contributors.

## Other ground rules

- Commits are the user's. Never add `Co-authored-by:` (Cursor or otherwise), never set the git author to an agent, and never claim authorship in the message. If a trailer is injected, strip it before push; do not rewrite pushed/tagged history to clean it up unless asked.
- `main.js` is gitignored — CI builds it. Don't commit `main.js`.
- Tests live in `test/*.test.ts`. Add tests for behavior you change.
- Workflow A handoff oracle: `RESULT.txt` per `~/docker/chatops/delegation/` when delegated.
- UI changes in review/tree: smoke-test via BRAT or a symlinked vault after a **release**, not after every commit.
- Cursor lanes use worktrees (`cur-<thread>` branches); merge to `main` with normal commits. Release only when the milestone warrants it.

## Where to look

- `docs/RELEASE.md` — release runbook, repair commands, commit vs ship summary.
- `.cursor/rules/brat-version-on-commit.mdc` — Cursor rule mirror.
- `.github/workflows/release.yml` — CI release build.
- `version-bump.mjs` — syncs `manifest.json` and `versions.json` from `package.json`.
