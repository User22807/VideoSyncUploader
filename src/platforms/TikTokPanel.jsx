import React, { useState } from "react";

function InfoCard({ title, body, step }) {
  return (
    <div className="step-card tiktok-step">
      <div className="step-title">
        <strong>{step}</strong>
        <span>{title}</span>
      </div>
      <p>{body}</p>
    </div>
  );
}

export default function TikTokPanel() {
  const redirectUri = window.location.origin + "/";
  const [settings, setSettings] = useState({
    clientKey: "",
    clientSecret: "",
    redirectUri,
    accessToken: "",
  });
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("Untitled TikTok");
  const [caption, setCaption] = useState("Add a short caption and hashtags.");
  const [status, setStatus] = useState("Ready to set up TikTok.");
  const [toast, setToast] = useState("");
  const [saved, setSaved] = useState(false);

  const flash = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const saveSettings = () => {
    setSaved(true);
    setStatus("TikTok settings saved locally.");
    flash("TikTok settings saved");
  };

  const connectTikTok = () => {
    setStatus("Open TikTok Login Kit and grant posting access.");
    flash("TikTok connection started");
  };

  const uploadTikTok = () => {
    if (!file) {
      setStatus("Choose a video first.");
      return;
    }
    setStatus("TikTok upload is scaffolded here. We can wire the live API next.");
    flash("TikTok upload ready to wire");
  };

  return (
    <section className="panel youtube-panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">TikTok</p>
          <h2>TikTok connection</h2>
        </div>
        <div className="connected-app compact">
          <div>
            <strong>TikTok</strong>
            <span>{saved ? "Settings saved" : "Not connected"}</span>
          </div>
        </div>
      </div>

      {toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null}
      <p className="muted">TikTok is intentionally separate from YouTube so each platform keeps its own setup and upload flow.</p>

      <div className="step-grid single-column">
        <InfoCard step="Step 1" title="Create the app" body="Create a TikTok developer app, enable the Content Posting API, and add your redirect URI in the TikTok developer console." />
        <InfoCard step="Step 2" title="Authorize" body="Use Login Kit to get the user token and posting permission needed for the account you want to upload to." />
        <InfoCard step="Step 3" title="Choose posting mode" body="TikTok's Content Posting API supports Direct Post and Upload-to-draft flows. Pick the one that fits your review process." />
      </div>

      <div className="step-card">
        <div className="step-title">
          <strong>API settings</strong>
          <span>{status}</span>
        </div>
        <div className="settings-grid">
          <label>
            <span>Client Key</span>
            <input value={settings.clientKey} onChange={(e) => setSettings((prev) => ({ ...prev, clientKey: e.target.value }))} />
          </label>
          <label>
            <span>Client Secret</span>
            <input value={settings.clientSecret} onChange={(e) => setSettings((prev) => ({ ...prev, clientSecret: e.target.value }))} />
          </label>
          <label>
            <span>Redirect URI</span>
            <input value={settings.redirectUri} readOnly title="Auto-populated from current URL" />
          </label>
          <label>
            <span>Access Token</span>
            <input value={settings.accessToken} onChange={(e) => setSettings((prev) => ({ ...prev, accessToken: e.target.value }))} />
          </label>
        </div>
        <div className="actions">
          <button className="primary" type="button" onClick={saveSettings}>Save TikTok settings</button>
          <button className="ghost" type="button" onClick={connectTikTok}>Connect TikTok</button>
        </div>
      </div>

      <div className="step-card">
        <div className="step-title">
          <strong>Upload</strong>
          <span>{file ? file.name : "No file selected"}</span>
        </div>
        <div className="upload-grid">
          <div className="file-box">
            <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
            <button className="ghost file-button" type="button" onClick={(e) => e.currentTarget.parentElement.querySelector('input[type="file"]').click()}>Choose video</button>
            <span>Pick a TikTok video</span>
            <small>{file ? file.name : "No file selected"}</small>
          </div>
          <div className="upload-fields">
            <label>
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              <span>Caption</span>
              <textarea rows="4" value={caption} onChange={(e) => setCaption(e.target.value)} />
            </label>
            <div className="actions">
              <button className="primary" type="button" onClick={uploadTikTok}>Upload to TikTok</button>
            </div>
          </div>
        </div>
      </div>

      <p className="muted">We can wire the live TikTok upload API next once you add the app credentials and decide between direct post or draft upload.</p>
    </section>
  );
}
