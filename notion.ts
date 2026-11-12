const NOTION_VERSION = "2022-06-28";

export type Task = {
  id: string;
  name: string;
  date: string | null;
  status: string;
  types: string[];
};

export type Schema = {
  typeOptions: string[];
  statusOptions: string[];
};

async function notionFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Notion API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Get all possible Type and Status values (to find unused categories). */
export async function fetchSchema(databaseId: string): Promise<Schema> {
  const db = await notionFetch(`/databases/${databaseId}`);
  const typeProp = db.properties?.["Type"];
  const statusProp = db.properties?.["Status"];

  const typeOptions: string[] = (
    typeProp?.select?.options ??
    typeProp?.multi_select?.options ??
    []
  ).map((o: any) => o.name);

  const statusOptions: string[] = (
    statusProp?.status?.options ??
    statusProp?.select?.options ??
    []
  ).map((o: any) => o.name);

  return { typeOptions, statusOptions };
}

/** Convert a Notion page to a Task. */
function mapTask(page: any): Task {
  const p = page.properties;
  const typeProp = p["Type"];
  const statusProp = p["Status"];

  return {
    id: page.id,
    name:
      (p["Name"]?.title ?? []).map((t: any) => t.plain_text).join("") ||
      "(untitled)",
    date: p["Date"]?.date?.start ?? null,
    status: statusProp?.status?.name ?? statusProp?.select?.name ?? "No status",
    types: typeProp?.select
      ? [typeProp.select.name]
      : (typeProp?.multi_select ?? []).map((o: any) => o.name),
  };
}

/** Tasks with Date in the range [start, end] (format YYYY-MM-DD, inclusive). */
export async function fetchTasks(
  databaseId: string,
  start: string,
  end: string
): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;

  do {
    const data = await notionFetch(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        filter: {
          and: [
            { property: "Date", date: { on_or_after: start } },
            { property: "Date", date: { on_or_before: end } },
          ],
        },
        sorts: [{ property: "Date", direction: "ascending" }],
      }),
    });

    for (const page of data.results) tasks.push(mapTask(page));

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return tasks; //status is ok just like in Notion
}

/** All tasks in the database without a date filter. */
export async function fetchAllTasks(databaseId: string): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;

  do {
    const data = await notionFetch(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        sorts: [{ property: "Date", direction: "ascending" }],
      }),
    });

    for (const page of data.results) tasks.push(mapTask(page));

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  console.log("Tasks: ", tasks);
  return tasks;
}

/** IDs of all non-archived pages in the database — without a date filter. */
export async function fetchAllPageIds(databaseId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionFetch(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    for (const page of data.results) ids.push(page.id);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return ids;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Archive a page (moves it to Notion Trash, where it can be restored). Retries on rate limits. */
export async function archivePage(pageId: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await notionFetch(`/pages/${pageId}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      return;
    } catch (err) {
      const rateLimited = String((err as Error).message).includes("Notion API 429");
      if (rateLimited && attempt < 4) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

/** Archive pages sequentially (≈3 requests/sec due to Notion limits). */
export async function archivePages(
  ids: string[]
): Promise<{ archived: number; failed: number }> {
  let archived = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await archivePage(id);
      archived++;
    } catch (e) {
      console.error("Failed to archive", id, e);
      failed++;
    }
    await sleep(350);
  }
  return { archived, failed };
}
