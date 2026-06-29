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
Because GitHub Pages serves each repo from its own origin, this build keeps its
own independent history, separate from the production RainScore.

## How to use it for model research
1. Add your real orchard locations (same coordinates as production).
2. Select all 6 models and let it run daily for ~1 month.
3. Watch which 3 consistently win on Avg miss and Dry/wet calls at your spots.
4. Set those 3 as the default in the production app's `DEFAULT_SELECTION`.

## Model pool
Only global models that cover Malaysia with reliable archived precipitation:
ECMWF IFS 9km, DWD ICON, JMA GSM, CMA GRAPES, GEM (Canada), GFS (USA).
AI models (GraphCast, AIFS) are excluded — they don't serve usable rainfall.

Data: Open-Meteo (CC BY 4.0). Forecasts via Previous Runs API; actuals ERA5.
