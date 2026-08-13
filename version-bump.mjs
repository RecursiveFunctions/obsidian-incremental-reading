/**
 * Sync Obsidian plugin metadata after `npm version` bumps package.json.
 * BRAT keys off manifest.json; versions.json maps each release to minAppVersion.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
// Plain X.Y.Z or intentional feature builds like 0.6.0-feat.neural-review.1.
if (!/^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)*$/.test(version)) {
  throw new Error(`Unexpected package.json version: ${version}`);
}

const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);

const versionsPath = join(root, "versions.json");
const versions = JSON.parse(readFileSync(versionsPath, "utf8"));
versions[version] = manifest.minAppVersion;
writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
