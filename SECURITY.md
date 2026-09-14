# Security

## Threat model, honestly stated

Obsidian plugins are not sandboxed. Every plugin runs in the Electron
renderer with Node integration: full filesystem access (the whole
machine, not just the vault), child processes, and unrestricted network.
An incremental-reading plugin is the worst case for "trust me", because
it indexes your entire vault; a single network call could exfiltrate all
of it. Obsidian's protections are disclosure and scanning, not runtime
enforcement.

This plugin's answer is not a promise of good behavior. It is built so
the claim is checkable against the artifact you actually run.

## The zero-network property

The shipped `main.js` contains no network-capable code. Not disabled,
not opt-out: absent.

Check it yourself against your installed copy:

```bash
grep -cE 'fetch\(|XMLHttpRequest|WebSocket|requestUrl|sendBeacon|EventSource' \
  .obsidian/plugins/incremental-reading/main.js
# 0
```

It is also enforced mechanically. `npm run build` ends with
`scripts/check-zero-network.mjs`, which fails the build if the bundle
contains any of: `fetch(`, `XMLHttpRequest`, `WebSocket`, `requestUrl`,
`sendBeacon`, `EventSource`, `new Image(`, `importScripts(`,
`RTCPeerConnection`, `RTCDataChannel`, or an `http://` / `https://`
literal. The same command runs in CI on every push and produces every
release asset, so a regression cannot ship without first defeating the
gate in a reviewable diff. The gate itself is covered by tests
(`test/zero-network-gate.test.ts`).

Consequences of the property:

- No telemetry, no analytics, no license server, no update pings.
- The clipboard-import command imports what you paste; the plugin never
  fetches a URL.
- Your notes and review history live in your vault (`.ir/` for the
  review log, frontmatter for schedules) and nowhere else.

## Reproducible build

The release asset is reproducible from the tagged source:

```bash
git checkout <tag>
npm ci
npm run build
sha256sum main.js   # compare with the release asset
```

`esbuild` performs the emit, so the output does not depend on the Node
version used to drive it; builds on Node 18 and Node 20 produce
byte-identical bundles. Verified for 0.7.22: a local build hashes
identically to the published release asset
(`b67fca1471af19059ddac2fce9e45241e5e50789c063df4de674b73fe8e1f8c2`).

## Dependency policy

- Exactly one runtime dependency:
  [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), pinned
  to an exact version (no semver range) with a committed lockfile.
- Dev dependencies (test runner, bundler, the fsrs-rs reference
  optimizer used as a CI test oracle) are never bundled; the
  zero-network gate runs against the compiled output, after bundling,
  so nothing they contain can slip in unnoticed.
- Dependency updates are deliberate version-bump commits, reviewable in
  the diff.

## Scope and non-claims

- The plugin cannot protect you from other plugins or from Obsidian
  itself; nothing running unsandboxed can.
- "Zero network" describes the plugin's code. Obsidian may render
  remote images found in your own notes through its normal markdown
  pipeline; that behavior belongs to Obsidian, not this plugin, and
  exists whether or not this plugin is installed.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability"), or open an issue for
anything that is not sensitive. Reports that include the grep or hash
check above failing on a published release are treated as
highest-severity.
