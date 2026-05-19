export interface MercyEntry {
  id: string;
  priority: number;
  dueMs: number;
}

export interface MercyOptions {
  ceiling: number;
  priorityCutoff: number;
}

export interface MercyResult {
  dueToday: string[];
  postponed: string[];
  postponedCount: number;
}

function compareImportance(a: MercyEntry, b: MercyEntry): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  if (a.dueMs !== b.dueMs) {
    return a.dueMs - b.dueMs;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function redistribute(
  entries: MercyEntry[],
  nowMs: number,
  opts: MercyOptions,
): MercyResult {
  const due = entries.filter(
    (e) => Number.isFinite(e.dueMs) && e.dueMs <= nowMs,
  );
  due.sort(compareImportance);

  const n = due.length;
  const { ceiling, priorityCutoff } = opts;

  const dueToday: string[] = [];
  const postponed: string[] = [];

  if (n <= ceiling) {
    for (const e of due) {
      dueToday.push(e.id);
    }
    return { dueToday, postponed, postponedCount: 0 };
  }

  for (let i = 0; i < ceiling; i++) {
    dueToday.push(due[i]!.id);
  }

  for (let i = ceiling; i < n; i++) {
    const e = due[i]!;
    if (e.priority <= priorityCutoff) {
      dueToday.push(e.id);
    } else {
      postponed.push(e.id);
    }
  }

  return {
    dueToday,
    postponed,
    postponedCount: postponed.length,
  };
}
