import admin from "firebase-admin";

let db = null;

export function initFirebase() {
  if (db) return db;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      }
      db = admin.firestore();
    } catch (e) {
      console.error("Failed to initialize Firebase:", e.message);
    }
  }
  return db;
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

export async function readState() {
  const firestore = initFirebase();
  if (!firestore) {
    return emptyState;
  }
  try {
    const doc = await firestore.collection("youtube").doc("config").get();
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

export async function writeState(state) {
  const firestore = initFirebase();
  if (!firestore) {
    console.warn("Firebase not available, state not persisted");
    return;
  }
  try {
    await firestore.collection("youtube").doc("config").set({
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

export function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

export function getRedirectUri(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:8787";
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}/api/auth/youtube/callback`;
}

export function getFrontendUrl() {
  return process.env.FRONTEND_URL || "http://localhost:5173";
}

export async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function buildGoogleAuthUrl({ clientId, redirectUri }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, code }) {
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

export async function refreshAccessToken(state) {
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

export async function ensureAccessToken(state) {
  const expiresAt = state.youtubeAuth.expiryDate ? new Date(state.youtubeAuth.expiryDate).getTime() : 0;
  const expired = expiresAt ? Date.now() >= expiresAt - 60000 : false;
  if (!state.youtubeAuth.accessToken || expired) {
    return refreshAccessToken(state);
  }
  return { accessToken: state.youtubeAuth.accessToken, state };
}

export async function youtubeRequest(state, url, options = {}) {
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

export async function getChannels(state) {
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
