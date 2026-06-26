import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE_URL = "https://videosyncuploader.onrender.com";
const apiUrl = (path) => `${API_BASE_URL}${path}`;

function formatSize(bytes) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return value.toFixed(unit === 0 ? 0 : value >= 10 ? 1 : 2) + " " + units[unit];
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.6 4.5 12 4.5 12 4.5s-5.6 0-7.5.6a3 3 0 0 0-2.1 2.1C1.8 9.1 1.8 12 1.8 12s0 2.9.6 4.8a3 3 0 0 0 2.1 2.1c1.9.6 7.5.6 7.5.6s5.6 0 7.5-.6a3 3 0 0 0 2.1-2.1c.6-1.9.6-4.8.6-4.8s0-2.9-.6-4.8ZM10.5 15.2V8.8L16 12l-5.5 3.2Z" fill="currentColor" />
    </svg>
  );
}

function ChannelIcon({ thumbnail, title }) {
  if (thumbnail) return <img src={thumbnail} alt="" />;
  return <span aria-hidden="true">{title ? title.slice(0, 1).toUpperCase() : "Y"}</span>;
}

function VideoThumb({ thumbnail, title }) {
  if (thumbnail) return <img src={thumbnail} alt="" />;
  return <span aria-hidden="true">{title ? title.slice(0, 1).toUpperCase() : "V"}</span>;
}

