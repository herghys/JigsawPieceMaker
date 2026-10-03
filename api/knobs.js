// Knob catalog API (Vercel serverless). Same contract as the old PHP API.
//   GET  ?action=list | get&id=
//   POST ?action=create {name, slug?, description?, control_points}
//   POST ?action=update {id, name?, description?, control_points?}
//   POST ?action=delete {id}
// Writes land in knob_requests as PENDING (the "Request Save to db" model).
// Approval copies them into knob_profiles (see db_schema/schema.sql).

import { supa, rowToProfile, send, cors } from "./_db.js";

/** Anchor rules: 3+ numeric [x,y] pairs, first [0,0], last [1,0]. */
function validPoints(cp) {
  if (!Array.isArray(cp) || cp.length < 3) return "Need at least 3 control points.";
  for (const p of cp) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) {
      return "Each control point must be [x, y] numbers.";
    }
  }
  if (Math.abs(cp[0][0]) > 0.001 || Math.abs(cp[0][1]) > 0.001) return "First point must be [0, 0].";
  const last = cp[cp.length - 1];
  if (Math.abs(last[0] - 1) > 0.001 || Math.abs(last[1]) > 0.001) return "Last point must be [1, 0].";
  return null;
}

function validSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9_]{2,32}$/.test(slug)
    ? null
    : "Slug must be 2-32 chars: lowercase letters, digits, underscore.";
}

async function liveProfile(id) {
  const rows = await supa(`knob_profiles?select=*&id=eq.${encodeURIComponent(id)}`);
  return rows && rows[0];
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const action = (req.query && req.query.action) || "list";

  try {
    if (req.method === "GET" && action === "status") {
      await supa("knob_profiles?select=id&limit=0");
      return send(res, { ok: true, db: true });
    }

    if (req.method === "GET" && action === "list") {
      const rows = await supa("knob_profiles?select=*&order=is_builtin.desc&order=id.asc");
      return send(res, { ok: true, data: rows.map(rowToProfile) });
    }

    if (req.method === "GET" && action === "get") {
      const row = await liveProfile(req.query.id);
      if (!row) return send(res, { ok: false, error: "Not found." }, 404);
      return send(res, { ok: true, data: rowToProfile(row) });
    }

    if (req.method === "POST" && action === "create") {
      const { name = "", slug: rawSlug, description = "", control_points } = req.body || {};
      const cleanName = String(name).trim();
      if (!cleanName || cleanName.length > 80) {
        return send(res, { ok: false, error: "Name is required (max 80 chars)." }, 422);
      }
      const slug = String(rawSlug || cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
      const slugErr = validSlug(slug);
      if (slugErr) return send(res, { ok: false, error: slugErr }, 422);
      const ptsErr = validPoints(control_points);
      if (ptsErr) return send(res, { ok: false, error: ptsErr }, 422);
      const rows = await supa("knob_requests", {
        method: "POST",
        body: {
          kind: "create", slug, name: cleanName,
          description: String(description).slice(0, 255),
          control_points,
        },
      });
      const r = rows[0];
      return send(res, {
        ok: true,
        pending: true,
        data: { id: r.id, slug: r.slug, name: r.name, description: r.description || "", controlPoints: r.control_points, isBuiltin: false },
      }, 201);
    }

    if (req.method === "POST" && action === "update") {
      const { id, name, description, control_points } = req.body || {};
      const row = await liveProfile(id);
      if (!row) return send(res, { ok: false, error: "Not found." }, 404);
      const patch = { kind: "update", profile_id: row.id };
      if (name !== undefined) {
        const cleanName = String(name).trim();
        if (!cleanName || cleanName.length > 80) {
          return send(res, { ok: false, error: "Name is required (max 80 chars)." }, 422);
        }
        patch.name = cleanName;
      }
      if (description !== undefined) patch.description = String(description).slice(0, 255);
      if (control_points !== undefined) {
        const ptsErr = validPoints(control_points);
        if (ptsErr) return send(res, { ok: false, error: ptsErr }, 422);
        patch.control_points = control_points;
      }
      if (!patch.name && patch.description === undefined && patch.control_points === undefined) {
        return send(res, { ok: false, error: "Nothing to update." }, 422);
      }
      const rows = await supa("knob_requests", { method: "POST", body: patch });
      const r = rows[0];
      return send(res, {
        ok: true,
        pending: true,
        data: { id: r.id, slug: row.slug, name: r.name || row.name, description: r.description ?? row.description, controlPoints: r.control_points || row.control_points, isBuiltin: !!row.is_builtin },
      });
    }

    if (req.method === "POST" && action === "delete") {
      const { id } = req.body || {};
      const row = await liveProfile(id);
      if (!row) return send(res, { ok: false, error: "Not found." }, 404);
      if (row.is_builtin) return send(res, { ok: false, error: "Built-in profiles cannot be deleted." }, 403);
      await supa("knob_requests", { method: "POST", body: { kind: "delete", profile_id: row.id } });
      return send(res, { ok: true, pending: true, data: { id: row.id } });
    }

    return send(res, { ok: false, error: "Unknown action." }, 404);
  } catch (e) {
    return send(res, { ok: false, error: e.message || "Server error." }, e.status || 500);
  }
}
