import type { Metrics } from "./metrics.js";


/** Render via QuickChart (Chart.js v4) -> PNG. Only category names and numbers leave the app. */
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

/** Donut: completed / in progress / not started. */
export function completionChart(m: Metrics, start: string, end: string): Promise<Buffer> {
  return renderChart(
    {
      type: "doughnut",
      data: {
        labels: ["Completed", "In Progress", "Not Started"],
        datasets: [
          {
            data: [m.done || null, m.inProgress || null, m.notStarted || null],
            backgroundColor: ["rgb(31 166 0 / 0.78)", "rgb(74 126 255 / 0.78)", "rgb(244 0 0 / 0.78)"],
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: [`Completed ${m.done} of ${m.total} (${m.donePct}%)`, `${start} — ${end}`],
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

/** Horizontal bars by category (including zero-task categories). */
export function categoriesChart(m: Metrics): Promise<Buffer> {
  const rows = m.byType.map((t) => ({
    label: t.type,
    done: t.done,
    inProgress: t.inProgress,
    notStarted: t.notStarted,
  }));

  const height = Math.max(350, 140 + rows.length * 55);

  return renderChart(
    {
      type: "bar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          { label: "Completed", data: rows.map((r) => r.done || null), backgroundColor: "rgb(31 166 0 / 0.78)" },
          { label: "In Progress", data: rows.map((r) => r.inProgress || null), backgroundColor: "rgb(74 126 255 / 0.78)" },
          { label: "Not Started", data: rows.map((r) => r.notStarted || null), backgroundColor: "rgb(244 0 0 / 0.78)" },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          title: { display: true, text: "Categories: where time went", font: { size: 20 } },
          legend: { position: "bottom", labels: { font: { size: 16 } } },
          datalabels: { color: "#fff", font: { size: 16, weight: "bold" } },
        },
        scales: {
          x: { stacked: true, ticks: { stepSize: 1, precision: 0 } },
          y: { stacked: true, ticks: { font: { size: 15 } } },
        },
      },
    },
    900,
    height
  );
}
