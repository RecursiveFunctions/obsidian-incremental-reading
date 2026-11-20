/**
 * Zero-dependency PKZIP reader supporting stored (0) and deflate-raw (8)
 * entries with zip-bomb byte caps. Uses Web `DecompressionStream("deflate-raw")`
 * when available and lazily falls back to Node `zlib.inflateRawSync` in CJS/Node
 * environments (never imported eagerly so mobile WebViews load cleanly).
 */

export interface ZipReadOptions {
  /** Maximum uncompressed byte size allowed for a single entry (default 64 MB). */
  maxEntryBytes?: number;
  /** Maximum total uncompressed bytes allowed across all entries (default 256 MB). */
  maxTotalBytes?: number;
  /** Optional custom raw-deflate decompressor (mainly for deterministic tests). */
  inflateRaw?: (compressed: Uint8Array, maxBytes: number) => Promise<Uint8Array>;
}

export const DEFAULT_MAX_ZIP_ENTRY_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_ZIP_TOTAL_BYTES = 256 * 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEocdOffset(bytes: Uint8Array, view: DataView): number {
  const minOffset = Math.max(0, bytes.byteLength - 65557);
  for (let i = bytes.byteLength - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen === bytes.byteLength) {
        return i;
      }
    }
  }
  return -1;
}

async function decompressDeflateRawWithWebStream(
  compressed: Uint8Array,
  maxBytes: number,
  entryName: string,
): Promise<Uint8Array> {
  const DS = (globalThis as unknown as {
    DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
  }).DecompressionStream;
  if (typeof DS !== "function") {
    throw new Error("DecompressionStream unavailable");
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  }).pipeThrough(new DS("deflate-raw"));

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(
        `ZIP entry "${entryName}" exceeds maximum uncompressed size (${maxBytes} bytes).`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

function decompressDeflateRawWithNodeZlib(
  compressed: Uint8Array,
  maxBytes: number,
  entryName: string,
): Uint8Array {
  const globalReq =
    typeof require === "function"
      ? require
      : (globalThis as unknown as { require?: (id: string) => unknown }).require;
  if (typeof globalReq !== "function") {
    throw new Error(
      `Cannot decompress deflate-raw ZIP entry "${entryName}": neither DecompressionStream nor Node zlib is available.`,
    );
  }
  const zlib = globalReq("zlib") as {
    inflateRawSync?: (buf: Uint8Array, opts?: { maxOutputLength?: number }) => Uint8Array;
  };
  if (typeof zlib?.inflateRawSync !== "function") {
    throw new Error(
      `Cannot decompress deflate-raw ZIP entry "${entryName}": zlib.inflateRawSync unavailable.`,
    );
  }
  const out = zlib.inflateRawSync(compressed, { maxOutputLength: maxBytes });
  if (out.byteLength > maxBytes) {
    throw new Error(
      `ZIP entry "${entryName}" exceeds maximum uncompressed size (${maxBytes} bytes).`,
    );
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

async function inflateRawEntry(
  compressed: Uint8Array,
  maxBytes: number,
  entryName: string,
  customInflate?: (compressed: Uint8Array, maxBytes: number) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  if (customInflate) {
    const out = await customInflate(compressed, maxBytes);
    if (out.byteLength > maxBytes) {
      throw new Error(
        `ZIP entry "${entryName}" exceeds maximum uncompressed size (${maxBytes} bytes).`,
      );
    }
    return out;
  }
  if (typeof DecompressionStream === "function") {
    try {
      return await decompressDeflateRawWithWebStream(compressed, maxBytes, entryName);
    } catch (err) {
      if (err instanceof Error && err.message.includes("exceeds maximum uncompressed size")) {
        throw err;
      }
      // Fall through to Node zlib when available (e.g. older Node/Electron runtimes).
    }
  }
  return decompressDeflateRawWithNodeZlib(compressed, maxBytes, entryName);
}

/**
 * Parse a PKZIP buffer into a map of normalized archive paths -> file bytes.
 * Enforces per-entry and total uncompressed size limits against zip bombs.
 */
export async function readZipEntries(
  bytes: Uint8Array,
  options: ZipReadOptions = {},
): Promise<Map<string, Uint8Array>> {
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ZIP_ENTRY_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_ZIP_TOTAL_BYTES;
  if (bytes.byteLength < 22) {
    throw new Error("Invalid ZIP archive: file is smaller than EOCD header.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocdOffset(bytes, view);
  if (eocdOffset < 0) {
    throw new Error("Invalid ZIP archive: End of Central Directory record not found.");
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("Unsupported ZIP64 archive.");
  }
  if (cdOffset + cdSize > eocdOffset) {
    throw new Error("Invalid ZIP archive: Central Directory extends past EOCD.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries = new Map<string, Uint8Array>();
  let cursor = cdOffset;
  let totalDecompressed = 0;

  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > cdOffset + cdSize) {
      throw new Error("Invalid ZIP archive: truncated Central Directory entry.");
    }
    if (view.getUint32(cursor, true) !== CD_SIG) {
      throw new Error("Invalid ZIP archive: corrupt Central Directory signature.");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);

    const nameStart = cursor + 46;
    const nextCursor = nameStart + nameLen + extraLen + commentLen;
    if (nextCursor > cdOffset + cdSize) {
      throw new Error("Invalid ZIP archive: Central Directory name overflows bounds.");
    }

    const rawName = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const normalizedName = rawName.replace(/\\/g, "/").replace(/^\/+/, "");
    cursor = nextCursor;

    if (!normalizedName || normalizedName.endsWith("/")) continue;

    if (uncompressedSize > maxEntryBytes) {
      throw new Error(
        `ZIP entry "${normalizedName}" declares ${uncompressedSize} bytes, exceeding limit ${maxEntryBytes}.`,
      );
    }
    if (totalDecompressed + uncompressedSize > maxTotalBytes) {
      throw new Error(
        `ZIP archive exceeds maximum total uncompressed size (${maxTotalBytes} bytes).`,
      );
    }

    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new Error(`Invalid ZIP archive: corrupt local header for "${normalizedName}".`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) {
      throw new Error(`Invalid ZIP archive: compressed data overflows bounds for "${normalizedName}".`);
    }
    const compressedSlice = bytes.subarray(dataStart, dataEnd);

    let data: Uint8Array;
    if (method === 0) {
      if (compressedSlice.byteLength > maxEntryBytes) {
        throw new Error(
          `ZIP entry "${normalizedName}" exceeds maximum uncompressed size (${maxEntryBytes} bytes).`,
        );
      }
      data = compressedSlice.slice();
    } else if (method === 8) {
      const remainingBudget = Math.min(maxEntryBytes, maxTotalBytes - totalDecompressed);
      data = await inflateRawEntry(
        compressedSlice,
        remainingBudget,
        normalizedName,
        options.inflateRaw,
      );
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for "${normalizedName}".`);
    }

    totalDecompressed += data.byteLength;
    if (totalDecompressed > maxTotalBytes) {
      throw new Error(
        `ZIP archive exceeds maximum total uncompressed size (${maxTotalBytes} bytes).`,
      );
    }
    entries.set(normalizedName, data);
  }

  return entries;
}
