# Deploying TraceNet

```text
GitHub repository
   ├── Vercel    → React frontend (static site, repo root, vercel.json)
   ├── Render    → FastAPI backend (repo root, render.yaml, backend/requirements-render.txt)
   └── Supabase  → PostgreSQL 16+ with PostGIS (db/schema.sql)
```

The frontend also runs on its own. When `VITE_API_BASE_URL` is empty, the Vercel build uses the bundled
demo dataset and never calls a backend.

---

## 1. Database: Supabase (PostgreSQL + PostGIS)

1. Create a Supabase project. Pick the region closest to your Render region: Render `singapore` pairs with
   Supabase *Southeast Asia (Singapore)*. Save the database password.
2. Extensions: `db/schema.sql` runs `CREATE EXTENSION IF NOT EXISTS` for **postgis**, **pg_trgm** and
   **fuzzystrmatch**, and Supabase allows all three. You can also enable them first under
   *Database → Extensions*.
3. Connection string: open *Connect* and copy the **Session pooler** URI.
   - It is IPv4 and uses port 5432: `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   - Add `?sslmode=require` to the end.
   - URL-encode special characters in the password.
   - Do **not** use the *Direct connection*. On the free plan it is IPv6-only, and Render cannot reach it.
   - Do **not** use the *Transaction pooler* (port 6543). asyncpg's prepared statements fail behind it.
4. Apply the schema. Either option is idempotent and safe to re-run.
   - Option A, from your machine (needs `psycopg` and `python-ulid`):
     ```bash
     TRACENET_DATABASE_URL='<session-pooler-uri>' python -m backend.db.migrate
     ```
   - Option B: paste `db/schema.sql` into the Supabase *SQL Editor* and run it.
5. Optionally load the demo data: 6 cameras, about 1,500 synthetic observations and journeys for the analytics.
   ```bash
   TRACENET_DATABASE_URL='<session-pooler-uri>' python backend/scripts/seed_db.py --migrate
   ```
6. Recommended: under *Project Settings → Data API*, turn off the Data API or remove `public` from the
   exposed schemas. TraceNet connects to Postgres directly and never uses Supabase's REST API. Leaving it on
   exposes the tables, including `users`, to anyone who has the project's anon key.

## 2. Backend: Render (FastAPI)

**Blueprint (recommended):** *New → Blueprint →* select the repository. Render reads `render.yaml` and asks for
the `sync: false` values.

**Manual alternative:** *New → Web Service* with these settings:

| Setting | Value |
| --- | --- |
| Root directory | *(empty: repository root; the code imports the `backend.*` package)* |
| Runtime | Python 3 |
| Build command | `pip install -r backend/requirements-render.txt` |
| Start command | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/api/health` |
| Instance | Free |

Run **one** instance with **one** worker. The fusion engine, the alert WebSocket bus and the watchlist cache live
in the process's memory. Redis and RabbitMQ are not used on this deployment.

`backend/requirements-render.txt` is the API's runtime subset of `backend/requirements.txt`. The API never imports
ultralytics, torch, paddlepaddle or paddleocr; only the offline pipelines use them. Measured locally, the API
starts at about 110 MB RSS.

## 3. Frontend: Vercel

| Setting | Value |
| --- | --- |
| Root directory | `./` (repository root) |
| Framework preset | Vite (also set in `vercel.json`) |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js version | 20.x or newer (`package.json` engines) |

`VITE_*` values are baked in at build time, so **redeploy after changing any of them**. `.vercelignore` keeps the
backend out of the upload.

## 4. Environment variables

| Variable | Used by | Purpose | Where |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | Frontend | Backend origin, e.g. `https://<service>.onrender.com` (no trailing slash). WebSocket URL is derived (`wss://`). Empty = demo mode | Vercel (Production + Preview) |
| `VITE_DEMO_AUTO_LOGIN` | Frontend | `true` (default) auto-signs-in as the demo officer; `false` requires the Login page | Vercel |
| `VITE_TOMTOM_API_KEY` | Frontend | Optional live-traffic tiles (public key; restrict it to your domain) | Vercel |
| `VITE_GOOGLE_MAPS_API_KEY` | Frontend | Optional Google traffic layer (public key; restrict it by HTTP referrer) | Vercel |
| `TRACENET_DATABASE_URL` | Backend, migrate/seed scripts | PostgreSQL DSN (Supabase session pooler + `sslmode=require`) | Render (secret), your shell for migrate/seed |
| `TRACENET_JWT_SECRET` | Backend | JWT signing key | Render (`generateValue` in the blueprint) |
| `TRACENET_CORS_ORIGINS` | Backend | Allowed frontend origins, comma-separated, e.g. `https://<project>.vercel.app` | Render |
| `TRACENET_CORS_ORIGIN_REGEX` | Backend | Optional: Vercel preview URLs, e.g. `https://<project>-.*\.vercel\.app` | Render |
| `TRACENET_FUSION_TRANSPORT` | Backend | `direct` = in-process fusion (no Redis/RabbitMQ) | Render (set in blueprint) |
| `PYTHON_VERSION` | Render | Pins Python 3.12 | Render (set in blueprint) |
| `PORT` | Backend start command | Provided by Render automatically | — |
| `TRACENET_JWT_TTL`, `TRACENET_ANALYTICS_INTERVAL`, `TRACENET_HLS_BASE`, `TRACENET_REDIS_URL`, `TRACENET_AMQP_URL`, … | Backend | Optional tuning, see `backend/.env.example` | Render (only if needed) |

