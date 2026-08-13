import type { TFile } from "obsidian";

/**
 * Vault file check that does not use `instanceof TFile`.
 *
 * The `obsidian` npm package is types-only, so `instanceof TFile` is always
 * false under `tsx` / `npm test`. Folders from `getAbstractFileByPath` are
 * `{ path }` only; files carry `extension`.
 */
export function isVaultFile(af: unknown): af is TFile {
  return (
    typeof af === "object" &&
    af !== null &&
    "path" in af &&
    "extension" in af &&
    typeof (af as { path: unknown }).path === "string"
  );
}
