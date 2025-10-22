Shipping Dashboard – invoices and analytics
=========================================

Stack
-----
- Next.js App Router, TypeScript, Tailwind CSS
- Radix UI Themes and Icons
- Prisma ORM with SQLite (local) and Postgres-ready
- Recharts for charts

Getting started
---------------
1) Install dependencies:

```bash
npm install
```

2) Create database and generate client:

```bash
npx prisma migrate dev --name init
```

3) Run the dev server:

```bash
npm run dev
```

Open http://localhost:3000.

Features
--------
- Upload CSV at `/upload` (see `public/sample-shipments.csv`)
- Generate weekly invoices at `/invoices` then view totals
- Revenue chart at `/reports`

Environment & Database
----------------------
- `.env` contains `DATABASE_URL` for SQLite by default: `file:./prisma/dev.db`
- To use Postgres, set `DATABASE_URL` to your Postgres URL and run `npx prisma migrate deploy`
