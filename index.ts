import "dotenv/config";
import { Bot, InputFile, InputMediaBuilder } from "grammy";
import cron from "node-cron";
import { fetchSchema, fetchTasks, fetchAllTasks, fetchAllPageIds, archivePages } from "./notion.js";
import { computeMetrics, formatMetrics, formatCaption, formatUnfinished } from "./metrics.js";
import { completionChart, categoriesChart } from "./charts.js";
import { summarizeWeek } from "./ai.js";

const required = ["TELEGRAM_BOT_TOKEN", "NOTION_TOKEN", "NOTION_DATABASE_ID", "GEMINI_API_KEY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Не задана переменная окружения ${key}`);
}

const DB_ID = process.env.NOTION_DATABASE_ID!;
const TZ = process.env.TIMEZONE ?? "Europe/Vienna";
const OWNER = process.env.OWNER_CHAT_ID ? Number(process.env.OWNER_CHAT_ID) : null;
const DONE_STATUSES = (process.env.DONE_STATUSES ?? "Done,Completed,Готово,Завершено")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Чистка базы после воскресного отчёта
const ARCHIVE_AFTER_REPORT = (process.env.ARCHIVE_AFTER_REPORT ?? "true") !== "false";
const ARCHIVE_SCOPE = process.env.ARCHIVE_SCOPE === "week" ? "week" : "all";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

function ymd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Последние 7 дней, включая сегодня */
function weekRange(): { start: string; end: string } {
  const now = new Date();
  const startDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { start: ymd(startDate), end: ymd(now) };
}

async function sendLong(chatId: number, text: string) {
  const LIMIT = 4000;
  let rest = text;
  while (rest.length > 0) {
    let chunk = rest.slice(0, LIMIT);
    if (rest.length > LIMIT) {
      const cut = chunk.lastIndexOf("\n");
      if (cut > 0) chunk = chunk.slice(0, cut);
    }
    await bot.api.sendMessage(chatId, chunk);
    rest = rest.slice(chunk.length).trimStart();
  }
}

async function archiveAfterReport(chatId: number, weekTaskIds: string[]) {
  const ids = ARCHIVE_SCOPE === "all" ? await fetchAllPageIds(DB_ID) : weekTaskIds;
  await bot.api.sendMessage(chatId, `🗑 Архивирую задачи в Notion: ${ids.length}...`);
  const { archived, failed } = await archivePages(ids);
  await bot.api.sendMessage(
    chatId,
    `🗑 Готово: убрано в корзину Notion ${archived}` +
      (failed ? `, не удалось: ${failed} (смотри логи)` : "") +
      `.\nВосстановить можно из Trash в Notion.`
  );
}

async function sendWeeklyReport(chatId: number, opts: { archive: boolean }) {
  const { start, end } = weekRange();

  const [schema, tasks] = await Promise.all([
    fetchSchema(DB_ID),
    fetchTasks(DB_ID, start, end),
  ]);

  if (tasks.length === 0) {
    await bot.api.sendMessage(chatId, `За период ${start} — ${end} задач в базе нет. Ничего не удаляю.`);
    return;
  }

  const metrics = computeMetrics(tasks, schema, DONE_STATUSES);

  // 1) Метрики картинками (при ошибке рендера — текстовый фолбэк)
  try {
    const [pie, bars] = await Promise.all([
      completionChart(metrics, start, end),
      categoriesChart(metrics),
    ]);
    await bot.api.sendMediaGroup(chatId, [
      InputMediaBuilder.photo(new InputFile(pie, "completion.png"), {
        caption: formatCaption(metrics, start, end),
      }),
      InputMediaBuilder.photo(new InputFile(bars, "categories.png")),
    ]);
  } catch (err) {
    console.error("Chart error:", err);
    await sendLong(chatId, formatMetrics(metrics, start, end));
  }

  const unfinished = formatUnfinished(metrics);
  if (unfinished) await sendLong(chatId, unfinished);

  // 2) AI-summary
  let summaryOk = true;
  try {
    const summary = await summarizeWeek(tasks, metrics, start, end);
    await sendLong(chatId, `🧠 Summary недели\n\n${summary}`);
  } catch (err) {
    summaryOk = false;
    console.error("Gemini error:", err);
    await bot.api.sendMessage(chatId, "⚠️ Не получилось сгенерировать AI-summary.");
  }

  // 3) Очистка базы — только если всё успешно доставлено
  if (opts.archive) {
    if (!summaryOk) {
      await bot.api.sendMessage(chatId, "Задачи НЕ удалены: summary не отправился. Повтори через /week_clean.");
      return;
    }
    await archiveAfterReport(chatId, tasks.map((t) => t.id));
  }
}

bot.use(async (ctx, next) => {
  if (OWNER !== null && ctx.chat?.id !== OWNER) return;
  await next();
});

bot.command("start", (ctx) =>
  ctx.reply(
    `Привет! Твой chat id: ${ctx.chat.id}\n\n` +
      `/week — отчёт за последние 7 дней (ничего не удаляет)\n` +
      `/week_clean — тот же отчёт + очистка базы, как в воскресенье\n` +
      `/check — показать все задачи из Notion в текущей базе`
  )
);

bot.command("week", async (ctx) => {
  await ctx.reply("Собираю данные из Notion... ⏳");
  try {
    await sendWeeklyReport(ctx.chat.id, { archive: false });
  } catch (err) {
    console.error(err);
    await ctx.reply(`Ошибка: ${(err as Error).message.slice(0, 500)}`);
  }
});

bot.command("week_clean", async (ctx) => {
  await ctx.reply("Собираю данные из Notion... ⏳");
  try {
    await sendWeeklyReport(ctx.chat.id, { archive: true });
  } catch (err) {
    console.error(err);
    await ctx.reply(`Ошибка: ${(err as Error).message.slice(0, 500)}`);
  }
});

bot.command("check", async (ctx) => {
  await ctx.reply("Загружаю все строки из Notion... ⏳");
  try {
    const tasks = await fetchAllTasks(DB_ID);
    if (!tasks.length) {
      await ctx.reply("В базе пока нет задач.");
      return;
    }

    const lines = tasks.map((task, index) => {
      const parts = [
        `${index + 1}. ${task.name}`,
        task.date ? `date: ${task.date}` : "date: —",
        `status: ${task.status}`,
        `type: ${task.types.length ? task.types.join(", ") : "—"}`,
      ];
      return parts.join(" | ");
    });

    const text = lines.join("\n");
    await sendLong(ctx.chat.id, `📋 Все задачи из базы (${tasks.length}):\n\n${text}`);
  } catch (err) {
    console.error(err);
    await ctx.reply(`Ошибка: ${(err as Error).message.slice(0, 500)}`);
  }
});

// Воскресный автоотчёт (с очисткой, если не отключена)
const cronExpr = process.env.WEEKLY_CRON ?? "0 18 * * 0";
if (OWNER !== null && cronExpr) {
  cron.schedule(
    cronExpr,
    () =>
      sendWeeklyReport(OWNER, { archive: ARCHIVE_AFTER_REPORT }).catch((e) =>
        console.error("Cron error:", e)
      ),
    { timezone: TZ }
  );
  console.log(
    `Авто-отчёт: "${cronExpr}" (${TZ}), очистка: ${ARCHIVE_AFTER_REPORT ? ARCHIVE_SCOPE : "выкл"}`
  );
}

bot.catch((err) => console.error("Bot error:", err));
bot.start();
console.log("Бот запущен");
