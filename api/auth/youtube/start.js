import { readState, buildGoogleAuthUrl, getRedirectUri, setCorsHeaders } from "../../../utils.js";

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "GET") {
      const state = await readState();
      const redirectUri = getRedirectUri(req);
      const { clientId } = state.settings.youtube;
      if (!clientId) {
        res.status(400).json({ ok: false, error: "Missing YouTube client ID." });
        return;
      }
      const authUrl = buildGoogleAuthUrl({ clientId, redirectUri });
      res.redirect(authUrl);
      return;
    }
    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ ok: false, error: error.message || "Server error" });
  }
}
