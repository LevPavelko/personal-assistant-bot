import type { Task, Schema } from "./notion.js";

export type Metrics = {
  total: number;
  done: number;
  notDone: number;
  donePct: number;
  byStatus: [string, number][];
  byType: { type: string; total: number; done: number }[];
  unusedTypes: string[];
  notDoneTasks: Task[];
};

const NO_TYPE = "Без категории";

export function computeMetrics(
  tasks: Task[],
  schema: Schema,
  doneStatuses: string[]
): Metrics {
  const doneSet = new Set(doneStatuses.map((s) => s.trim().toLowerCase()));
  const isDone = (t: Task) => doneSet.has(t.status.toLowerCase());

  const statusMap = new Map<string, number>();
  const typeMap = new Map<string, { total: number; done: number }>();

  for (const t of tasks) {
    statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1);

    const types = t.types.length ? t.types : [NO_TYPE];
    for (const type of types) {
      const cur = typeMap.get(type) ?? { total: 0, done: 0 };
      cur.total++;
      if (isDone(t)) cur.done++;
      typeMap.set(type, cur);
    }
  }

  const done = tasks.filter(isDone).length;
  const usedTypes = new Set(typeMap.keys());

  return {
    total: tasks.length,
    done,
    notDone: tasks.length - done,
    donePct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    byStatus: [...statusMap.entries()].sort((a, b) => b[1] - a[1]),
    byType: [...typeMap.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.total - a.total),
    unusedTypes: schema.typeOptions.filter((o) => !usedTypes.has(o)),
    notDoneTasks: tasks.filter((t) => !isDone(t)),
  };
}

export function formatMetrics(m: Metrics, start: string, end: string): string {
  const max = Math.max(1, ...m.byType.map((t) => t.total));
  const bar = (n: number) => "█".repeat(Math.max(1, Math.round((n / max) * 10)));

  const lines: string[] = [];
  lines.push(`📊 Неделя ${start} — ${end}`);
  lines.push("");
  lines.push(`Всего задач: ${m.total}`);
  lines.push(`✅ Завершено: ${m.done} (${m.donePct}%)`);
  lines.push(`⏳ Не завершено: ${m.notDone}`);

  if (m.byStatus.length) {
    lines.push("");
    lines.push("По статусам:");
    for (const [s, n] of m.byStatus) lines.push(`• ${s}: ${n}`);
  }

  if (m.byType.length) {
    lines.push("");
    lines.push("Категории, куда ушло время:");
    for (const t of m.byType) {
      lines.push(`${t.type}: ${bar(t.total)} ${t.total} (готово ${t.done}/${t.total})`);
    }
  }

  lines.push("");
  lines.push(
    m.unusedTypes.length
      ? `🚫 Без внимания: ${m.unusedTypes.join(", ")}`
      : "🚫 Без внимания: нет — все категории были затронуты"
  );

  if (m.notDoneTasks.length) {
    lines.push("");
    lines.push("Незавершённые задачи:");
    for (const t of m.notDoneTasks) {
      const meta = [t.types.join("/") || null, t.date, t.status].filter(Boolean).join(", ");
      lines.push(`• ${t.name} (${meta})`);
    }
  }

  return lines.join("\n");
}

/** Короткая подпись к картинкам. */
export function formatCaption(m: Metrics, start: string, end: string): string {
  const lines = [
    `📊 Неделя ${start} — ${end}`,
    `Всего: ${m.total} · ✅ ${m.done} (${m.donePct}%) · ⏳ ${m.notDone}`,
  ];
  lines.push(
    m.unusedTypes.length
      ? `🚫 Без внимания: ${m.unusedTypes.join(", ")}`
      : "🚫 Без внимания: нет — все категории затронуты"
  );
  return lines.join("\n");
}

/** Список незавершённых задач. */
export function formatUnfinished(m: Metrics): string | null {
  if (!m.notDoneTasks.length) return null;
  const lines = ["⏳ Незавершённые задачи:"];
  for (const t of m.notDoneTasks) {
    const meta = [t.types.join("/") || null, t.date, t.status].filter(Boolean).join(", ");
    lines.push(`• ${t.name} (${meta})`);
  }
  return lines.join("\n");
}
