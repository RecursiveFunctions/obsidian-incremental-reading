export interface SchedulerMember {
  id: string;
  intervalDays: number;
  due: number;
}

export interface BuildDivergenceModalInput {
  members: SchedulerMember[];
  primaryId: string;
  threshold: number;
  floorDays: number;
}

export interface DivergenceModalMember {
  id: string;
  intervalDays: number;
  ratioVsPrimary: number;
}

export interface DivergenceModalConfig {
  primaryId: string;
  primaryInterval: number;
  members: DivergenceModalMember[];
  message: string;
}

export function buildDivergenceModal(input: BuildDivergenceModalInput): DivergenceModalConfig | null {
  const { members, primaryId, threshold, floorDays } = input;

  // Filter usable members
  const usable = members.filter(
    (m) => Number.isFinite(m.intervalDays) && m.intervalDays > 0,
  );

  // Check if usable has at least 2 members
  if (usable.length < 2) {
    return null;
  }

  // Check if primaryId is in usable
  const primary = usable.find((m) => m.id === primaryId);
  if (!primary) {
    return null;
  }

  // Check if max interval is >= floorDays
  const maxInterval = Math.max(...usable.map((m) => m.intervalDays));
  if (maxInterval < floorDays) {
    return null;
  }

  // Check if ratio of max to min is <= threshold
  const minInterval = Math.min(...usable.map((m) => m.intervalDays));
  if (maxInterval / minInterval <= threshold) {
    return null;
  }

  // Build config
  const primaryInterval = primary.intervalDays;
  const sortedMembers = [...usable].sort((a, b) => a.id.localeCompare(b.id));

  const config: DivergenceModalConfig = {
    primaryId: primaryId,
    primaryInterval: primaryInterval,
    members: sortedMembers.map((m) => ({
      id: m.id,
      intervalDays: m.intervalDays,
      ratioVsPrimary: m.intervalDays / primaryInterval,
    })),
    message: `Schedulers diverge: spread ${(maxInterval / minInterval).toFixed(1)}x over ${minInterval}d-${maxInterval}d (threshold ${threshold}x).`,
  };

  return config;
}
