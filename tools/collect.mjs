#!/usr/bin/env node
/* RainScore Lab — daily server-side collector (run by .github/workflows/rainscore-collect.yml).

   Fetches, for every seed orchard, exactly what the app fetches by hand:
     • forecasts: Open-Meteo Previous Runs, precipitation_previous_day1, all six models
       (one multi-model request per orchard — verified identical to six single requests)
     • actuals:   ERA5 archive, pinned models=era5, hourly
   and applies the SAME honesty rules as index.html: only complete 24-hour local days
   are stored; a missing/invalid hour leaves the day out. It merges into the previous
   data file, keeps the last KEEP_DAYS days, and writes data/rainscore-data.json, which
   the app loads on open. Git history of that file is the long-term archive.

   Farm list and model list are read from index.html (SEED_FARMS, MODEL_POOL), so the
   app stays the single source of truth. Extra orchards: data/extra-farms.json as
   [[name, lat, lon, region], ...].

   Exit code 1 (→ GitHub emails the repo owner) when more than FAIL_LIMIT of orchards
   failed — AFTER writing whatever did succeed. Loud failure, no silent stale data. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "rainscore-data.json");
const EXTRA = join(ROOT, "data", "extra-farms.json");
const PREV_HOST = process.env.PREV_HOST || "https://previous-runs-api.open-meteo.com/v1/forecast";
const ARCH_HOST = process.env.ARCH_HOST || "https://archive-api.open-meteo.com/v1/archive";
const TZ = "Asia/Kuching";
const REF_MODEL = "era5";
const REF_VERSION = "era5-hourly-v1";     // must equal REF_VERSION in index.html
const KEEP_DAYS = 45;                     // 30-day scoring window + ERA5 lag + margin
const ERA5_LAG_DAYS = 5;
const GAP_MS = +(process.env.GAP_MS ?? 400);   // pause between orchards (rate-limit friendly)
const FAIL_LIMIT = 0.10;
const TRIES = +(process.env.RETRIES ?? 4);          // env overrides are for local tests only
const BACKOFF = +(process.env.BACKOFF_MS ?? 1000);

/* ---------- read farms + models from the app itself ---------- */
const html = readFileSync(join(ROOT, "index.html"), "utf8");
function arrayLiteral(name){
  const i = html.indexOf(`const ${name} = [`);
  if(i<0) throw new Error(`${name} not found in index.html`);
  const start = html.indexOf("[", i), end = html.indexOf("\n];", start);
  return new Function(`return ${html.slice(start, end+2)};`)();
}
const MODEL_POOL = arrayLiteral("MODEL_POOL").map(m=>({ key:m.key, api:m.api }));
let farms = arrayLiteral("SEED_FARMS");
if(existsSync(EXTRA)) farms = farms.concat(JSON.parse(readFileSync(EXTRA, "utf8")));
const farmKey = (lat, lon) => `${(+lat).toFixed(4)},${(+lon).toFixed(4)}`;
// Dual-region seeds share coordinates — fetch each point once.
const points = new Map();
for(const [name, lat, lon] of farms){
  if(!isFinite(+lat) || !isFinite(+lon) || Math.abs(lat)>90 || Math.abs(lon)>180) continue;
  const k = farmKey(lat, lon);
  if(!points.has(k)) points.set(k, { key:k, lat:+lat, lon:+lon, names:[] });
  points.get(k).names.push(name);
}

/* ---------- dates in Asia/Kuching ---------- */
const ymd = d => new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
const daysAgo = n => ymd(new Date(Date.now() - n*86400000));
const today = ymd(new Date());

/* ---------- same complete-day rule as the app ---------- */
const HOUR_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):00$/;
function bucketHourly(times, values){
  const out = {};
  if(!Array.isArray(times) || !Array.isArray(values) || times.length!==values.length) return out;
  const acc = {};
  for(let i=0;i<times.length;i++){
    const m = HOUR_RE.exec(String(times[i])); if(!m) continue;
    const day = m[1], hr = +m[2];
    const a = acc[day] || (acc[day] = { sum:0, hours:new Set(), bad:false });
    const v = values[i];
    if(typeof v!=="number" || !isFinite(v) || v<0 || hr>23 || a.hours.has(hr)){ a.bad = true; continue; }
    a.hours.add(hr); a.sum += v;
  }
  for(const day in acc){ const a = acc[day]; if(!a.bad && a.hours.size===24) out[day] = Math.round(a.sum*10)/10; }
  return out;
}

