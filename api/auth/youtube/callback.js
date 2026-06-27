import { readState, writeState, exchangeCodeForToken, getRedirectUri, getFrontendUrl, setCorsHeaders } from "../../../utils.js";

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "GET") {
      const code = req.query.code;
      if (!code) {
        res.status(400).json({ ok: false, error: "Missing authorization code." });
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
      res.redirect(`${getFrontendUrl()}/?youtube=connected`);
      return;
    }
    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ ok: false, error: error.message || "Server error" });
  }
}
