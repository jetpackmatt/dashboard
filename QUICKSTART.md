# ⚡ QuickStart - 5 Minutes to Running Dashboard

The absolute fastest way to get started.

## Prerequisites Check

```bash
node --version  # Need v18+
npm --version   # Need v9+
```

## 1. Database (Choose One)

### Docker (Recommended - Copy & Paste)
```bash
docker run --name shipping-db -e POSTGRES_PASSWORD=password -e POSTGRES_DB=shipping_dashboard -p 5432:5432 -d postgres:15
```

### Local PostgreSQL
```bash
createdb shipping_dashboard
```

## 2. Install & Configure

```bash
# Install dependencies
npm install

# Create .env file
echo 'DATABASE_URL="postgresql://postgres:password@localhost:5432/shipping_dashboard?schema=public"
NEXTAUTH_SECRET="quickstart-secret-key-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
NODE_ENV="development"' > .env
```

## 3. Initialize Database

```bash
npm run db:generate && npm run db:push && npm run db:seed
```

## 4. Launch

```bash
npm run dev
```

## 🎉 Done!

Open: **http://localhost:3000**

Click: **"Launch Dashboard"**

See: Your data, charts, and invoices!

---

### What's Inside?

- ✅ 20 sample shipments
- ✅ 1 sample invoice  
- ✅ Beautiful analytics charts
- ✅ CSV upload ready

### Try This Next:

1. Go to **Upload Data** page
2. Upload `sample-data.csv`
3. See new shipments appear!

### View Database:
```bash
npm run db:studio
# Opens http://localhost:5555
```

---

**That's it!** 🚀

Problems? Check [GETTING_STARTED.md](./GETTING_STARTED.md) for troubleshooting.