export default function YouTubePanel() {
  const [settings, setSettings] = useState({ clientId: "", clientSecret: "", redirectUri: "" });
  const [auth, setAuth] = useState({ connected: false, accountName: "", selectedChannelId: "", selectedChannelName: "", selectedChannelIcon: "", lastMessage: "Not connected" });
  const [channels, setChannels] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [stepOneState, setStepOneState] = useState("idle");
  const [stepTwoState, setStepTwoState] = useState("idle");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [refreshNote, setRefreshNote] = useState("Save API connection first, then fetch channels.");
  const [file, setFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState("Untitled upload");
  const [uploadPrivacy, setUploadPrivacy] = useState("private");
  const [uploadDescription, setUploadDescription] = useState("Add a short description for the upload.");
  const [uploadState, setUploadState] = useState("idle");
  const fileInputRef = useRef(null);

  const connected = Boolean(auth.connected);
  const connectedLabel = connected ? "Connected as " + (auth.accountName || "Google user") : "Disconnected";
  const activeChannel = auth.selectedChannelName || "No channel selected";
  const activeChannelIcon = auth.selectedChannelIcon || "";
  const sizeLabel = useMemo(() => formatSize(file?.size), [file]);

  const flashToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const loadState = async () => {
    const response = await fetch(apiUrl("/api/state"), { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load state");
    const data = await response.json();
    const youtube = data.settings?.youtube || {};
    setSettings({
      clientId: youtube.clientId || "",
      clientSecret: youtube.clientSecret || "",
      redirectUri: youtube.redirectUri || "",
    });
    setAuth((prev) => ({
      ...prev,
      connected: Boolean(data.youtubeAuth?.connected),
      accountName: data.youtubeAuth?.accountName || "",
      selectedChannelId: data.youtubeAuth?.selectedChannelId || "",
      selectedChannelName: data.youtubeAuth?.selectedChannelName || "",
      selectedChannelIcon: data.youtubeAuth?.selectedChannelIcon || "",
      lastMessage: data.youtubeAuth?.lastMessage || "Not connected",
    }));
    const isConnected = Boolean(data.youtubeAuth?.connected);
    if (isConnected) {
      setStepOneState("connected");
      setStepTwoState("ready");
    }
    return isConnected;
  };

  const fetchChannels = async () => {
    setLoadingChannels(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/youtube/channels"));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load channels");
      setChannels(data.channels || []);
      const selected = data.selectedChannel || data.channels?.[0] || null;
      if (selected) {
        setAuth((prev) => ({
          ...prev,
          selectedChannelId: selected.id || "",
          selectedChannelName: selected.title || "",
          selectedChannelIcon: selected.thumbnail || "",
        }));
      }
      setStepTwoState("ready");
      flashToast((data.channels || []).length ? "Channels loaded" : "No channels found");
      setRefreshNote((data.channels || []).length ? "Loaded channels from the signed-in Google account." : "No channels found for this Google account.");
      if (selected) {
        await fetchVideos(selected.id);
      }
    } catch (err) {
      setError(err.message || "Failed to load channels");
      setStepTwoState("error");
      setRefreshNote(err.message || "Failed to load channels");
    } finally {
      setLoadingChannels(false);
    }
  };

  const fetchVideos = async (channelId) => {
    setLoadingVideos(true);
    setError("");
    try {
      const response = await fetch(channelId ? apiUrl("/api/youtube/videos?channelId=" + encodeURIComponent(channelId)) : apiUrl("/api/youtube/videos"));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load uploaded videos");
      setVideos(data.videos || []);
    } catch (err) {
      setError(err.message || "Failed to load uploaded videos");
    } finally {
      setLoadingVideos(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const hadConnectedParam = params.get("youtube") === "connected";
        let isConnected = await loadState();
        if (cancelled) return;

        if (hadConnectedParam) {
          flashToast("YouTube connected successfully");
          isConnected = await loadState();
          params.delete("youtube");
          const nextUrl = params.toString() ? window.location.pathname + "?" + params.toString() : window.location.pathname;
          window.history.replaceState({}, "", nextUrl);
        }

        if (isConnected) {
          try {
            await testApiConnection();
          } catch (e) {
            console.warn("Connection re-check failed:", e && e.message ? e.message : e);
          }
          await fetchChannels();
        }
      } catch (err) {
        setError(err.message || "Failed to load saved settings");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateField = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const persistSettings = async (currentSettings) => {
    const response = await fetch(apiUrl("/api/youtube/save"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentSettings),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to save settings");
    setSettings({
      clientId: data.youtube?.clientId || "",
      clientSecret: data.youtube?.clientSecret || "",
      redirectUri: data.youtube?.redirectUri || "",
    });
    return true;
  };

  const saveConnection = async () => {
    setError("");
    setStepOneState("saving");
    try {
      await persistSettings(settings);
      setStepOneState("saved");
      flashToast("YouTube API settings saved");
    } catch (err) {
      setStepOneState("error");
      setError(err.message || "Failed to save settings");
    }
  };

  const testApiConnection = async () => {
    setError("");
    setStepOneState("testing");
    try {
      const response = await fetch(apiUrl("/api/youtube/test"), { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Connection test failed");
      setAuth((prev) => ({
        ...prev,
        connected: true,
        accountName: data.accountName || prev.accountName || "Google user",
        lastMessage: data.message || data.accountName || "Connected",
      }));
      setStepOneState("connected");
      setStepTwoState("ready");
      flashToast("API connection verified");
      await loadState();
      await fetchChannels();
    } catch (err) {
      setStepOneState("error");
      setError(err.message || "Connection test failed");
    }
  };

  const selectChannel = async (channel) => {
    setError("");
    try {
      const response = await fetch(apiUrl("/api/youtube/select-channel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: channel.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to save channel selection");
      setAuth((prev) => ({
        ...prev,
        selectedChannelId: data.selectedChannel?.id || channel.id,
        selectedChannelName: data.selectedChannel?.title || channel.title,
        selectedChannelIcon: data.selectedChannel?.thumbnail || channel.thumbnail || "",
      }));
      flashToast("Selected channel: " + channel.title);
      await fetchVideos(channel.id);
    } catch (err) {
      setError(err.message || "Failed to save channel selection");
    }
  };

  const uploadVideo = async () => {
    if (!file) {
      setError("Choose a video first");
      return;
    }
    if (!connected) {
      setError("Connect YouTube first");
      return;
    }
    setUploadState("uploading");
    try {
      const response = await fetch(apiUrl("/api/youtube/upload"), {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Title": uploadTitle,
          "X-Description": uploadDescription,
          "X-Privacy": uploadPrivacy,
          "X-File-Name": file.name,
          "X-Channel-Id": auth.selectedChannelId,
        },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Upload failed");
      setUploadState("uploaded");
      flashToast("Uploaded video: " + (data.title || uploadTitle));
      await fetchVideos(auth.selectedChannelId);
    } catch (err) {
      setUploadState("error");
      setError(err.message || "Upload failed");
    }
  };

  const deleteVideo = async (video) => {
    setError("");
    try {
      const response = await fetch(apiUrl("/api/youtube/videos/delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to delete video");
      flashToast("Removed video: " + video.title);
      await fetchVideos(auth.selectedChannelId);
    } catch (err) {
      setError(err.message || "Failed to delete video");
    }
  };

  return (
    <section className="app-shell single-panel">
      <header className="topline">
        <div>
          <p className="eyebrow">YouTube management</p>
          <h1>Unified YouTube panel</h1>
        </div>
        <div className="summary">
          <span>Status</span>
          <strong>{connectedLabel}</strong>
        </div>
      </header>

      {toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null}
      {error ? <div className="toast error" role="alert">{error}</div> : null}

      <section className="panel youtube-panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Setup</p>
            <h2>YouTube connection</h2>
          </div>
          <div className="connected-app compact">
            <span className="connected-app-icon">{activeChannelIcon ? <img src={activeChannelIcon} alt="" /> : <YouTubeIcon />}</span>
            <div>
              <strong>{auth.accountName || "YouTube"}</strong>
              <span>{connected ? "Connected" : "Not connected"}</span>
            </div>
          </div>
        </div>

        <div className="step-grid">
          <div className="step-card">
            <div className="step-title"><strong>Step 1</strong><span>{stepOneState}</span></div>
            <p>Connect the YouTube API using your saved client ID, client secret, and redirect URI.</p>
            <div className="settings-grid">
              <label><span>Client ID</span><input value={settings.clientId} onChange={(e) => updateField("clientId", e.target.value)} /></label>
              <label><span>Client Secret</span><input value={settings.clientSecret} onChange={(e) => updateField("clientSecret", e.target.value)} /></label>
              <label><span>Redirect URI</span><input value={settings.redirectUri} onChange={(e) => updateField("redirectUri", e.target.value)} /></label>
            </div>
            <div className="actions">
              <button className="primary" type="button" onClick={saveConnection}>Save API connection</button>
              <button
                className={connected ? "primary connected" : "ghost"}
                type="button"
                onClick={async () => {
                  setError("");
                  if (connected) {
                    await testApiConnection();
                    return;
                  }
                  if (!settings.clientId || !settings.clientSecret || !settings.redirectUri) {
                    setError("Fill and save your Client ID, Client Secret, and Redirect URI before connecting.");
                    return;
                  }
                  try {
                    await persistSettings(settings);
                    window.location.href = apiUrl("/auth/youtube/start");
                  } catch (err) {
                    setError(err.message || "Failed to save settings before connect.");
                  }
                }}
                style={connected ? { backgroundColor: "#2b9f4b", color: "#fff" } : {}}
              >
                {connected ? "Connected" : "Connect"}
              </button>
            </div>
            <p className="muted">{auth.lastMessage}</p>
          </div>

          <div className="step-card">
            <div className="step-title"><strong>Step 2</strong><span>{stepTwoState}</span></div>
            <p>Fetch the channels owned by the connected Google account and choose the upload target.</p>
            <div className="actions">
              <button className="primary" type="button" onClick={fetchChannels} disabled={!connected || loadingChannels}>
                {loadingChannels ? "Loading channels..." : "Fetch channels"}
              </button>
            </div>
            <p className="muted">{refreshNote}</p>
            <div className="channel-list">
              {channels.map((channel) => {
                const selected = channel.id === auth.selectedChannelId;
                return (
                  <button className={"channel-row" + (selected ? " selected" : "")} key={channel.id} type="button" onClick={() => selectChannel(channel)}>
                    <span className="channel-avatar"><ChannelIcon thumbnail={channel.thumbnail} title={channel.title} /></span>
                    <span className="channel-copy"><strong>{channel.title}</strong><small>{channel.id}</small></span>
                    <span className="channel-state">{selected ? "Selected" : "Pick"}</span>
                  </button>
                );
              })}
            </div>
            {!loadingChannels && channels.length === 0 ? <div className="empty-chip">No channels loaded yet.</div> : null}
          </div>
        </div>

        <div className="step-card">
          <div className="step-title"><strong>Uploaded videos</strong><span>{loadingVideos ? "loading" : String(videos.length)}</span></div>
          <p>Use the selected channel to upload new videos, then remove any upload from the list when needed.</p>
          <div className="upload-grid">
            <div className="file-box">
              <input ref={fileInputRef} type="file" accept="video/*" onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
              <button className="ghost file-button" type="button" onClick={() => fileInputRef.current?.click()}>Choose video</button>
              <span>Pick a video file</span>
              <small>{file ? file.name : "No file selected"}</small>
              <small>{sizeLabel}</small>
            </div>
            <div className="upload-fields">
              <label><span>Title</span><input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} /></label>
              <label><span>Privacy</span><select value={uploadPrivacy} onChange={(e) => setUploadPrivacy(e.target.value)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
              <label><span>Description</span><textarea rows="4" value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} /></label>
              <div className="actions">
                <button className="primary" type="button" onClick={uploadVideo} disabled={!connected || uploadState === "uploading"}>{uploadState === "uploading" ? "Uploading..." : "Add video"}</button>
              </div>
            </div>
          </div>
          <div className="video-list">
            {videos.map((video) => (
              <div className="video-row" key={video.id}>
                <span className="video-thumb"><VideoThumb thumbnail={video.thumbnail} title={video.title} /></span>
                <span className="video-copy">
                  <strong>{video.title}</strong>
                  <small>{video.publishedAt || video.id}</small>
                </span>
                <button className="ghost tiny" type="button" onClick={() => deleteVideo(video)}>Remove</button>
              </div>
            ))}
          </div>
          {!loadingVideos && videos.length === 0 ? <div className="empty-chip">No uploaded videos loaded yet.</div> : null}
        </div>

        <div className="status-strip">
          <div><span>Saved channel</span><strong>{activeChannel}</strong></div>
          <div><span>Connected app</span><strong>YouTube</strong></div>
          <div><span>Saved settings</span><strong>{settings.clientId ? "Present" : "Missing"}</strong></div>
        </div>
      </section>
    </section>
  );
}
