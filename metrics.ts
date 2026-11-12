import type { Task } from "./notion.js";

export type Metrics = {
  total: number;
  done: number;
  inProgress: number;
  notStarted: number;
  notDone: number;
  donePct: number;
  byStatus: [string, number][];
  byType: { type: string; total: number; done: number; inProgress: number; notStarted: number }[];
  notDoneTasks: Task[];
};

const NO_TYPE = "No category";

function normalizeStatusValue(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function computeMetrics(
  tasks: Task[],
  doneStatuses: string[],
  inProgressStatuses: string[] = [],
  notStartedStatuses: string[] = []
): Metrics {
  const doneSet = new Set(doneStatuses.map((s) => normalizeStatusValue(s)));
  const inProgressSet = new Set(inProgressStatuses.map((s) => normalizeStatusValue(s)));
  const notStartedSet = new Set(notStartedStatuses.map((s) => normalizeStatusValue(s)));

  const isDone = (t: Task) => doneSet.has(normalizeStatusValue(t.status));
  const isInProgress = (t: Task) => inProgressSet.has(normalizeStatusValue(t.status));
  const isNotStarted = (t: Task) => notStartedSet.has(normalizeStatusValue(t.status));

  const statusMap = new Map<string, number>();
  const typeMap = new Map<string, { total: number; done: number; inProgress: number; notStarted: number }>();

  let done = 0;
  let inProgress = 0;
  let notStarted = 0;

  for (const t of tasks) {
    statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1);

    if (isDone(t)) {
      done++;
    } else if (isInProgress(t) || normalizeStatusValue(t.status) === "in progress" || normalizeStatusValue(t.status) === "inprogress") {
      inProgress++;
    } else {
      notStarted++;
    }

    const types = t.types.length ? t.types : [NO_TYPE];
    for (const type of types) {
      const cur = typeMap.get(type) ?? { total: 0, done: 0, inProgress: 0, notStarted: 0 };
      cur.total++;
      if (isDone(t)) cur.done++;
      else if (isInProgress(t) || normalizeStatusValue(t.status) === "in progress" || normalizeStatusValue(t.status) === "inprogress") cur.inProgress++;
      else cur.notStarted++;
      typeMap.set(type, cur);
    }
  }

  const total = tasks.length;

  return {
    total,
    done,
    inProgress,
    notStarted,
    notDone: inProgress + notStarted,
    donePct: total ? Math.round((done / total) * 100) : 0,
    byStatus: [...statusMap.entries()].sort((a, b) => b[1] - a[1]),
    byType: [...typeMap.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.total - a.total),
    notDoneTasks: tasks.filter((t) => !isDone(t)),
  };
}

export function formatMetrics(m: Metrics, start: string, end: string): string {
  const max = Math.max(1, ...m.byType.map((t) => t.total));
  const bar = (n: number) => "█".repeat(Math.max(1, Math.round((n / max) * 10)));

  const lines: string[] = [];
  lines.push(`📊 Week ${start} — ${end}`);
  lines.push("");
  lines.push(`Total tasks: ${m.total}`);
  lines.push(`✅ Completed: ${m.done} (${m.donePct}%)`);
  lines.push(`🔄 In progress: ${m.inProgress}`);
  lines.push(`⏳ Not started: ${m.notStarted}`);

  if (m.byStatus.length) {
    lines.push("");
    lines.push("By status:");
    for (const [s, n] of m.byStatus) lines.push(`• ${s}: ${n}`);
  }

  if (m.byType.length) {
    lines.push("");
    lines.push("Categories where time went:");
    for (const t of m.byType) {
      lines.push(`${t.type}: ${bar(t.total)} ${t.total} (done ${t.done}/${t.total})`);
    }
  }

  if (m.notDoneTasks.length) {
    lines.push("");
    lines.push("Open tasks:");
    for (const t of m.notDoneTasks) {
      const meta = [t.types.join("/") || null, t.date, t.status].filter(Boolean).join(", ");
      lines.push(`• ${t.name} (${meta})`);
    }
  }

  return lines.join("\n");
}

/** Short caption for images. */
export function formatCaption(m: Metrics, start: string, end: string): string {
  return [
    `📊 Week ${start} — ${end}`,
    `Total: ${m.total} · ✅ ${m.done} · 🔄 ${m.inProgress} · ⏳ ${m.notStarted}`,
    `Done: ${m.donePct}%`,
  ].join("\n");
}

/** List of unfinished tasks. */
export function formatUnfinished(m: Metrics): string | null {
  if (!m.notDoneTasks.length) return null;
  const lines = ["⏳ Open tasks:"];
  for (const t of m.notDoneTasks) {
    const meta = [t.types.join("/") || null, t.date, t.status].filter(Boolean).join(", ");
    lines.push(`• ${t.name} (${meta})`);
  }
  return lines.join("\n");
}
