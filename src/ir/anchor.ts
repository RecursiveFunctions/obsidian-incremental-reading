import type { Anchor } from "./model";

export type AnchorResolution =
  | { status: "ok"; start: number; end: number; repaired: boolean }
  | { status: "needs-reanchor" };

export function normalizeForMatch(s: string): string {
  let result = "";
  let inWhitespace = false;
  
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    
    if (c === "*" || c === "_" || c === "`" || c === "~" || c === "#") {
      continue;
    }
    
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      if (!inWhitespace) {
        result += " ";
        inWhitespace = true;
      }
      continue;
    }
    
    result += c;
    inWhitespace = false;
  }
  
  return result.trim();
}

function matchLf(quoteField: string, sourceUsesCrlf: boolean): string {
  if (!sourceUsesCrlf && quoteField.includes("\r\n")) {
    return quoteField.replace(/\r\n/g, "\n");
  }
  return quoteField;
}

export function resolveAnchor(anchor: Anchor, sourceText: string): AnchorResolution {
  const sourceUsesCrlf = sourceText.includes("\r\n");
  const exact = matchLf(anchor.quote.exact, sourceUsesCrlf);
  const prefix = matchLf(anchor.quote.prefix, sourceUsesCrlf);
  const suffix = matchLf(anchor.quote.suffix, sourceUsesCrlf);
  
  if (anchor.position) {
    const { start, end } = anchor.position;
    if (sourceText.slice(start, end) === exact) {
      return { status: "ok", start, end, repaired: false };
    }
  }

  // An empty needle would make the literal scan below advance by zero forever.
  // Keep the position fast path above intact: zero-width positions are valid.
  if (exact.length === 0) {
    return { status: "needs-reanchor" };
  }
  
  const exactIndices: number[] = [];
  let i = 0;
  while (i <= sourceText.length - exact.length) {
    if (sourceText.slice(i, i + exact.length) === exact) {
      exactIndices.push(i);
      i += exact.length;
    } else {
      i++;
    }
  }
  
  if (exactIndices.length === 1) {
    return { status: "ok", start: exactIndices[0], end: exactIndices[0] + exact.length, repaired: true };
  }
  
  if (exactIndices.length > 1) {
    const scores: number[] = [];
    for (const idx of exactIndices) {
      let prefixScore = 0;
      for (let j = 1; j <= prefix.length; j++) {
        if (sourceText.slice(idx - j, idx) === prefix.slice(prefix.length - j, prefix.length)) {
          prefixScore = j;
        } else {
          break;
        }
      }
      
      let suffixScore = 0;
      for (let j = 1; j <= suffix.length; j++) {
        if (sourceText.slice(idx + exact.length, idx + exact.length + j) === suffix.slice(0, j)) {
          suffixScore = j;
        } else {
          break;
        }
      }
      
      scores.push(prefixScore + suffixScore);
    }
    
    const maxScore = Math.max(...scores);
    const maxIndices = scores.filter(s => s === maxScore);
    
    if (maxIndices.length === 1) {
      const idx = exactIndices[scores.indexOf(maxScore)];
      return { status: "ok", start: idx, end: idx + exact.length, repaired: true };
    }
    
    const pos = anchor.position;
    if (pos) {
      const closest = exactIndices.reduce((prev, curr) => 
        Math.abs(curr - pos.start) < Math.abs(prev - pos.start) ? curr : prev
      );
      return { status: "ok", start: closest, end: closest + exact.length, repaired: true };
    }
  }
  
  const normalizedSource = normalizeForMatch(sourceText);
  const normalizedExact = normalizeForMatch(exact);

  // Format-only quotes normalize to an empty needle. The normalized scan
  // would otherwise advance by zero forever after a source edit removes the
  // literal form. The literal scan above has already had its chance.
  if (normalizedExact.length === 0) {
    return { status: "needs-reanchor" };
  }
  
  const normIndices: number[] = [];
  let n = 0;
  while (n <= normalizedSource.length - normalizedExact.length) {
    if (normalizedSource.slice(n, n + normalizedExact.length) === normalizedExact) {
      normIndices.push(n);
      n += normalizedExact.length;
    } else {
      n++;
    }
  }
  
  if (normIndices.length === 1) {
    const normIdx = normIndices[0];
    const map: number[] = [];
    let inWhitespace = false;
    
    for (let i = 0; i < sourceText.length; i++) {
      const c = sourceText[i];
      if (c === "*" || c === "_" || c === "`" || c === "~" || c === "#") {
        continue;
      }
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        if (map.length > 0 && !inWhitespace) {
          map.push(i);
          inWhitespace = true;
        }
        continue;
      }
      
      map.push(i);
      inWhitespace = false;
    }
    if (inWhitespace && map.length > 0) {
      map.pop();
    }
    
    const mStart = normIdx;
    const mEnd = normIdx + normalizedExact.length;
    
    if (mStart < 0 || mEnd > map.length) {
      return { status: "needs-reanchor" };
    }
    
    const rawStart = map[mStart];
    const rawEnd = map[mEnd - 1] + 1;
    
    return { status: "ok", start: rawStart, end: rawEnd, repaired: true };
  }
  
  return { status: "needs-reanchor" };
}