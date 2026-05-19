/**
 * Stable, path-independent identifiers.
 *
 * The store keys every element, event, and device by an id that never changes
 * when a note is renamed, moved, or its text is edited. Zero runtime
 * dependencies on purpose (see the security/trust pillar in docs/DESIGN.md):
 * ids come from the platform crypto, not an npm package.
 */

interface PlatformCrypto {
  randomUUID?: () => string;
  getRandomValues?: (a: Uint8Array) => Uint8Array;
}

function platformCrypto(): PlatformCrypto | undefined {
  return (globalThis as { crypto?: PlatformCrypto }).crypto;
}

/**
 * An RFC-4122 v4 UUID from platform crypto. Obsidian's Electron renderer and
 * Node 20 both provide `randomUUID`; the manual path is belt-and-suspenders so
 * the unit tests never depend on which runtime they execute under.
 */
function uuid(): string {
  const c = platformCrypto();
  if (c?.randomUUID) return c.randomUUID();

  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;

  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return (
    h.slice(0, 4).join("") +
    "-" +
    h.slice(4, 6).join("") +
    "-" +
    h.slice(6, 8).join("") +
    "-" +
    h.slice(8, 10).join("") +
    "-" +
    h.slice(10, 16).join("")
  );
}

// Branded string types: compile-time safety against mixing id kinds, zero
// runtime cost (they are plain strings after erasure).
export type ElementId = string & { readonly __brand: "ElementId" };
export type EventId = string & { readonly __brand: "EventId" };
export type DeviceId = string & { readonly __brand: "DeviceId" };

/** A prefix makes ids self-describing in logs and JSON without parsing cost. */
export function newElementId(): ElementId {
  return `el_${uuid()}` as ElementId;
}

export function newEventId(): EventId {
  return `ev_${uuid()}` as EventId;
}

export function newDeviceId(): DeviceId {
  return `dev_${uuid()}` as DeviceId;
}
