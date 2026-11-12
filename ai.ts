import { GoogleGenAI } from "@google/genai";
import type { Task } from "./notion.js";
import type { Metrics } from "./metrics.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function summarizeWeek(
  tasks: Task[],
  metrics: Metrics,
  start: string,
  end: string
): Promise<string> {
  const prompt = `Ты — личный ассистент по продуктивности. Проанализируй задачи пользователя за неделю ${start} — ${end}.

Задачи (JSON):
${JSON.stringify(tasks.map(({ id, ...t }) => t), null, 2)}

Посчитанные метрики (JSON):
${JSON.stringify(
  {
    total: metrics.total,
    done: metrics.done,
    notDone: metrics.notDone,
    byType: metrics.byType,
    unusedTypes: metrics.unusedTypes,
  },
  null,
  2
)}

Напиши краткое summary на русском языке (до 150 слов):
1. Главное, что было сделано за неделю.
2. На что ушло больше всего времени и что было упущено (категории без задач).
3. Что осталось незавершённым и на что обратить внимание.
4. Один конкретный совет на следующую неделю.

Правила: обычный текст без Markdown-разметки (без *, #, _), можно использовать эмодзи и короткие абзацы. Не выдумывай факты, опирайся только на данные.`;

  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    contents: prompt,
  });

  return res.text?.trim() || "Не удалось получить summary от Gemini.";
}
