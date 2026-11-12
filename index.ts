import "dotenv/config";
import { Bot, InputFile, InputMediaBuilder } from "grammy";
import cron from "node-cron";
import { fetchSchema, fetchTasks, fetchAllTasks, fetchAllPageIds, archivePages } from "./notion.js";
import { computeMetrics, formatMetrics, formatCaption, formatUnfinished } from "./metrics.js";
import { completionChart, categoriesChart } from "./charts.js";
import { summarizeWeek } from "./ai.js";

const required = ["TELEGRAM_BOT_TOKEN", "NOTION_TOKEN", "NOTION_DATABASE_ID", "GEMINI_API_KEY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Environment variable is not set: ${key}`);
}

const DB_ID = process.env.NOTION_DATABASE_ID!;
const TZ = process.env.TIMEZONE ?? "Europe/Vienna";
const OWNER = process.env.OWNER_CHAT_ID ? Number(process.env.OWNER_CHAT_ID) : null;
const DONE_STATUSES = (process.env.DONE_STATUSES ?? "Done,Completed")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const IN_PROGRESS_STATUSES = (process.env.IN_PROGRESS_STATUSES ?? "In Progress,InProgress")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const NOT_STARTED_STATUSES = (process.env.NOT_STARTED_STATUSES ?? "Not Started,NotStarted")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Clean up the database after the weekly report
const ARCHIVE_AFTER_REPORT = (process.env.ARCHIVE_AFTER_REPORT ?? "true") !== "false";
const ARCHIVE_SCOPE = process.env.ARCHIVE_SCOPE === "week" ? "week" : "all";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

function ymd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Last 7 days, including today. */
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
  await bot.api.sendMessage(chatId, `🗑 Archiving tasks in Notion: ${ids.length}...`);
  const { archived, failed } = await archivePages(ids);
  await bot.api.sendMessage(
    chatId,
    `🗑 Done: moved to Notion Trash ${archived}` +
      (failed ? `, failed: ${failed} (check logs)` : "") +
      `.\nYou can restore them from Trash in Notion.`
  );
}

async function sendWeeklyReport(chatId: number, opts: { archive: boolean }) {
  const { start, end } = weekRange();

  const [schema, tasks] = await Promise.all([
    fetchSchema(DB_ID),
    fetchTasks(DB_ID, start, end),
  ]);

  if (tasks.length === 0) {
    await bot.api.sendMessage(chatId, `There are no tasks in the database for the period ${start} — ${end}. Nothing will be deleted.`);
    return;
  }

  const metrics = computeMetrics(
    tasks,
    DONE_STATUSES,
    IN_PROGRESS_STATUSES,
    NOT_STARTED_STATUSES
  );

  // 1) Metrics as images (if rendering fails, use a text fallback)
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

  // 2) AI summary
  let summaryOk = true;
  try {
    const summary = await summarizeWeek(tasks, metrics, start, end);
    await sendLong(chatId, `🧠 Weekly summary\n\n${summary}`);
  } catch (err) {
    summaryOk = false;
    console.error("Gemini error:", err);
    await bot.api.sendMessage(chatId, "⚠️ Failed to generate AI summary.");
  }

  // 3) Database cleanup — only after all messages were delivered
  if (opts.archive) {
    if (!summaryOk) {
      await bot.api.sendMessage(chatId, "Tasks were NOT deleted: summary was not sent. Retry with /week_clean.");
      return;
    }
    await archiveAfterReport(chatId, tasks.map((t) => t.id));
  }
}

bot.use(async (ctx, next) => {
  if (OWNER !== null && ctx.chat?.id !== OWNER) return ctx.reply("Fuck off");
  await next();
});

bot.command("start", (ctx) =>
  ctx.reply(
    `Hello! Your chat id: ${ctx.chat.id}\n\n` +
      `/week — report for the last 7 days (does not delete anything)\n` +
      `/week_clean — the same report + database cleanup, like on Sunday\n` +
      `/check — show all tasks from the current Notion database`
  )
);

bot.command("week", async (ctx) => {
  await ctx.reply("Collecting data from Notion... ⏳");
  try {
    await sendWeeklyReport(ctx.chat.id, { archive: false });
  } catch (err) {
    console.error(err);
    await ctx.reply(`Error: ${(err as Error).message.slice(0, 500)}`);
  }
});

bot.command("week_clean", async (ctx) => {
  await ctx.reply("Collecting data from Notion... ⏳");
  try {
    await sendWeeklyReport(ctx.chat.id, { archive: true });
  } catch (err) {
    console.error(err);
    await ctx.reply(`Error: ${(err as Error).message.slice(0, 500)}`);
  }
});

bot.command("check", async (ctx) => {
  await ctx.reply("Loading all rows from Notion... ⏳");
  try {
    const tasks = await fetchAllTasks(DB_ID);
    if (!tasks.length) {
      await ctx.reply("There are no tasks in the database yet.");
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
    await sendLong(ctx.chat.id, `📋 All tasks in the database (${tasks.length}):\n\n${text}`);
  } catch (err) {
    console.error(err);
    await ctx.reply(`Error: ${(err as Error).message.slice(0, 500)}`);
  }
});

// Weekly auto-report (with cleanup if enabled)
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
    `Auto-report: "${cronExpr}" (${TZ}), cleanup: ${ARCHIVE_AFTER_REPORT ? ARCHIVE_SCOPE : "off"}`
  );
}

bot.catch((err) => console.error("Bot error:", err));
bot.start();
console.log("Bot started");
