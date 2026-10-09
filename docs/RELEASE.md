# Releasing (BRAT + Obsidian)

## Day-to-day development vs shipping

| Step | When | Version files | BRAT |
|------|------|---------------|------|
| **Commit** | Each logical change (feature slice, fix, docs, tests) | Unchanged | No update |
| **Ship** | Milestone / feature / fix batch is complete and should reach users | Bumped via `npm run ship:*` | New Release |

- Keep **`main`** at or ahead of the latest **stable tag** so the default branch matches what you released.
- Update **`CHANGELOG.md`** before or as part of ship (move `[Unreleased]` into the new `## [X.Y.Z]` section).
- Avoid **mega commits** that combine large features with a semver bump; land features in normal commits, then ship.

Agents: full rules in `AGENTS.md` and `.cursor/rules/brat-version-on-commit.mdc`.

## What actually has to happen

[BRAT](https://github.com/TfTHacker/obsidian42-brat) **since v1.1.0** does **not** install from `main` or from a bare git tag. It installs from a **GitHub Release** whose **assets** include:

| File | Required |
|------|----------|
| `manifest.json` | Yes |
| `main.js` | Yes |
| `styles.css` | Yes (this repo always ships it; upload even if unchanged) |

The **release tag name**, **release title**, and **`version` in the uploaded `manifest.json`** should all match (see the [BRAT developer guide](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md)).

## Version naming

| Kind | Form | Example | Notes |
|------|------|---------|-------|
| Stable | `X.Y.Z` | `0.5.5` | GitHub **Latest**. Use `npm run ship:patch` / `minor` / `major`. |
| Feature channel | `(next-stable)-feat.<slug>.<n>` | `0.5.6-feat.extract-to-note.1` | Tester / BRAT **frozen** builds. Not Latest. |

Rules:

1. **`next-stable` is the stable this work is aiming at**, usually one patch above current Latest. After `0.5.5`, feature builds are `0.5.6-feat.*` — not `0.6.0-feat.*` (that would imply a minor bump).
2. **`<slug>`** is a short kebab feature id (`extract-to-note`, `neural-review`).
3. **`<n>`** starts at `1` and increments when you publish another build on the same channel.
4. Parallel channels may share the same `next-stable` (e.g. `0.5.6-feat.extract-to-note.1` and `0.5.6-feat.neural-review.1`). BRAT users **freeze** to the exact tag; they should not use “latest” for channel builds.
5. When the feature lands as stable, ship plain `next-stable` (e.g. `0.5.6`) and stop publishing that channel (or bump `<n>` only if you still need a side branch).

**Never flatten** a deliberate `…-feat.*` tag to plain `X.Y.Z` just to please CI/BRAT — fix publishing under the feat name instead.

`main.js` is **gitignored** here on purpose; the **Release workflow** builds it in CI and attaches it. Do not expect BRAT to work from tag-only pushes.

## Automated path (canonical)

1. Land milestone work on `main` with **small commits** (no version bump required per commit).
2. When the milestone is ready for users, update `CHANGELOG.md`, then run exactly one ship command:

   ```bash
   npm run ship:patch  # bug fix
   npm run ship:minor  # user-facing feature
   npm run ship:major  # breaking change
   ```

   Each command runs `npm run test:ci`, invokes `npm version`, syncs and stages
   `manifest.json` plus `versions.json` through `version-bump.mjs`, creates the
   matching unprefixed semver tag, and pushes `HEAD --follow-tags` through the
   `postversion` hook. Do not manually run `npm version` and separate pushes
   for a normal release.
3. **Wait for GitHub Actions → “Release”** on that tag. It runs the full test,
   browser-layout, and build gates, then creates the GitHub Release with the
   required assets.
4. Verify the published asset set before calling the release complete:

   ```bash
   gh release view "$(node -p 'require("./manifest.json").version')" --json assets \
     --jq '.assets[].name' | sort
   ```

   The output must be exactly `main.js`, `manifest.json`, and `styles.css`.
5. In BRAT, pick **Update** / reinstall the plugin; it should see the new
   semver from Releases.

If the Release workflow fails, repair it with a new patch release unless a
maintainer has explicitly chosen the one-off repair below.

## Repair a tag that has no Release (one-off)

If someone pushed a semver tag but the Release job did not exist or failed:

```bash
git fetch origin
git checkout <TAG>   # e.g. 0.0.10
npm ci && npm test && npm run build
gh release create <TAG> --title "<TAG>" --generate-notes \
  main.js manifest.json styles.css
git checkout main
```

Requires [GitHub CLI](https://cli.github.com/) (`gh`) and permission on the repo.

## Version files (must stay aligned)

- `package.json` → `version`
- `manifest.json` → `version` (synced by `version-bump.mjs` from package.json)
- `versions.json` → new key per release → `minAppVersion` from manifest

The `npm run ship:patch|minor|major` commands keep these files aligned for a
normal release.

## BRAT troubleshooting

- **“Not a valid Obsidian plugin”** — Release is missing `main.js` or `manifest.json`, or BRAT is pointed at the wrong repo / branch instead of following Releases.
- **No update offered** — No newer **GitHub Release** (by semver) than what BRAT installed; tag-only does not count.
- **API rate limits** — BRAT settings: add a GitHub PAT with `public_repo` for higher limits.
