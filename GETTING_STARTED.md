# 🎯 Getting Started - Quick Reference

This is your quick-start guide to get the shipping dashboard up and running in minutes!

## ⚡ Super Quick Start (For Experienced Developers)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials

# 3. Initialize database
npm run db:generate
npm run db:push
npm run db:seed

# 4. Start the app
npm run dev
```

Visit `http://localhost:3000` 🎉

## 🔥 First Time? Follow These Steps

### Step 1: Verify You Have Everything

Check if you have Node.js and PostgreSQL installed:
```bash
node --version   # Should be v18 or higher
npm --version    # Should be v9 or higher
psql --version   # Should be v14 or higher
```

Don't have them? [See SETUP_GUIDE.md](./SETUP_GUIDE.md) for installation instructions.

### Step 2: Get PostgreSQL Running

**Option A: Using Docker (Easiest)**
```bash
docker run --name shipping-db \
  -e POSTGRES_PASSWORD=mypassword \
  -e POSTGRES_DB=shipping_dashboard \
  -p 5432:5432 \
  -d postgres:15
```

**Option B: Local PostgreSQL**
```bash
# Create the database
createdb shipping_dashboard
```

### Step 3: Configure Your Database Connection

1. Copy the environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and update the `DATABASE_URL`:
```env
# If using Docker with the command above:
DATABASE_URL="postgresql://postgres:mypassword@localhost:5432/shipping_dashboard?schema=public"

# If using local PostgreSQL:
DATABASE_URL="postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/shipping_dashboard?schema=public"
```

### Step 4: Install and Set Up

```bash
# Install all dependencies
npm install

# Generate Prisma Client
npm run db:generate

# Create database tables
npm run db:push

# Load sample data (recommended for first time)
npm run db:seed
```

### Step 5: Launch! 🚀

```bash
npm run dev
```

Open your browser to `http://localhost:3000`

## 🎨 What You'll See

### Landing Page (http://localhost:3000)
Beautiful marketing page explaining the features with a "Launch Dashboard" button.

### Dashboard (http://localhost:3000/dashboard)
Main dashboard with:
- 📊 Overview page - Key stats and recent activity
- 📄 Invoices - View all invoices
- 📈 Analytics - Visual reports and charts
- 📤 Upload - Import CSV data

## 📤 Try Uploading Data

1. Navigate to **Upload Data** in the dashboard
2. Use the provided `sample-data.csv` file
3. Drag and drop or click to upload
4. Watch your dashboard populate with data!

## 🔍 Explore Your Database

Want to see what's happening in the database?

```bash
npm run db:studio
```

This opens Prisma Studio at `http://localhost:5555` where you can:
- Browse all your data
- Edit records manually
- See relationships between tables

## 🧪 Understanding the Sample Data

After running `npm run db:seed`, you'll have:

- **1 Demo Customer**
  - Email: `demo@example.com`
  - Password: `demo123`
  - Company: Acme Corporation

- **20 Sample Shipments**
  - Various dates, carriers, and statuses
  - Different service types (Standard, Express, Overnight)

- **1 Sample Invoice**
  - Generated from the most recent shipments
  - Status: SENT

## 📊 CSV File Format

Your CSV should have these columns:

### Required
- `tracking_number` - Unique ID (e.g., TRK100001)
- `shipment_date` - Date in YYYY-MM-DD format
- `origin` - Origin city and state
- `destination` - Destination city and state
- `weight` - Weight in pounds
- `service_type` - Standard, Express, or Overnight
- `shipping_cost` - Dollar amount

### Optional
- `carrier` - UPS, FedEx, USPS, DHL, etc.
- `status` - PENDING, IN_TRANSIT, DELIVERED
- `package_type` - Box, Envelope, Pallet
- `dimensions` - e.g., "12x10x8"
- `delivered_at` - Delivery date (YYYY-MM-DD)

Check `sample-data.csv` for a complete example!

## 🔧 Common Tasks

### Reset the Database
```bash
npm run db:push -- --force-reset
npm run db:seed
```

### Add More Sample Data
Edit `prisma/seed.ts` and run:
```bash
npm run db:seed
```

### Check for Errors
```bash
npm run lint
```

### Build for Production
```bash
npm run build
npm run start
```

## 🐛 Troubleshooting Quick Fixes

### "Can't connect to database"
1. Is PostgreSQL running? Check with `docker ps` or `pg_isready`
2. Is your DATABASE_URL correct in `.env`?
3. Does the database exist? Try `createdb shipping_dashboard`

### "Port 3000 already in use"
```bash
# Kill the process
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 npm run dev
```

### "Prisma Client not found"
```bash
npm run db:generate
```

### "Module not found"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Pages show "No data"
```bash
npm run db:seed
```

## 🎯 Next Steps

Now that everything is running:

1. **Explore the Dashboard** - Click through all the pages
2. **Upload Your Own Data** - Use the Upload page with your CSV
3. **Check Prisma Studio** - See how data is stored
4. **Customize the UI** - Edit files in `app/dashboard/`
5. **Add Features** - Refer to the roadmap in README.md

## 📚 Understanding the Code

### Key Files to Know

**Frontend Pages:**
- `app/page.tsx` - Landing page
- `app/dashboard/page.tsx` - Main dashboard
- `app/dashboard/invoices/page.tsx` - Invoice list
- `app/dashboard/analytics/page.tsx` - Charts
- `app/dashboard/upload/page.tsx` - CSV upload

**API Routes:**
- `app/api/upload/route.ts` - Handles CSV uploads
- `app/api/invoices/generate/route.ts` - Creates invoices

**Database:**
- `prisma/schema.prisma` - Database structure
- `lib/db.ts` - Prisma client
- `prisma/seed.ts` - Sample data

**Components:**
- `components/ui/*` - Reusable Radix UI components

### Making Changes

Want to customize something?

**Change colors:**
Edit `app/globals.css` - look for the `:root` section

**Modify the database:**
1. Edit `prisma/schema.prisma`
2. Run `npm run db:push`
3. Run `npm run db:generate`

**Add a new page:**
Create a file in `app/dashboard/your-page/page.tsx`

## 💡 Pro Tips

1. **Keep Prisma Studio open** while developing - it's super helpful
2. **Check the browser console** for errors (F12)
3. **Use the sample CSV** as a template for your own data
4. **Start small** - Get one feature working before adding more
5. **Read the Prisma logs** - They show all database queries

## 🚀 Ready to Customize?

The entire application is yours to modify! Some ideas:

- Add your company logo to the navbar
- Change the color scheme in `app/globals.css`
- Add more chart types in the analytics page
- Create custom invoice templates
- Add email notifications
- Integrate with shipping APIs

## 📞 Need More Help?

- **Detailed Setup:** [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- **Full Documentation:** [README.md](./README.md)
- **Database Schema:** Open Prisma Studio (`npm run db:studio`)

---

**You're all set!** 🎉 Start exploring your new shipping dashboard!
