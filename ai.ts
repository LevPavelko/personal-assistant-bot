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
  const prompt = `You are a personal productivity assistant. Analyze the user's tasks for the week ${start} — ${end}.

Tasks (JSON):
${JSON.stringify(tasks.map(({ id, ...t }) => t), null, 2)}

Calculated metrics (JSON):
${JSON.stringify(
  {
    total: metrics.total,
    done: metrics.done,
    notDone: metrics.notDone,
    byType: metrics.byType,
  },
  null,
  2
)}

Write a brief summary in English (up to 150 words):
1. What was the main progress during the week.
2. Where most time went and what was missed.
3. What remains unfinished and what deserves attention.
4. One concrete suggestion for the next week.

Rules: plain text without Markdown formatting (no *, #, _), emoji and short paragraphs are allowed. Do not invent facts; rely only on the data. Tasks are written in Russian, English and German so you have to transtale them to english first. Make no greetings`;

  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    contents: prompt,
  });


  return res.text || "Something went wrong.";
}
