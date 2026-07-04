require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// In-memory store for connected integrations
const connections = {
  github: null, // { access_token, username }
  slack: null, // { access_token, team, channel }
};

// ==========================================
// GitHub OAuth
// ==========================================

app.get("/auth/github", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: "http://localhost:3000/auth/github/callback",
    scope: "repo",
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get("/auth/github/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code parameter");

  try {
    // Exchange code for access token
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: process.env.GITHUB_OAUTH_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } },
    );

    const accessToken = tokenRes.data.access_token;

    // Get the authenticated user's info
    const userRes = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    connections.github = {
      access_token: accessToken,
      username: userRes.data.login,
    };

    console.log(`GitHub connected for user: ${userRes.data.login}`);
    res.redirect("/?github=connected");
  } catch (err) {
    console.error("GitHub OAuth error:", err.response?.data || err.message);
    res.status(500).send("GitHub authentication failed");
  }
});

// ==========================================
// Slack OAuth
// ==========================================

app.get("/auth/slack", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    redirect_uri: "http://localhost:3000/auth/slack/callback",
    scope: "chat:write,channels:read",
  });
  res.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
});

app.get("/auth/slack/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code parameter");

  try {
    const tokenRes = await axios.post(
      "https://slack.com/api/oauth.v2.access",
      null,
      {
        params: {
          client_id: process.env.SLACK_CLIENT_ID,
          client_secret: process.env.SLACK_CLIENT_SECRET,
          code,
          redirect_uri: "http://localhost:3000/auth/slack/callback",
        },
      },
    );

    if (!tokenRes.data.ok) {
      console.error("Slack OAuth error:", tokenRes.data.error);
      return res.status(500).send(`Slack auth failed: ${tokenRes.data.error}`);
    }

    connections.slack = {
      access_token: tokenRes.data.access_token,
      team: tokenRes.data.team?.name || "Unknown",
    };

    console.log(`Slack connected for team: ${connections.slack.team}`);
    res.redirect("/?slack=connected");
  } catch (err) {
    console.error("Slack OAuth error:", err.response?.data || err.message);
    res.status(500).send("Slack authentication failed");
  }
});

// ==========================================
// Connection status endpoint
// ==========================================

app.get("/api/status", (req, res) => {
  res.json({
    github: connections.github
      ? { connected: true, username: connections.github.username }
      : { connected: false },
    slack: connections.slack
      ? { connected: true, team: connections.slack.team }
      : { connected: false },
  });
});

// ==========================================
// Disconnect endpoints
// ==========================================

app.post("/api/disconnect/github", (req, res) => {
  connections.github = null;
  res.json({ disconnected: true });
});

app.post("/api/disconnect/slack", (req, res) => {
  connections.slack = null;
  res.json({ disconnected: true });
});

// ==========================================
// Webhook endpoint - GitHub Issues → Slack Digest
// ==========================================

app.post("/webhook/digest", async (req, res) => {
  // Validate connections
  if (!connections.github) {
    return res
      .status(400)
      .json({ error: "GitHub is not connected. Visit / to connect." });
  }
  if (!connections.slack) {
    return res
      .status(400)
      .json({ error: "Slack is not connected. Visit / to connect." });
  }

  // Get params from request body or query
  const repo = req.body.repo || req.query.repo;
  const channel = req.body.channel || req.query.channel || "new-channel";
  const labels = req.body.labels || req.query.labels || "";
  const since = req.body.since || req.query.since || "";

  if (!repo) {
    return res.status(400).json({
      error: "Missing required parameter: repo (e.g., 'owner/repo')",
      usage: {
        method: "POST",
        body: {
          repo: "owner/repo (required)",
          channel: "slack-channel-name (optional, default: new-channel)",
          labels: "bug,enhancement (optional, comma-separated)",
          since: "2026-07-01 (optional, ISO date)",
        },
      },
    });
  }

  try {
    // Step 1: Fetch open issues from GitHub
    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return res
        .status(400)
        .json({ error: "repo must be in format 'owner/repo'" });
    }

    const githubParams = { state: "open", per_page: 10 };
    if (labels) githubParams.labels = labels;
    if (since) githubParams.since = since;

    const issuesRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repoName}/issues`,
      {
        headers: { Authorization: `Bearer ${connections.github.access_token}` },
        params: githubParams,
      },
    );

    const issues = issuesRes.data;

    // Step 2: Format the digest message
    let message;
    if (issues.length === 0) {
      message = `📋 *Issue Digest for ${repo}*\n\nNo open issues found.`;
    } else {
      const issueLines = issues.map((issue) => {
        const labels = issue.labels.map((l) => l.name).join(", ");
        const labelText = labels ? ` [${labels}]` : "";
        return `• <${issue.html_url}|#${issue.number}: ${issue.title}>${labelText}`;
      });

      message =
        `📋 *Issue Digest for ${repo}*\n` +
        `Found ${issues.length} open issue${issues.length === 1 ? "" : "s"}:\n\n` +
        issueLines.join("\n");
    }

    // Step 3: Find the Slack channel ID
    const channelsRes = await axios.get(
      "https://slack.com/api/conversations.list",
      {
        headers: { Authorization: `Bearer ${connections.slack.access_token}` },
        params: { types: "public_channel", limit: 200 },
      },
    );

    const slackChannel = channelsRes.data.channels?.find(
      (c) => c.name === channel,
    );

    if (!slackChannel) {
      return res.status(400).json({
        error: `Slack channel '#${channel}' not found`,
        available_channels: channelsRes.data.channels?.map((c) => c.name) || [],
      });
    }

    // Step 4: Post to Slack
    const postRes = await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: slackChannel.id,
        text: message,
        mrkdwn: true,
      },
      {
        headers: { Authorization: `Bearer ${connections.slack.access_token}` },
      },
    );

    if (!postRes.data.ok) {
      return res.status(500).json({
        error: "Failed to post to Slack",
        slack_error: postRes.data.error,
        hint:
          postRes.data.error === "not_in_channel"
            ? `Invite the bot to #${channel} first by typing /invite @Console_Takehome in the channel`
            : undefined,
      });
    }

    // Step 5: Return summary
    res.json({
      success: true,
      summary: {
        repo,
        issues_found: issues.length,
        channel: `#${channel}`,
        message_posted: true,
        timestamp: new Date().toISOString(),
      },
      issues: issues.map((i) => ({
        number: i.number,
        title: i.title,
        url: i.html_url,
        labels: i.labels.map((l) => l.name),
        created_at: i.created_at,
      })),
    });
  } catch (err) {
    // Handle specific GitHub errors
    if (err.response?.status === 404) {
      return res.status(404).json({
        error: `Repository '${repo}' not found or not accessible`,
        hint: "Make sure the repo exists and your GitHub account has access to it",
      });
    }
    if (err.response?.status === 403) {
      return res.status(403).json({
        error: "GitHub API rate limit exceeded",
        reset_at: err.response.headers?.["x-ratelimit-reset"],
      });
    }

    console.error("Webhook error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Something went wrong",
      details: err.response?.data || err.message,
    });
  }
});

// ==========================================
// Health check
// ==========================================

const startedAt = new Date().toISOString();
let lastDigestSent = null;

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    started_at: startedAt,
    last_digest_sent: lastDigestSent,
    connections: {
      github: connections.github ? "connected" : "disconnected",
      slack: connections.slack ? "connected" : "disconnected",
    },
  });
});

// ==========================================
// Start server
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