/* ---------- fetch with retry (429/503 aware) ---------- */
const sleep = ms => new Promise(r=>setTimeout(r, ms));
async function fetchJSON(url, tries=TRIES){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if(r.status===429 || r.status>=500){
        const ra = parseInt(r.headers.get("retry-after")||"", 10);
        last = new Error("HTTP "+r.status);
        await sleep(Math.min(isNaN(ra) ? 3*BACKOFF*Math.pow(2,i) : ra*1000, 60000));
        continue;
      }
      if(!r.ok) throw new Error("HTTP "+r.status+" "+(await r.text()).slice(0,200));
      return await r.json();
    }catch(e){ last = e; await sleep(1.5*BACKOFF*(i+1)); }
  }
  throw last || new Error("fetch failed");
}

/* ---------- previous data (merge; start fresh if reference changed) ---------- */
let prev = null;
if(existsSync(OUT)){
  try{ prev = JSON.parse(readFileSync(OUT, "utf8")); }catch{ prev = null; }
  if(prev && prev.refVersion!==REF_VERSION){ console.log("Reference version changed — starting a fresh data file."); prev = null; }
}
const data = { farms: (prev && prev.farms) || {} };

const failures = [];
let n = 0;
for(const p of points.values()){
  n++;
  const f = data.farms[p.key] || (data.farms[p.key] = { lat:p.lat, lon:p.lon, f:{}, a:{}, ok:{} });
  f.names = p.names; f.lat = p.lat; f.lon = p.lon; f.ok = f.ok || {};
  const errs = [];

  // 1) forecasts — all models in one request
  try{
    const q = new URLSearchParams({ latitude:p.lat, longitude:p.lon, timezone:TZ, past_days:"7", forecast_days:"1",
      hourly:"precipitation_previous_day1", models: MODEL_POOL.map(m=>m.api).join(",") });
    const j = await fetchJSON(`${PREV_HOST}?${q}`);
    if(!j || !j.hourly) throw new Error("no hourly data");
    for(const m of MODEL_POOL){
      const daily = bucketHourly(j.hourly.time, j.hourly[`precipitation_previous_day1_${m.api}`]);
      for(const day in daily){ (f.f[day] = f.f[day] || {})[m.key] = daily[day]; }
      if(daily[today]!=null) f.ok[m.key] = today; else errs.push(m.key);
    }
  }catch(e){ errs.push("forecast: "+e.message); }

  // 2) ERA5 actuals — hourly, complete days only
  try{
    const q = new URLSearchParams({ latitude:p.lat, longitude:p.lon, timezone:TZ,
      start_date: daysAgo(KEEP_DAYS-1), end_date: daysAgo(ERA5_LAG_DAYS), hourly:"precipitation", models:REF_MODEL });
    const j = await fetchJSON(`${ARCH_HOST}?${q}`);
    if(!j || !j.hourly) throw new Error("no hourly data");
    const act = bucketHourly(j.hourly.time, j.hourly.precipitation);
    for(const day in act) f.a[day] = act[day];
    if(Object.keys(act).length) f.ok.__actual = today; else errs.push("era5: no complete days");
  }catch(e){ errs.push("era5: "+e.message); }

  if(errs.length) failures.push({ farm:p.names[0], key:p.key, errors:errs });
  console.log(`${String(n).padStart(3)}/${points.size} ${p.names[0]} ${errs.length ? "⚠ "+errs.join("; ") : "ok"}`);
  if(GAP_MS) await sleep(GAP_MS);
}

/* ---------- trim, drop orchards no longer in the list, write ---------- */
const cutoff = daysAgo(KEEP_DAYS-1);
for(const k of Object.keys(data.farms)){
  if(!points.has(k)){ delete data.farms[k]; continue; }
  const fm = data.farms[k];
  for(const d of Object.keys(fm.f)) if(d<cutoff) delete fm.f[d];
  for(const d of Object.keys(fm.a)) if(d<cutoff) delete fm.a[d];
}
const out = {
  version: 1,
  refVersion: REF_VERSION,
  generatedAt: new Date().toISOString(),
  today, keepDays: KEEP_DAYS,
  models: MODEL_POOL.map(m=>m.key),
  orchards: points.size,
  failed: failures.length,
  failures,
  farms: data.farms
};
// One orchard per line so daily git diffs stay readable.
const lines = Object.keys(out.farms).sort().map(k=>`${JSON.stringify(k)}:${JSON.stringify(out.farms[k])}`);
const head = JSON.stringify({ ...out, farms: undefined }).slice(0, -1);
writeFileSync(OUT, `${head},"farms":{\n${lines.join(",\n")}\n}}\n`);
console.log(`\nWrote ${OUT}: ${points.size} orchards, ${failures.length} with problems.`);
if(failures.length > points.size*FAIL_LIMIT){
  console.error(`::error::${failures.length}/${points.size} orchards failed — data file written with what succeeded.`);
  process.exit(1);
}
