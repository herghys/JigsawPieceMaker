// DB connectivity probe for page gating (welcome / editor).
// Always HTTP 200. Callers branch on the "db" flag.
import { supa, send, cors } from "./_db.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    await supa("knob_profiles?select=id&limit=0");
    return send(res, { ok: true, db: true });
  } catch {
    return send(res, { ok: false, db: false, error: "Unreachable." });
  }
}
