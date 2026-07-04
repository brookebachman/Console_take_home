# GitHub → Slack Issue Digest

A lightweight integration app that connects GitHub and Slack via OAuth and exposes a webhook endpoint to pull open issues from a GitHub repo and post a formatted digest to a Slack channel.

## What It Does

1. Connect your GitHub account and Slack workspace through OAuth (in-app, no config files)
2. Hit the webhook endpoint with a repo name and Slack channel
3. The app fetches open issues from GitHub, formats them into a digest, and posts it to Slack
4. Returns a JSON summary showing what was pulled, what was posted, and when

## How to Run Locally

### Prerequisites
- Node.js
- A GitHub OAuth App ([create one here](https://github.com/settings/developers))
  - Callback URL: `http://localhost:3000/auth/github/callback`
- A Slack App ([create one here](https://api.slack.com/apps))
  - Bot Token Scopes: `chat:write`, `channels:read`
  - Redirect URL: `http://localhost:3000/auth/slack/callback`

### Setup

```bash
git clone https://github.com/brookebachman/Console_take_home.git
cd Console_take_home
npm install
```

Create a `.env` file:

```
GITHUB_OAUTH_CLIENT_ID=your-github-client-id
GITHUB_OAUTH_SECRET=your-github-client-secret
SLACK_CLIENT_ID=your-slack-client-id
SLACK_CLIENT_SECRET=your-slack-client-secret
```

### Start the server

```bash
npm start
```

Open `http://localhost:3000` to connect integrations and trigger digests.

## Deployed Version

[Deployed URL here]

## API Reference

### `GET /api/status`

Returns the connection status of both integrations.

### `POST /webhook/digest`

Pulls open GitHub issues and posts a digest to Slack.

**Request body:**

```json
{
  "repo": "owner/repo",
  "channel": "slack-channel-name",
  "labels": "bug,enhancement",
  "since": "2026-07-01"
}
```

| Param | Required | Description |
|-------|----------|-------------|
| `repo` | Yes | GitHub repo in `owner/repo` format |
| `channel` | No | Slack channel name (default: `new-channel`) |
| `labels` | No | Comma-separated GitHub labels to filter by |
| `since` | No | ISO date to only show issues updated since |

**Example:**

```bash
curl -X POST http://localhost:3000/webhook/digest \
  -H "Content-Type: application/json" \
  -d '{"repo": "facebook/react", "channel": "new-channel"}'
```

**Response:**

```json
{
  "success": true,
  "summary": {
    "repo": "facebook/react",
    "issues_found": 10,
    "channel": "#new-channel",
    "message_posted": true,
    "timestamp": "2026-07-04T19:00:00.000Z"
  },
  "issues": [
    {
      "number": 12345,
      "title": "Bug in useEffect cleanup",
      "url": "https://github.com/facebook/react/issues/12345",
      "labels": ["bug"],
      "created_at": "2026-07-01T10:00:00Z"
    }
  ]
}
```

### `GET /auth/github`

Starts the GitHub OAuth flow.

### `GET /auth/slack`

Starts the Slack OAuth flow.

### `POST /api/disconnect/github`

Disconnects the GitHub integration.

### `POST /api/disconnect/slack`

Disconnects the Slack integration.

## Error Handling

- **Missing connections:** Returns 400 with instructions to connect
- **Missing repo param:** Returns 400 with usage instructions
- **Repo not found:** Returns 404 with hint to check access
- **Rate limited:** Returns 403 with rate limit reset time
- **Slack channel not found:** Returns 400 with list of available channels
- **Bot not in channel:** Returns hint to invite the bot with `/invite @Console_Takehome`

## Design Decisions

- **In-memory token storage:** Tokens are stored in memory for simplicity. In production, these would be persisted in a database with encryption.
- **OAuth for both integrations:** The app supports dynamic authentication - you can connect to any GitHub account or Slack workspace without changing config. This meets the requirement for configurable integration connections.
- **Webhook endpoint accepts params:** The `repo`, `channel`, `labels`, and `since` params let external systems customize the behavior per request.
- **Error messages include hints:** When something fails (wrong channel, bot not invited, repo not found), the error response tells you exactly how to fix it.

## Tech Stack

- Node.js / Express
- GitHub REST API
- Slack Web API
- OAuth 2.0 for both integrations

## Assumptions

- The Slack bot must be invited to the target channel before it can post (standard Slack behavior)
- GitHub issues include pull requests by default (GitHub API behavior)
- The app is designed for a single user/connection at a time (no multi-tenancy)
