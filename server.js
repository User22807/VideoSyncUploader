import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const PORT = process.env.PORT || 8787;
const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const emptyState = {
  settings: {
    youtube: {
      clientId: "",
      clientSecret: "",
      redirectUri: "http://localhost:8787/auth/youtube/callback",
    },
  },
  youtubeAuth: {
    connected: false,
    accountName: "",
    accessToken: "",
    refreshToken: "",
    expiryDate: null,
    lastMessage: "Not connected",
  },
};

async function ensureStateFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STATE_FILE);
  } catch {
    await fs.writeFile(STATE_FILE, JSON.stringify(emptyState, null, 2), "utf8");
  }
}

async function readState() {
  await ensureStateFile();
  const raw = await fs.readFile(STATE_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...emptyState,
    ...parsed,
    settings: {
      youtube: {
        ...emptyState.settings.youtube,
        ...(parsed.settings?.youtube || {}),
      },
    },
    youtubeAuth: {
      ...emptyState.youtubeAuth,
      ...(parsed.youtubeAuth || {}),
    },
  };
}

async function writeState(state) {
  await ensureStateFile();
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function sendJson(res, status, data) {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function buildGoogleAuthUrl({ clientId, redirectUri }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, code }) {
  const body = new URLSearchParams();
  body.set("code", code);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("redirect_uri", redirectUri);
  body.set("grant_type", "authorization_code");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || "Token exchange failed");
  return payload;
}

async function refreshAccessToken(state) {
  const refreshToken = state.youtubeAuth.refreshToken;
  const clientId = state.settings.youtube.clientId;
  const clientSecret = state.settings.youtube.clientSecret;
  if (!refreshToken) {
    const error = new Error("You must connect YouTube before refreshing tokens.");
    error.statusCode = 400;
    throw error;
  }
  if (!clientId || !clientSecret) {
    const error = new Error("Missing YouTube client credentials.");
    error.statusCode = 400;
    throw error;
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || "Token refresh failed");

  const updatedState = {
    ...state,
    youtubeAuth: {
      ...state.youtubeAuth,
      connected: true,
      accessToken: payload.access_token,
      expiryDate: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : state.youtubeAuth.expiryDate,
      lastMessage: "Access token refreshed",
    },
  };
  await writeState(updatedState);
  return { accessToken: payload.access_token, state: updatedState };
}

async function ensureAccessToken(state) {
  const expiresAt = state.youtubeAuth.expiryDate ? new Date(state.youtubeAuth.expiryDate).getTime() : 0;
  const expired = expiresAt ? Date.now() >= expiresAt - 60000 : false;
  if (!state.youtubeAuth.accessToken || expired) {
    return refreshAccessToken(state);
  }
  return { accessToken: state.youtubeAuth.accessToken, state };
}

async function youtubeRequest(state, url, options = {}) {
  const tokenResult = await ensureAccessToken(state);
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: "Bearer " + tokenResult.accessToken,
    },
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken(tokenResult.state);
    const retry = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: "Bearer " + refreshed.accessToken,
      },
    });
    const retryPayload = await retry.json().catch(() => ({}));
    if (!retry.ok) throw new Error(retryPayload.error?.message || retryPayload.error_description || "YouTube request failed");
    return { payload: retryPayload, state: refreshed.state };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error_description || "YouTube request failed");
  return { payload, state: tokenResult.state };
}

async function getChannels(state) {
  const result = await youtubeRequest(state, "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50");
  const channels = (result.payload.items || []).map((item) => ({
    id: item.id,
    title: item.snippet?.title || "Untitled channel",
    thumbnail:
      item.snippet?.thumbnails?.default?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.high?.url ||
      "",
  }));
  return { channels, state: result.state };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      const state = await readState();
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/youtube/save") {
      const body = await readBody(req);
      const current = await readState();
      const nextState = {
        ...current,
        settings: {
          youtube: {
            ...current.settings.youtube,
            ...body,
          },
        },
      };
      await writeState(nextState);
      sendJson(res, 200, { ok: true, youtube: nextState.settings.youtube });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/youtube/channels") {
      const state = await readState();
      if (!state.youtubeAuth.accessToken && !state.youtubeAuth.refreshToken) {
        sendJson(res, 401, { ok: false, error: "YouTube is not connected yet." });
        return;
      }
      const payload = await getChannels(state);
      sendJson(res, 200, { ok: true, channels: payload.channels });
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/youtube/start") {
      const state = await readState();
      const { clientId, redirectUri } = state.settings.youtube;
      if (!clientId || !redirectUri) {
        sendText(res, 400, "Missing YouTube client ID or redirect URI.");
        return;
      }
      redirect(res, buildGoogleAuthUrl({ clientId, redirectUri }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/youtube/callback") {
      const code = url.searchParams.get("code");
      if (!code) {
        sendText(res, 400, "Missing authorization code.");
        return;
      }

      const state = await readState();
      const tokenData = await exchangeCodeForToken({
        clientId: state.settings.youtube.clientId,
        clientSecret: state.settings.youtube.clientSecret,
        redirectUri: state.settings.youtube.redirectUri,
        code,
      });

      const nextState = {
        ...state,
        youtubeAuth: {
          connected: true,
          accountName: "YouTube account",
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || state.youtubeAuth.refreshToken,
          expiryDate: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null,
          lastMessage: "Connected to YouTube",
        },
      };
      await writeState(nextState);
      redirect(res, "http://localhost:5173/?youtube=connected");
      return;
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, { ok: false, error: error.message || "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`API server listening on http://0.0.0.0:${PORT}`);
});
