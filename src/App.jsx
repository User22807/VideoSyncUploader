import React, { useEffect, useState } from "react";

function App() {
  const [settings, setSettings] = useState({ clientId: "", clientSecret: "" });
  const [youtubeAuth, setYoutubeAuth] = useState({ connected: false, accountName: "", lastMessage: "Not connected" });
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Enter your YouTube OAuth credentials and connect.");

  useEffect(() => {
    loadState();
  }, []);

  const loadState = async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const data = await response.json();
      const youtube = data.settings?.youtube || {};
      setSettings({
        clientId: youtube.clientId || "",
        clientSecret: youtube.clientSecret || "",
      });
      setYoutubeAuth({
        connected: Boolean(data.youtubeAuth?.connected),
        accountName: data.youtubeAuth?.accountName || "",
        lastMessage: data.youtubeAuth?.lastMessage || "Not connected",
      });
      if (new URLSearchParams(window.location.search).get("youtube") === "connected") {
        setStatus("YouTube connected successfully.");
        window.history.replaceState({}, "", window.location.pathname);
      }
      if (data.youtubeAuth?.connected) {
        await loadChannels();
      }
    } catch (err) {
      setError(err.message || "Failed to load state");
    }
  };

  const saveSettings = async () => {
    setError("");
    if (!settings.clientId || !settings.clientSecret) {
      setError("Both Client ID and Client Secret are required.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/youtube/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to save settings");
      setStatus("YouTube credentials saved. Click Connect to authorize.");
    } catch (err) {
      setError(err.message || "Unable to save settings");
    } finally {
      setSaving(false);
    }
  };

  const connectYouTube = () => {
    window.location.href = "/api/auth/youtube/start";
  };

  const loadChannels = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/youtube/channels");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load channels");
      setChannels(result.channels || []);
      setStatus(result.channels?.length ? "Channels loaded." : "Connected but no channels found.");
    } catch (err) {
      setError(err.message || "Failed to load channels");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topline">
        <div>
          <p className="eyebrow">YouTube uploader</p>
          <h1>Connect to YouTube</h1>
          <p className="muted">Enter your OAuth credentials, connect, and load your channels.</p>
        </div>
        <div className="summary">
          <strong>{youtubeAuth.connected ? "Connected" : "Disconnected"}</strong>
          <span>{youtubeAuth.connected ? youtubeAuth.lastMessage : status}</span>
        </div>
      </header>

      {error ? <div className="toast error">{error}</div> : null}

      <section className="panel">
        <div className="step-title">
          <strong>Step 1</strong>
          <span>Configure OAuth</span>
        </div>
        <div className="settings-grid">
          <label>
            <span>Client ID</span>
            <input
              value={settings.clientId}
              onChange={(event) => setSettings((prev) => ({ ...prev, clientId: event.target.value }))}
              placeholder="Paste your OAuth client ID"
            />
          </label>
          <label>
            <span>Client Secret</span>
            <input
              type="password"
              value={settings.clientSecret}
              onChange={(event) => setSettings((prev) => ({ ...prev, clientSecret: event.target.value }))}
              placeholder="Paste your OAuth client secret"
            />
          </label>
        </div>
        <div className="actions">
          <button className="primary" type="button" onClick={saveSettings} disabled={saving}>
            {saving ? "Saving..." : "Save credentials"}
          </button>
          <button className="ghost" type="button" onClick={connectYouTube}>
            Connect to YouTube
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="step-title">
          <strong>Step 2</strong>
          <span>View channels</span>
        </div>
        <div className="actions">
          <button className="primary" type="button" onClick={loadChannels} disabled={loading || !youtubeAuth.connected}>
            {loading ? "Loading channels..." : "Refresh channels"}
          </button>
        </div>

        {channels.length ? (
          <div className="channel-list">
            {channels.map((channel) => (
              <div key={channel.id} className="channel-row">
                <div className="channel-avatar">
                  {channel.thumbnail ? <img src={channel.thumbnail} alt="Channel thumbnail" /> : <span>Y</span>}
                </div>
                <div className="channel-copy">
                  <strong>{channel.title}</strong>
                  <small>{channel.id}</small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-chip">No channels loaded yet.</div>
        )}
      </section>
    </main>
  );
}

export default App;
