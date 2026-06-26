import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const PORT = process.env.PORT || 8787;
const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const emptyState = {
  activePlatform: "youtube",
  settings: {
    youtube: {
      clientId: "",
      clientSecret: "",
      redirectUri: "http://localhost:8787/auth/youtube/callback",
      channelName: "",
    },
  },
  youtubeAuth: {
    connected: false,
    accountName: "",
    accessToken: "",
    refreshToken: "",
    expiryDate: null,
    lastTest: null,
    lastMessage: "Not connected",
    selectedChannelId: "",
    selectedChannelName: "",
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
      ...emptyState.settings,
      ...(parsed.settings || {}),
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Title, X-Description, X-Privacy, X-File-Name, X-Channel-Id");
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
  url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl");
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
  const nextState = await readState();
  const refreshToken = nextState.youtubeAuth.refreshToken;
  const clientId = nextState.settings.youtube.clientId;
  const clientSecret = nextState.settings.youtube.clientSecret;
  if (!refreshToken) {
    const error = new Error("Connect YouTube first, then test the saved account.");
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
    ...nextState,
    youtubeAuth: {
      ...nextState.youtubeAuth,
      connected: true,
      accessToken: payload.access_token,
      expiryDate: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : nextState.youtubeAuth.expiryDate,
      lastMessage: "OAuth token refreshed",
    },
  };
  await writeState(updatedState);
  return { accessToken: payload.access_token, state: updatedState };
}

async function ensureAccessToken(state) {
  const nextState = await readState();
  const auth = nextState.youtubeAuth;
  const expiresAt = auth.expiryDate ? new Date(auth.expiryDate).getTime() : 0;
  const expired = expiresAt ? Date.now() >= expiresAt - 60000 : false;
  if (!auth.accessToken || expired) {
    return refreshAccessToken(nextState);
  }
  return { accessToken: auth.accessToken, state: nextState };
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
    return { response: retry, payload: retryPayload, state: refreshed.state };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error_description || "YouTube request failed");
  return { response, payload, state: tokenResult.state };
}
async function getChannels(state) {
  const { payload, state: nextState } = await youtubeRequest(state, "https://www.googleapis.com/youtube/v3/channels?part=snippet%2CcontentDetails&mine=true&maxResults=50");

  const channels = (payload.items || []).map((item) => ({
    id: item.id,
    title: item.snippet?.title || "Untitled channel",
    thumbnail:
      item.snippet?.thumbnails?.default?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.high?.url ||
      "",
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || "",
  }));

  const selectedId = nextState.youtubeAuth.selectedChannelId;
  const selectedChannel = channels.find((channel) => channel.id === selectedId) || channels[0] || null;
  if (selectedChannel && selectedChannel.id !== selectedId) {
    const updatedState = {
      ...nextState,
      youtubeAuth: {
        ...nextState.youtubeAuth,
        selectedChannelId: selectedChannel.id,
        selectedChannelName: selectedChannel.title,
      },
    };
    await writeState(updatedState);
    return { channels, selectedChannel, state: updatedState };
  }

  return { channels, selectedChannel, state: nextState };
}
async function getSelectedChannelInfo(state) {
  return getChannels(state);
}
async function getUploadedVideos(state, channelId) {
  const payload = await getSelectedChannelInfo(state);
  const channel = channelId ? payload.channels.find((item) => item.id === channelId) : payload.selectedChannel;
  if (!channel || !channel.uploadsPlaylistId) {
    return { videos: [], channel: channel || null };
  }
  const result = await youtubeRequest(payload.state, "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=" + encodeURIComponent(channel.uploadsPlaylistId) + "&maxResults=25");
  const data = result.payload;
  const videos = (data.items || []).map((item) => ({
    id: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || item.id,
    title: item.snippet?.title || "Untitled video",
    publishedAt: item.snippet?.publishedAt || "",
    thumbnail:
      item.snippet?.thumbnails?.default?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.high?.url ||
      "",
  }));
  return { videos, channel };
}
async function deleteYoutubeVideo(state, videoId) {
  const tokenResult = await ensureAccessToken(state);
  const doDelete = async (accessToken) => {
    const response = await fetch("https://www.googleapis.com/youtube/v3/videos?id=" + encodeURIComponent(videoId), {
      method: "DELETE",
      headers: { Authorization: "Bearer " + accessToken },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || data.error_description || "Failed to delete video");
    }
  };

  try {
    await doDelete(tokenResult.accessToken);
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes("401")) {
      const refreshed = await refreshAccessToken(tokenResult.state);
      await doDelete(refreshed.accessToken);
      return;
    }
    throw error;
  }
}
async function uploadYoutubeVideo(state, { fileBuffer, contentType, title, description, privacy, fileName, channelId }) {
  const tokenResult = await ensureAccessToken(state);
  const boundary = "codexBoundary" + Date.now();
  const metadata = {
    snippet: {
      title: title || fileName || "Untitled upload",
      description: description || "",
      categoryId: "22",
    },
    status: { privacyStatus: privacy || "private" },
  };
  const prefix = Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + "\r\n--" + boundary + "\r\nContent-Type: " + (contentType || "application/octet-stream") + "\r\n\r\n");
  const suffix = Buffer.from("\r\n--" + boundary + "--");
  const body = Buffer.concat([prefix, fileBuffer, suffix]);
  const uploadUrl = "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart";
  const doUpload = async (accessToken) => {
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "multipart/related; boundary=" + boundary,
      },
      body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || data.error_description || "Upload failed");
    return data;
  };

  try {
    const data = await doUpload(tokenResult.accessToken);
    return {
      videoId: data.id,
      title: data.snippet?.title || metadata.snippet.title,
      videoUrl: data.id ? "https://www.youtube.com/watch?v=" + data.id : "",
      channelId,
    };
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes("401")) {
      const refreshed = await refreshAccessToken(tokenResult.state);
      const data = await doUpload(refreshed.accessToken);
      return {
        videoId: data.id,
        title: data.snippet?.title || metadata.snippet.title,
        videoUrl: data.id ? "https://www.youtube.com/watch?v=" + data.id : "",
        channelId,
      };
    }
    throw error;
  }
}
async function testYoutubeConnection(youtubeSettings, youtubeAuth) {
  const state = await readState();
  const result = await youtubeRequest(state, "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
  return result.payload.items?.[0]?.snippet?.title || youtubeSettings.channelName || "Connected channel";
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

    if (req.method === "GET" && url.pathname === "/api/youtube/channels") {
      const state = await readState();
      const payload = await getChannels(state);
      sendJson(res, 200, {
        ok: true,
        channels: payload.channels,
        selectedChannel: payload.selectedChannel,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/youtube/videos") {
      const state = await readState();
      const channelId = url.searchParams.get("channelId") || state.youtubeAuth.selectedChannelId || "";
      const payload = await getUploadedVideos(state, channelId);
      sendJson(res, 200, { ok: true, videos: payload.videos, channelId: payload.channel?.id || channelId });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/youtube/select-channel") {
      const state = await readState();
      const body = await readBody(req);
      const { channels } = await getChannels(state);
      const selected = channels.find((channel) => channel.id === body.channelId);
      if (!selected) {
        sendJson(res, 404, { ok: false, error: "Channel not found" });
        return;
      }
      const nextState = {
        ...state,
        youtubeAuth: {
          ...state.youtubeAuth,
          selectedChannelId: selected.id,
          selectedChannelName: selected.title,
        },
      };
      await writeState(nextState);
      sendJson(res, 200, { ok: true, selectedChannel: selected });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/youtube/videos/delete") {
      const state = await readState();
      const body = await readBody(req);
      if (!body.videoId) {
        sendJson(res, 400, { ok: false, error: "Missing videoId" });
        return;
      }
      await deleteYoutubeVideo(state, body.videoId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/youtube/upload") {
      const state = await readState();
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const fileBuffer = Buffer.concat(chunks);
      const uploaded = await uploadYoutubeVideo(state, {
        fileBuffer,
        contentType: req.headers["content-type"],
        title: req.headers["x-title"],
        description: req.headers["x-description"],
        privacy: req.headers["x-privacy"],
        fileName: req.headers["x-file-name"],
        channelId: req.headers["x-channel-id"],
      });
      sendJson(res, 200, { ok: true, ...uploaded });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/youtube/save") {
      const state = await readState();
      const body = await readBody(req);
      const nextState = {
        ...state,
        settings: {
          ...state.settings,
          youtube: {
            ...state.settings.youtube,
            ...body,
          },
        },
      };
      await writeState(nextState);
      sendJson(res, 200, { ok: true, youtube: nextState.settings.youtube });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/youtube/test") {
      const state = await readState();
      const channelName = await testYoutubeConnection(state.settings.youtube, state.youtubeAuth);
      const nextState = {
        ...state,
        youtubeAuth: {
          ...state.youtubeAuth,
          connected: true,
          accountName: channelName,
          lastTest: new Date().toISOString(),
          lastMessage: `Connected to ${channelName}`,
        },
      };
      await writeState(nextState);
      sendJson(res, 200, { ok: true, accountName: channelName, message: nextState.youtubeAuth.lastMessage });
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
          accountName: state.settings.youtube.channelName || "YouTube channel",
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || state.youtubeAuth.refreshToken,
          expiryDate: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null,
          lastTest: new Date().toISOString(),
          lastMessage: "OAuth connected",
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

