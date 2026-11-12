import type { Metrics } from "./metrics.js";

const GREEN = "#4CAF50";
const ORANGE = "#FF9800";

/** Рендер через QuickChart (Chart.js v4) -> PNG. Наружу уходят только названия категорий и числа. */
async function renderChart(chart: object, width: number, height: number): Promise<Buffer> {
  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "4",
      width,
      height,
      devicePixelRatio: 2,
      backgroundColor: "white",
      format: "png",
      chart,
    }),
  });
  if (!res.ok) {
    throw new Error(`QuickChart ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Пончик: завершено / не завершено. */
export function completionChart(m: Metrics, start: string, end: string): Promise<Buffer> {
  return renderChart(
    {
      type: "doughnut",
      data: {
        labels: ["Завершено", "Не завершено"],
        datasets: [
          {
            data: [m.done || null, m.notDone || null], // null — чтобы не рисовать "0"
            backgroundColor: [GREEN, ORANGE],
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: [`Выполнено ${m.done} из ${m.total} (${m.donePct}%)`, `${start} — ${end}`],
            font: { size: 20 },
          },
          legend: { position: "bottom", labels: { font: { size: 16 } } },
          datalabels: { color: "#fff", font: { size: 22, weight: "bold" } },
        },
      },
    },
    600,
    600
  );
}

/** Горизонтальные столбцы по категориям (включая категории с 0 задач). */
export function categoriesChart(m: Metrics): Promise<Buffer> {
  const rows = [
    ...m.byType.map((t) => ({
      label: t.type,
      done: t.done,
      notDone: t.total - t.done,
    })),
    ...m.unusedTypes.map((t) => ({ label: `${t} (0)`, done: 0, notDone: 0 })),
  ];

  const height = Math.max(350, 140 + rows.length * 55);

  return renderChart(
    {
      type: "bar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          { label: "Завершено", data: rows.map((r) => r.done || null), backgroundColor: GREEN },
          { label: "Не завершено", data: rows.map((r) => r.notDone || null), backgroundColor: ORANGE },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          title: { display: true, text: "Категории: куда ушло время", font: { size: 20 } },
          legend: { position: "bottom", labels: { font: { size: 16 } } },
          datalabels: { color: "#fff", font: { size: 16, weight: "bold" } },
        },
        scales: {
          x: { stacked: true, ticks: { stepSize: 1, precision: 0 } },
          y: { stacked: true, ticks: { font: { size: 15 } } },
        },
      },
    },
    800,
    height
  );
}
