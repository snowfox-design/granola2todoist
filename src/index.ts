export interface Env {
	PROCESSED_MEETINGS: KVNamespace;
	GRANOLA_API_KEY: string;
	TODOIST_API_TOKEN: string;
	ANTHROPIC_API_KEY: string;
}

interface GranolaNoteListItem {
	id: string;
	title: string | null;
	created_at: string;
	updated_at: string;
	web_url: string;
	owner: { name: string; email: string };
}

interface GranolaNoteDetail {
	id: string;
	title: string | null;
	created_at: string;
	updated_at: string;
	web_url: string;
	owner: { name: string; email: string };
	summary_text: string;
	summary_markdown: string | null;
	calendar_event: { title: string; start_time: string; end_time: string } | null;
	attendees: { name: string; email: string }[];
}

interface ActionItem {
	title: string;
	due_date: string | null;
}

interface TodoistTask {
	id: string;
}

const GRANOLA_BASE = "https://public-api.granola.ai/v1";
const TODOIST_BASE = "https://api.todoist.com/rest/v2";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

async function fetchRecentNotes(apiKey: string, since: string): Promise<GranolaNoteListItem[]> {
	const allNotes: GranolaNoteListItem[] = [];
	let cursor: string | undefined;

	do {
		const params = new URLSearchParams({ created_after: since, page_size: "30" });
		if (cursor) params.set("cursor", cursor);

		const res = await fetch(`${GRANOLA_BASE}/notes?${params}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});

		if (!res.ok) {
			console.error(`Granola API error: ${res.status} ${res.statusText}`);
			return allNotes;
		}

		const data = (await res.json()) as {
			notes: GranolaNoteListItem[];
			hasMore: boolean;
			cursor: string;
		};

		allNotes.push(...data.notes);
		cursor = data.hasMore ? data.cursor : undefined;
	} while (cursor);

	return allNotes;
}

async function fetchNoteDetail(apiKey: string, noteId: string): Promise<GranolaNoteDetail | null> {
	const res = await fetch(`${GRANOLA_BASE}/notes/${noteId}`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});

	if (!res.ok) {
		console.error(`Granola note detail error for ${noteId}: ${res.status}`);
		return null;
	}

	return (await res.json()) as GranolaNoteDetail;
}

async function extractActionItems(apiKey: string, note: GranolaNoteDetail): Promise<ActionItem[]> {
	const noteContent = note.summary_markdown || note.summary_text;
	const meetingTitle = note.title || "Untitled Meeting";
	const attendees = note.attendees.map((a) => a.name).join(", ");

	const prompt = `You are analysing meeting notes to find action items assigned to a specific person.

Meeting title: ${meetingTitle}
Attendees: ${attendees}
Date: ${note.created_at}

Meeting notes:
${noteContent}

Find ALL tasks, action items, todos, or follow-ups assigned to or owned by the person named "Liam", "Liam Mackie", or "LM". These all refer to the same person. Look in every section — the items may appear under headings like "Action Items", "Actions", "Next Steps", "Todos", "Follow-ups", or any similar heading.

Return a JSON array of objects with:
- "title": concise imperative task description
- "due_date": ISO date string (YYYY-MM-DD) if a specific date is mentioned, otherwise null

If there are NO action items for Liam, return an empty array: []

Return ONLY valid JSON, no markdown fences, no explanation.`;

	const res = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: CLAUDE_MODEL,
			max_tokens: 1024,
			messages: [{ role: "user", content: prompt }],
		}),
	});

	if (!res.ok) {
		const errText = await res.text();
		console.error(`Claude API error: ${res.status} — ${errText}`);
		return [];
	}

	const data = (await res.json()) as {
		content: { type: string; text: string }[];
	};

	const text = data.content[0]?.text?.trim();
	if (!text) return [];

	try {
		const parsed = JSON.parse(text);
		if (!Array.isArray(parsed)) return [];
		return parsed as ActionItem[];
	} catch (e) {
		console.error("Failed to parse Claude response as JSON:", text);
		return [];
	}
}

async function createTodoistTask(
	token: string,
	item: ActionItem,
	note: GranolaNoteDetail,
): Promise<void> {
	const body: Record<string, string> = { content: item.title };
	if (item.due_date) body.due_date = item.due_date;

	const res = await fetch(`${TODOIST_BASE}/tasks`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const errText = await res.text();
		console.error(`Todoist create task error: ${res.status} — ${errText}`);
		return;
	}

	const task = (await res.json()) as TodoistTask;

	const meetingDate = new Date(note.created_at).toLocaleString("en-AU", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Australia/Sydney",
	});

	const commentBody = [
		`**Meeting:** ${note.title || "Untitled"}`,
		`**Date:** ${meetingDate}`,
		`**Link:** ${note.web_url}`,
	].join("\n");

	const commentRes = await fetch(`${TODOIST_BASE}/comments`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ task_id: task.id, content: commentBody }),
	});

	if (!commentRes.ok) {
		console.error(`Todoist comment error for task ${task.id}: ${commentRes.status}`);
	}
}

interface ProcessOptions {
	testMode: boolean;
	titleFilter?: string;
	createTasks?: boolean; // override: create real tasks even in test mode
}

async function processNotes(env: Env, opts: ProcessOptions): Promise<string> {
	const { testMode, titleFilter, createTasks } = opts;
	const dryRun = testMode && !createTasks;
	const logs: string[] = [];
	const log = (msg: string) => {
		console.log(msg);
		logs.push(msg);
	};

	log("=== granola2todoist run started ===");
	log(`Mode: ${dryRun ? "TEST (dry run)" : testMode && createTasks ? "TEST (live create)" : "LIVE"}`);
	if (titleFilter) log(`Filter: title contains "${titleFilter}"`);

	// Test mode: look back 7 days to find something to test with
	// Live mode: on first run use 24h, subsequent runs use 10 min overlap
	const lastRun = await env.PROCESSED_MEETINGS.get("__last_run__");
	const since = testMode
		? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
		: lastRun
			? new Date(Date.now() - 10 * 60 * 1000).toISOString()
			: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

	log(`Fetching notes since: ${since}`);

	let notes = await fetchRecentNotes(env.GRANOLA_API_KEY, since);
	log(`Fetched ${notes.length} note(s) from Granola`);

	// Apply title filter if specified
	if (titleFilter) {
		const filter = titleFilter.toLowerCase();
		notes = notes.filter((n) => n.title?.toLowerCase().includes(filter));
		log(`Filtered to ${notes.length} note(s) matching "${titleFilter}"`);
	}

	let skipped = 0;
	let processed = 0;
	let tasksCreated = 0;

	for (const note of notes) {
		// In test mode without filter, only process the most recent note
		if (testMode && !titleFilter && processed > 0) break;

		// Check KV (skip in test mode to allow re-runs)
		if (!testMode) {
			const existing = await env.PROCESSED_MEETINGS.get(note.id);
			if (existing) {
				skipped++;
				continue;
			}
		}

		log(`Processing: "${note.title}" (${note.id})`);

		const detail = await fetchNoteDetail(env.GRANOLA_API_KEY, note.id);
		if (!detail) {
			log(`  Skipping — could not fetch note detail`);
			continue;
		}

		const items = await extractActionItems(env.ANTHROPIC_API_KEY, detail);
		log(`  Found ${items.length} action item(s) for Liam`);

		if (items.length === 0) {
			if (!testMode) {
				await env.PROCESSED_MEETINGS.put(note.id, new Date().toISOString());
			}
			processed++;
			continue;
		}

		for (const item of items) {
			if (dryRun) {
				log(`  [DRY RUN] Would create task: "${item.title}" (due: ${item.due_date || "none"})`);
			} else {
				await createTodoistTask(env.TODOIST_API_TOKEN, item, detail);
				log(`  Created task: "${item.title}"`);
			}
			tasksCreated++;
		}

		if (!testMode) {
			await env.PROCESSED_MEETINGS.put(note.id, new Date().toISOString());
		}
		processed++;
	}

	if (!testMode) {
		await env.PROCESSED_MEETINGS.put("__last_run__", new Date().toISOString());
	}

	log(`--- Summary: ${processed} processed, ${skipped} skipped, ${tasksCreated} task(s) created ---`);
	return logs.join("\n");
}

export default {
	async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
		await processNotes(env, { testMode: false });
	},

	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.searchParams.get("test") === "true") {
			const titleFilter = url.searchParams.get("title") || undefined;
			const createTasks = url.searchParams.get("create") === "true";
			const output = await processNotes(env, { testMode: true, titleFilter, createTasks });
			return new Response(output, { headers: { "Content-Type": "text/plain" } });
		}

		return new Response("granola2todoist is running. Add ?test=true for a dry run.", {
			status: 200,
		});
	},
};
