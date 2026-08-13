# Releasing (BRAT + Obsidian)

## What actually has to happen

[BRAT](https://github.com/TfTHacker/obsidian42-brat) **since v1.1.0** does **not** install from `main` or from a bare git tag. It installs from a **GitHub Release** whose **assets** include:

| File | Required |
|------|----------|
| `manifest.json` | Yes |
| `main.js` | Yes |
| `styles.css` | Yes (this repo always ships it; upload even if unchanged) |

The **release tag name**, **release title**, and **`version` in the uploaded `manifest.json`** should all match (see the [BRAT developer guide](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md)).

Tags may be plain `X.Y.Z` or feature-channel builds like `0.6.0-feat.neural-review.1`. BRAT installs by that exact string — do not rewrite a feat tag to plain semver unless you mean to ship a stable release under a new name.

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
