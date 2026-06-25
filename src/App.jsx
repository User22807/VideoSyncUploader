import React, { useState } from "react";
import YouTubePanel from "./platforms/YouTubePanel";
import TikTokPanel from "./platforms/TikTokPanel";

const platforms = [
  { key: "youtube", label: "YouTube", hint: "Existing upload flow" },
  { key: "tiktok", label: "TikTok", hint: "Separate posting flow" },
];

export default function App() {
  const [platform, setPlatform] = useState("youtube");

  return (
    <main className="app-shell single-panel">
      <header className="topline">
        <div>
          <p className="eyebrow">Video publisher</p>
          <h1>Choose platform</h1>
        </div>
      </header>

      <div className="platform-tabs" role="tablist" aria-label="Publishing platforms">
        {platforms.map((item) => (
          <button
            key={item.key}
            type="button"
            className={"platform-tab" + (platform === item.key ? " active" : "")}
            onClick={() => setPlatform(item.key)}
          >
            <strong>{item.label}</strong>
            <span>{item.hint}</span>
          </button>
        ))}
      </div>

      {platform === "youtube" ? <YouTubePanel /> : <TikTokPanel />}
    </main>
  );
}
