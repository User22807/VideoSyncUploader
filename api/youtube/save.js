import { readState, writeState, readBody, setCorsHeaders } from "../../utils.js";

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "POST") {
      const body = await readBody(req);
      const current = await readState();
      const nextState = {
        ...current,
        settings: {
          youtube: {
            ...current.settings.youtube,
            ...body,
          },
        },
      };
      await writeState(nextState);
      res.status(200).json({ ok: true, youtube: nextState.settings.youtube });
      return;
    }
    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ ok: false, error: error.message || "Server error" });
  }
}
