# granola2todoist — Build Instructions

## Project Overview
Build a system called "granola2todoist" that automatically detects new Granola 
meeting notes and creates action items assigned to me in Todoist. The system 
runs on Cloudflare Workers (serverless, scheduled), deployed via a GitHub repo 
that Cloudflare watches for changes.

---

## Step 0: Clean Up Old Cloudflare Worker
Before building anything new, use the `wrangler` CLI to:
1. List all existing Cloudflare Workers on this account
2. Identify any worker that appears related to Granola/Todoist integration
3. Ask me to confirm before deleting it
4. Delete the confirmed worker AND any associated KV namespaces it used
Do NOT proceed to Step 1 until this cleanup is complete and confirmed.

---

## Step 1: GitHub Repository Setup
1. Create a new GitHub repository called `granola2todoist`
2. Initialise it with a proper `.gitignore` for Node.js/Cloudflare Workers projects
3. Include a `README.md` explaining the project, setup steps, and required 
   environment variables
4. All code should be committed and pushed to the `main` branch

---

## Step 2: Cloudflare Workers Setup
1. Initialise a Cloudflare Worker project in the repo using `wrangler`
2. Configure a **Cloudflare KV namespace** called `PROCESSED_MEETINGS` to track 
   which Granola meeting IDs have already been processed (prevents duplicates)
3. Set up a **Cloudflare Git integration** so Cloudflare automatically deploys 
   from the GitHub repo's `main` branch on every push — walk me through 
   connecting this in the Cloudflare dashboard if CLI setup isn't fully 
   automated
4. Configure a **Cron Trigger** in `wrangler.toml` to run the worker every 
   5 minutes
5. All secrets (API keys) must be stored as **Cloudflare Worker Secrets** (not 
   in code or wrangler.toml). Prompt me for the following values and use 
   `wrangler secret put` to store them:
   - `GRANOLA_API_KEY`
   - `TODOIST_API_TOKEN`
   - `ANTHROPIC_API_KEY`

---

## Step 3: Core Logic — Fetching New Granola Meetings
1. Use the Granola API to fetch recent meetings/notes. First, check the Granola 
   API documentation or MCP server to understand the correct endpoint and 
   response structure before writing any code
2. For each meeting returned:
   - Check its unique ID against the `PROCESSED_MEETINGS` KV namespace
   - If the ID exists in KV → skip it (already processed)
   - If the ID does NOT exist in KV → process it (see Step 4)
3. After successfully processing a meeting, store its ID in KV with a timestamp 
   as the value
4. On the very first run, do NOT process all historical meetings — only 
   process meetings created in the last 24 hours, then track everything going 
   forward

---

## Step 4: Action Item Extraction via Claude API
Do NOT use regex or hardcoded string matching to find action items. Instead:

1. Take the full meeting note content from Granola (title, body, all sections)
2. Send it to the Claude API (claude-sonnet-4-20250514) with the following 
   prompt approach:
   - Identify the person named **Liam**, **Liam Mackie**, or **LM** in the 
     meeting notes — these all refer to the same person
   - Find any tasks, action items, todos, or follow-ups assigned to or 
     owned by that person — regardless of what heading or section they appear 
     under (the section might be called "Action Items", "Actions", "Next 
     Steps", "Todos", or anything similar)
   - Return a structured JSON array of tasks, each with:
     - `title`: the task description (concise, imperative)
     - `due_date`: ISO date string if a specific date is mentioned, otherwise null
     - `notes`: leave empty — this will be populated in Step 5
3. If Claude finds zero action items for me, skip this meeting entirely (do 
   not create any Todoist tasks)
4. Handle Claude API errors gracefully — log them but do not crash the worker

---

## Step 5: Create Todoist Tasks
For each action item returned from Step 4:
1. Use the Todoist REST API to create a task with:
   - `content`: the task title from Claude
   - `due_string`: the due date if present (use Todoist's natural language 
     due date field if an ISO date was found)
   - Project: Inbox (default — do not specify a project_id)
2. After creating the task, add a **comment** to it containing:
   - The Granola meeting title
   - The direct link to the Granola meeting note (if the API provides one)
   - The date/time of the meeting
3. Handle Todoist API errors gracefully — log them, do not crash the worker

---

## Step 6: Logging & Observability
1. Use `console.log` throughout with structured output so logs are readable in 
   the Cloudflare Workers dashboard
2. Log: worker start, number of meetings fetched, number of new meetings, 
   number skipped, number of tasks created, any errors
3. Do NOT log full meeting content or API keys

---

## Step 7: Testing
1. Write a test mode that can be triggered manually (e.g. via a GET request to 
   the worker with a `?test=true` query param) that:
   - Fetches the most recent Granola meeting regardless of KV state
   - Runs it through the full pipeline
   - Does NOT write to KV (so it can be re-run without side effects)
   - Does NOT create real Todoist tasks — instead logs what WOULD be created
2. After deployment, walk me through how to trigger a test run

---

## Technical Constraints
- Language: TypeScript
- Runtime: Cloudflare Workers (no Node.js APIs — use Web APIs and fetch only)
- No hardcoded logic for parsing meeting notes — Claude does all interpretation
- Secrets via Cloudflare Worker Secrets only
- All code in GitHub, deployed via Cloudflare Git integration

---

## Definition of Done
- [ ] Old Cloudflare Worker and its KV namespaces deleted
- [ ] New GitHub repo created and code committed
- [ ] Cloudflare Worker deployed and cron trigger active
- [ ] All secrets stored securely
- [ ] Test mode works and produces sensible output
- [ ] At least one real meeting processed successfully end-to-end
