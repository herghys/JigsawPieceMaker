// Server-only Supabase helper for the Vercel API layer.
// Uses the service key from process.env, which never ships to the browser.
// Zero dependencies: plain fetch against PostgREST (Node 18+).

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

function needEnv() {
  if (!URL || !KEY) {
    const e = new Error("Server misconfigured: SUPABASE_URL / SUPABASE_SERVICE_KEY missing.");
    e.status = 500;
    throw e;
  }
}

export async function supa(path, { method = "GET", body } = {}) {
  needEnv();
  const headers = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };
  if (method === "POST" || method === "PATCH") {
    headers.Prefer = "return=representation";
  }
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = new Error((json && json.message) || `Supabase HTTP ${res.status}`);
    // unique violations (23505) surface as 409 from PostgREST
    e.status = res.status === 409 ? 409 : 502;
    throw e;
  }
  return json;
}

export function rowToProfile(r) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description || "",
    controlPoints: r.control_points,
    isBuiltin: !!r.is_builtin,
  };
}

export function send(res, data, code = 200) {
  res.status(code).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

// Open CORS: the API serves the GitHub Pages site, the Vercel mirror,
// and localhost dev. No cookies involved, so "*" is safe.
export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