Local development still uses `backend/.env` and `.env.local`, which are git-ignored. The localhost defaults apply
only when these variables are unset.

## 5. Deployment order

1. **Supabase:** create the project, copy the session-pooler URI, run the migration (and the seed if you want demo data).
2. **Render:** create the service from `render.yaml` and set `TRACENET_DATABASE_URL`. Leave the CORS values empty for now.
   Deploy, then open `https://<service>.onrender.com/api/health` and `/docs`.
3. **Vercel:** import the repository and set `VITE_API_BASE_URL=https://<service>.onrender.com`. Deploy.
4. **CORS:** set `TRACENET_CORS_ORIGINS=https://<project>.vercel.app` (and optionally the preview regex) on Render.
   Saving the variable redeploys the service.
5. **Security:** sign in as `admin` on the deployed site and **change the admin password** in the Admin console (see below).
6. **Test:**
   - `GET /api/health` returns 200.
   - `GET /api/v1/db/health` reports `database: ok`.
   - On the site, the Tracking page finds a seeded plate.
   - The Alerts page connects its WebSocket (browser devtools → Network → WS).
   - No CORS errors in the console.

## 6. Limits of the free deployment

| Component | Status on the free tier | What to do |
| --- | --- | --- |
| Camera ingestion + YOLO11/ByteTrack + PaddleOCR ANPR | **Cannot run.** The ML stack is several GB and needs far more than 512 MB RAM; it isn't installed on Render. `POST /api/ingestion/start` will fail there. | Run the pipelines locally or on a GPU machine (`backend/requirements.txt`) and post sightings to the deployed `POST /api/v1/ingest/sightings` with a `camera_admin` token. |
| ANPR evidence (`/api/anpr*`, `backend/output/anpr/`) | Generated files are git-ignored and Render's disk is ephemeral, so these endpoints return empty results. | Generate offline. Serving them needs a persistent disk (paid) or object storage (not implemented). |
| Local fusion copy (`backend/output/fusion/`, SQLite) | Ephemeral on Render. | Nothing to do: the persistent copy is PostGIS. |
| MediaMTX live streams (HLS/RTSP/WebRTC) | Not deployed. | The Cameras page already falls back to the recorded MP4s served by Vercel. |
| Redis / RabbitMQ | Not deployed. | `TRACENET_FUSION_TRANSPORT=direct`: in-process, single instance. |
| Render free sleep | The service sleeps after about 15 minutes idle; the first request takes up to about a minute. | Pages fall back to demo data while it wakes (3-second API timeout). A paid instance avoids this. |
| Supabase free pause | The project pauses after about 7 days without activity. | Resume it in the dashboard. |
| Vercel bandwidth | `public/` media is about 146 MB (one camera clip is 83 MB). | Watch the Hobby plan's bandwidth quota. |

## 7. Security notes

- `db/schema.sql` seeds two **demo accounts**: `admin` / `admin123` and `officer` / `police123`. The same two
  accounts are built into `backend/api/auth.py` as a fallback for when the database is unreachable. The officer
  password is also in the frontend bundle for auto-login. On a public deployment, change the `admin` password right
  away (Admin console, or `PATCH /api/v1/admin/users/admin`). Note that the built-in fallback still accepts the
  original passwords whenever the database is down.
- Always set `TRACENET_JWT_SECRET`. The API only warns and falls back to a development secret when it is unset.
- WebSocket and evidence-image URLs carry the JWT as `?token=`, so it appears in Render's access logs.
- Never commit `backend/.env` or `.env.local`. Both are covered by `.gitignore`.

## 8. Verify locally before deploying

```bash
# frontend: production build pointed at a backend URL
VITE_API_BASE_URL=https://example.onrender.com npm run build

# backend: install the Render dependency set in a fresh virtualenv and run the Render start command
python3 -m venv .venv && . .venv/bin/activate        # .venv/ is git-ignored
pip install -r backend/requirements-render.txt
PORT=10000 TRACENET_FUSION_TRANSPORT=direct uvicorn backend.main:app --host 0.0.0.0 --port $PORT
curl http://127.0.0.1:10000/api/health
```
