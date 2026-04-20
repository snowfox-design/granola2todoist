# granola2todoist

Automatically extracts action items from [Granola](https://granola.ai) meeting notes and creates tasks in [Todoist](https://todoist.com).

**Pipeline:** Granola API → Claude (action item extraction) → Todoist REST API

Runs on Cloudflare Workers with a cron trigger every 5 minutes.

## Setup

### Prerequisites
- Node.js 20+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Granola Business plan (for API access)
- Todoist API token
- Anthropic API key

### Environment Variables (Cloudflare Secrets)

```
wrangler secret put GRANOLA_API_KEY
wrangler secret put TODOIST_API_TOKEN
wrangler secret put ANTHROPIC_API_KEY
```

### Deploy

```bash
npm install
npm run deploy
```

### Local Development

```bash
# Create .dev.vars with your secrets:
# GRANOLA_API_KEY=grn_...
# TODOIST_API_TOKEN=...
# ANTHROPIC_API_KEY=sk-ant-...

npm run dev
```

### Test Mode

Trigger a dry run that processes the most recent Granola note without creating real Todoist tasks or updating KV state:

```
curl "https://granola2todoist.<your-subdomain>.workers.dev?test=true"
```

## How It Works

1. Every 5 minutes, the worker fetches recent Granola meeting notes
2. Skips any meetings already processed (tracked in KV)
3. Sends note content to Claude to extract action items assigned to Liam
4. Creates Todoist tasks with a comment linking back to the Granola note
5. On first run, only processes meetings from the last 24 hours
