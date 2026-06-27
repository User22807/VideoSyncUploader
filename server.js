import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import admin from "firebase-admin";

const PORT = process.env.PORT || 8787;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Initialize Firebase if credentials are available
let db = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    console.log("Firebase initialized");
  } catch (e) {
    console.error("Failed to initialize Firebase:", e.message);
  }
}

const emptyState = {
  settings: {
    youtube: {
      clientId: "",
      clientSecret: "",
      redirectUri: "",
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

function getRedirectUri(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:8787";
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}/auth/youtube/callback`;
}

function getFrontendUrl() {
  return FRONTEND_URL;
}

async function readState() {
  if (!db) {
    return emptyState;
  }
  try {
    const doc = await db.collection("youtube").doc("config").get();
    if (!doc.exists) {
      return emptyState;
    }
    const data = doc.data();
    return {
      settings: {
        youtube: {
          clientId: data.clientId || "",
          clientSecret: data.clientSecret || "",
          redirectUri: data.redirectUri || "",
        },
      },
      youtubeAuth: {
        connected: Boolean(data.connected),
        accountName: data.accountName || "",
        accessToken: data.accessToken || "",
        refreshToken: data.refreshToken || "",
        expiryDate: data.expiryDate || null,
        lastMessage: data.lastMessage || "Not connected",
      },
    };
  } catch (error) {
    console.error("Error reading state:", error.message);
    return emptyState;
  }
}

async function writeState(state) {
  if (!db) {
    console.warn("Firebase not available, state not persisted");
    return;
  }
  try {
    await db.collection("youtube").doc("config").set({
      clientId: state.settings.youtube.clientId,
      clientSecret: state.settings.youtube.clientSecret,
      redirectUri: state.settings.youtube.redirectUri,
      connected: state.youtubeAuth.connected,
      accountName: state.youtubeAuth.accountName,
      accessToken: state.youtubeAuth.accessToken,
      refreshToken: state.youtubeAuth.refreshToken,
      expiryDate: state.youtubeAuth.expiryDate,
      lastMessage: state.youtubeAuth.lastMessage,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error writing state:", error.message);
  }
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
  setCorsHeaders(res);
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
      const redirectUri = getRedirectUri(req);
      const { clientId } = state.settings.youtube;
      if (!clientId) {
        sendJson(res, 400, { ok: false, error: "Missing YouTube client ID." });
        return;
      }
      redirect(res, buildGoogleAuthUrl({ clientId, redirectUri }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/youtube/callback") {
      const code = url.searchParams.get("code");
      if (!code) {
        sendJson(res, 400, { ok: false, error: "Missing authorization code." });
        return;
      }

      const state = await readState();
      const redirectUri = getRedirectUri(req);
      const tokenData = await exchangeCodeForToken({
        clientId: state.settings.youtube.clientId,
        clientSecret: state.settings.youtube.clientSecret,
        redirectUri,
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
      redirect(res, `${getFrontendUrl()}/?youtube=connected`);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error("Error:", error.message);
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, { ok: false, error: error.message || "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`API server listening on http://0.0.0.0:${PORT}`);
});
