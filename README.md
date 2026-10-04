# SalesForge — merged project

This repository is the merged SalesForge application combining the FIN-TECH and UptoSkills variants.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL + Prisma
- Background jobs: Redis + BullMQ

## Local setup

1. Copy environment examples:
   - `backend/.env.example` → `backend/.env`
   - `frontend/.env.example` → `frontend/.env`
2. Start PostgreSQL and Redis, or use the included Docker Compose setup.
3. Install dependencies:

```bash
npm run install:all
```

4. Bring the current Prisma schema into the database:

```bash
npm run db:push
```

5. Start the backend and frontend in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

The Vite development server proxies `/api` to `http://localhost:3000` by default.

## Docker verification setup

The included Compose file provisions PostgreSQL and Redis and uses `prisma db push` against a fresh database before starting the backend:

```bash
docker compose up --build
```

Then open `http://localhost:8080`.

### Why `db push` is used here

The current Prisma schema contains substantially more tables and enum values than the historical migration directory. Until a clean production migration baseline is regenerated against the intended database, `prisma db push` is the reliable way to provision a fresh database from the checked-in schema. Do not run destructive schema commands against a production database without a backup.

## Environment

The backend needs `DATABASE_URL` and `JWT_SECRET`. Redis is required for BullMQ-backed functionality. Email, Google, Firebase, AI, and other integrations are optional until their corresponding features are used.
