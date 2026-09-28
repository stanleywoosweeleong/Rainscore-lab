# RainScore Lab · 雨准实验 — research build

A research variant of RainScore for comparing **up to 6 forecast models at once**
(production app compares 3). Use this privately to discover which models perform
best at your locations, then set the winners as the default in the main app.

## What's different from production RainScore
- **Pick 1–6 models** from the pool (IFS 9km, ICON, JMA, CMA, GEM, GFS), not just 3.
- Six distinct colours; verdict cards wrap to two rows when 4–6 are selected.
- The comparison table gets wide with 6 models — horizontal scroll on phones is
  expected. This build is for studying data, not for farmer-facing presentation.
- Separate identity: title "RainScore Lab", cache `rainscore-lab-*`, localStorage
  key `rainscore_lab_v1` — so it never collides with the production app's data,
  even on the same device.

## Deploy
Put all files in the root of a **new** GitHub repo (suggested name: `Rainscore-lab`).
If you use a different repo name, update two constants in `index.html` —
`APP_URL` and `GITHUB_URL` — and the QR will need regenerating to match.
Note: all your GitHub Pages repos share ONE origin (stanleywoosweeleong.github.io).
This build stays independent of production because it uses its own localStorage key
(`rainscore_lab_v1`) and only ever touches service-worker caches whose name starts
with `rainscore-lab-`.

## How to use it for model research
1. Add your real orchard locations (same coordinates as production).
2. Select all 6 models and let it run daily for ~1 month.
3. Watch which 3 consistently win on Avg miss and Dry/wet calls at your spots.
4. Set those 3 as the default in the production app's `DEFAULT_SELECTION`.

## Model pool
Only global models that cover Malaysia with reliable archived precipitation:
ECMWF IFS 9km, DWD ICON, JMA GSM, CMA GRAPES, GEM (Canada), GFS (USA).
AI models (GraphCast, AIFS) are excluded — they don't serve usable rainfall.

Data: Open-Meteo (CC BY 4.0). Forecasts via Previous Runs API; actuals ERA5, pinned
with `models=era5` (the archive default "Best Match" is IFS analysis for recent days,
which would score IFS against itself). Only complete 24-hour local days are scored.
The SheetJS file is `xlsx_full_min.js` — keep that exact name (index.html and sw.js
both reference it).

## Daily auto-collection (GitHub Action)
`.github/workflows/rainscore-collect.yml` runs `tools/collect.mjs` every day at
04:11 Malaysia time. It fetches all six models + ERA5 for every seed orchard (the
same data and the same complete-day rule as the app) and commits
`data/rainscore-data.json`. The app loads that file on open, so results are ready
without fetching; manual update and drive mode still work and only fetch what the
file doesn't cover (e.g. orchards added on the phone).

Setup, once:
1. Push this repo (including the hidden `.github` folder).
2. Repo → Settings → Actions → General → Workflow permissions → **Read and write**.
3. Actions tab → "RainScore daily data" → **Run workflow** (creates the first data file;
   until then the app shows "⚠ Couldn't load auto data" and works by hand as before).

- Extra orchards for the daily run: `data/extra-farms.json` as `[["Name", lat, lon, "Region"], ...]`.
- If more than 10% of orchards fail, the run still saves what worked, then fails so
  GitHub emails you. The app also warns when the file is over 30 hours old.
- The file keeps 45 days; git history of it is the permanent archive.
