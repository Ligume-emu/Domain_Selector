# Domain Selector

A Next.js application for scoring, filtering, and exporting link-building domain inventories. Built with the App Router, Prisma ORM, and a Python export sidecar.

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Run database migrations (SQLite for local dev)
npx prisma migrate dev

# 3. Seed domains from the CSV inventory
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts

# 4. Start the Next.js dev server
npm run dev
# App runs at http://localhost:3000

# 5. Start the export sidecar (separate terminal)
pip install fastapi uvicorn openpyxl
python -m uvicorn scripts.export_server:app --port 8001 --reload
```

## Deployment to Vercel

1. **Swap the Prisma provider** from SQLite to PostgreSQL:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. **Set the `DATABASE_URL` environment variable** in Vercel project settings to your PostgreSQL connection string.
3. **Run migrations** against the production database:
   ```bash
   npx prisma migrate deploy
   ```
4. **Export sidecar**: The Python FastAPI sidecar (`scripts/export_server.py`) cannot run on Vercel's serverless platform. Deploy it separately on **Railway**, **Render**, or any container host. Set the sidecar URL in your environment so the `/api/export` route can reach it.

## Updating the Scoring Config

Scoring weights and thresholds are stored in the `ConfigVersion` table. Each row contains:

| Field       | Description                                                  |
|-------------|--------------------------------------------------------------|
| `version`   | Integer version number (unique)                              |
| `isActive`  | Boolean — only one version should be active at a time        |
| `note`      | Free-text description of what changed                        |
| `base`      | JSON object with profile weights, DR/traffic thresholds, etc.|
| `overrides`  | JSON object with per-niche or per-geo scoring overrides      |

To update:

```bash
npx prisma studio
```

Edit the `ConfigVersion` table directly — create a new row with `version` incremented, set `isActive = true`, and set the previous version's `isActive = false`.

## Rolling Back a Config Change

1. Open Prisma Studio: `npx prisma studio`
2. Set `isActive = false` on the current (broken) config version.
3. Set `isActive = true` on the previous version you want to restore.
4. The app reads the active config on each request — no restart needed.
