# Releasing (BRAT + Obsidian)

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

## Automated path (preferred)

1. Land your code on `main` (or merge a PR).
2. Bump version in lockstep:
   - `npm version patch` (or `minor` / `major`)  
     This runs `version-bump.mjs` (via the `version` npm script) and stages `manifest.json` + `versions.json`.
3. Push branch and tags: `git push origin main && git push origin <tag>`  
   e.g. `git push origin main --follow-tags`
4. **Wait for GitHub Actions → “Release” workflow** on that tag. It runs tests, builds `main.js`, and creates the GitHub Release with the three files.
5. In BRAT, pick **Update** / reinstall the plugin; it should see the new semver from Releases.

If the Release workflow fails, fix it before re-tagging; delete the bad tag only if no one depends on it, or ship a patch version.

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

Use `npm version patch` so they stay aligned.

## BRAT troubleshooting

- **“Not a valid Obsidian plugin”** — Release is missing `main.js` or `manifest.json`, or BRAT is pointed at the wrong repo / branch instead of following Releases.
- **No update offered** — No newer **GitHub Release** (by semver) than what BRAT installed; tag-only does not count.
- **API rate limits** — BRAT settings: add a GitHub PAT with `public_repo` for higher limits.
