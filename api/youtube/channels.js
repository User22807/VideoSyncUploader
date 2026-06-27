import { readState, getChannels, setCorsHeaders } from "../../utils.js";

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "GET") {
      const state = await readState();
      if (!state.youtubeAuth.accessToken && !state.youtubeAuth.refreshToken) {
        res.status(401).json({ ok: false, error: "YouTube is not connected yet." });
        return;
      }
      const payload = await getChannels(state);
      res.status(200).json({ ok: true, channels: payload.channels });
      return;
    }
    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ ok: false, error: error.message || "Server error" });
  }
}
