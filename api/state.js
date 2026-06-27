import { readState, setCorsHeaders } from "../utils.js";

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "GET") {
      const state = await readState();
      res.status(200).json(state);
      return;
    }
    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ ok: false, error: error.message || "Server error" });
  }
}
