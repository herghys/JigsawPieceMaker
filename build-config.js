"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "assets", "js", "config.js");

function parseDotEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && ((val[0] === '"' && val[val.length - 1] === '"') ||
        (val[0] === "'" && val[val.length - 1] === "'"))) {
      val = val.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = val;
  }
  return out;
}

function loadOptional(name) {
  try {
    return parseDotEnv(fs.readFileSync(path.join(ROOT, name), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return {};
  }
}

function jsString(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
}

const env = Object.assign({}, loadOptional(".env"), loadOptional(".env.local"), process.env);
let mode = String(env.JIGSAW_ENV || "development").toLowerCase();
if (mode !== "production" && mode !== "development") {
  mode = "development";
}
const supaUrl = String(env.JIGSAW_SUPABASE_URL || "").trim().replace(/\/$/, "");
const supaKey = String(env.JIGSAW_SUPABASE_ANON_KEY || "").trim();
const apiBase = String(env.JIGSAW_API_BASE || "").trim().replace(/\/$/, "");

const content =
  "window.JIGSAW_ENV = " + jsString(mode) + ";\n" +
  "window.JIGSAW_SUPABASE_URL = " + jsString(supaUrl) + ";\n" +
  "window.JIGSAW_SUPABASE_ANON_KEY = " + jsString(supaKey) + ";\n" +
  "window.JIGSAW_API_BASE = " + jsString(apiBase) + ";\n";

fs.writeFileSync(OUT, content);
