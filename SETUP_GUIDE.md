# Shipping Dashboard - Complete Setup Guide

This guide will walk you through setting up your shipping dashboard from scratch. Don't worry if you're new to this - we'll go step by step!

## 📋 Prerequisites

Before we begin, make sure you have the following installed:

1. **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
2. **PostgreSQL** (v14 or higher) - [Download here](https://www.postgresql.org/download/)
3. **npm** or **pnpm** (comes with Node.js)

To verify your installations, run:
```bash
node --version
npm --version
psql --version
```

## 🗄️ Step 1: Set Up PostgreSQL Database

### Option A: Using Docker (Recommended for Beginners)

```bash
# Pull and run PostgreSQL
docker run --name shipping-postgres \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=shipping_dashboard \
  -p 5432:5432 \
  -d postgres:15

# Verify it's running
docker ps
```

### Option B: Using Local PostgreSQL

1. Open PostgreSQL command line or pgAdmin
2. Create a new database:
```sql
CREATE DATABASE shipping_dashboard;
```

3. Create a user (optional):
```sql
CREATE USER shipping_user WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE shipping_dashboard TO shipping_user;
```

## 🔧 Step 2: Configure Environment Variables

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and update with your database credentials:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/shipping_dashboard?schema=public"
NEXTAUTH_SECRET="run: openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"
NODE_ENV="development"
```

**Important:** Replace `username` and `password` with your actual PostgreSQL credentials.

To generate a secure `NEXTAUTH_SECRET`, run:
```bash
openssl rand -base64 32
```

## 📦 Step 3: Install Dependencies

```bash
npm install
# or
pnpm install
```

This will install all required packages including:
- Next.js (React framework)
- Prisma (Database ORM)
- Radix UI (UI components)
- Recharts (Analytics charts)
- And many more...

## 🏗️ Step 4: Set Up the Database

1. **Generate Prisma Client:**
```bash
npm run db:generate
```

2. **Push the schema to your database:**
```bash
npm run db:push
```

This creates all the necessary tables:
- `customers` - Customer accounts
- `invoices` - Invoice records
- `invoice_line_items` - Invoice details
- `shipments` - Shipment tracking data

3. **Seed with sample data (optional but recommended):**
```bash
npm run db:seed
```

This creates:
- A demo customer account (email: demo@example.com, password: demo123)
- 20 sample shipments
- 1 sample invoice

## 🚀 Step 5: Start the Development Server

```bash
npm run dev
```

Your application should now be running at [http://localhost:3000](http://localhost:3000)

## 🎯 Step 6: Explore the Application

### Landing Page
Visit `http://localhost:3000` to see the beautiful landing page.

### Dashboard
Click "Launch Dashboard" or visit `http://localhost:3000/dashboard` to access:
- **Overview** - Key metrics and recent activity
- **Invoices** - View and manage all invoices
- **Analytics** - Visual reports and trends
- **Upload Data** - Import shipping data via CSV

## 📊 Step 7: Upload Your First CSV

1. Navigate to **Upload Data** in the dashboard
2. Download the sample template or create a CSV with these columns:

```csv
tracking_number,shipment_date,origin,destination,weight,service_type,shipping_cost,carrier,status
TRK001,2025-10-15,New York NY,Los Angeles CA,15.5,Standard,25.50,UPS,DELIVERED
TRK002,2025-10-16,Chicago IL,Houston TX,22.3,Express,45.75,FedEx,IN_TRANSIT
```

3. Upload the CSV file and watch your data populate!

## 🔍 Database Exploration (Optional)

To view and edit your database directly:

```bash
npm run db:studio
```

This opens Prisma Studio at `http://localhost:5555` where you can:
- View all tables
- Edit records
- Run queries
- Explore relationships

## 📁 Project Structure

```
shipping-dashboard/
├── app/                    # Next.js 14 App Router
│   ├── api/               # API routes
│   ├── dashboard/         # Dashboard pages
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   └── ui/               # Radix UI components
├── lib/                   # Utility functions
│   ├── db.ts             # Prisma client
│   └── utils.ts          # Helper functions
├── prisma/               # Database schema & migrations
│   ├── schema.prisma     # Database schema
│   └── seed.ts           # Seed data
└── public/               # Static files
```

## 🎨 Understanding the Tech Stack

### Frontend
- **Next.js 14** - React framework with server components
- **Tailwind CSS** - Utility-first CSS framework
- **Radix UI** - Accessible, unstyled component primitives
- **Recharts** - Composable charting library

### Backend
- **Next.js API Routes** - Serverless API endpoints
- **Prisma** - Modern database toolkit
- **PostgreSQL** - Relational database

### Why These Choices?
- **Expandable**: Easy to add new features
- **Type-safe**: TypeScript throughout
- **Modern**: Latest best practices
- **Beautiful**: Professional UI out of the box

## 🔐 Database Schema Overview

### Customers Table
Stores customer information and login credentials.

### Shipments Table
Tracks individual shipments with details like:
- Tracking number
- Origin/destination
- Weight and dimensions
- Service type and carrier
- Costs and status

### Invoices Table
Weekly invoices with:
- Invoice number
- Date ranges
- Financial totals
- Status tracking

### Invoice Line Items
Detailed breakdown of charges per invoice.

## 🛠️ Common Commands

```bash
# Development
npm run dev              # Start dev server
npm run build           # Build for production
npm run start           # Start production server

# Database
npm run db:generate     # Generate Prisma client
npm run db:push         # Push schema to database
npm run db:studio       # Open database GUI
npm run db:seed         # Seed sample data

# Code Quality
npm run lint            # Run ESLint
```

## 🐛 Troubleshooting

### "Can't connect to database"
- Verify PostgreSQL is running
- Check your DATABASE_URL in `.env`
- Ensure the database exists
- Check username/password

### "Module not found"
```bash
rm -rf node_modules
rm package-lock.json
npm install
```

### "Prisma Client not found"
```bash
npm run db:generate
```

### Port 3000 already in use
```bash
# Kill the process on port 3000
lsof -ti:3000 | xargs kill -9
# Or use a different port
PORT=3001 npm run dev
```

## 🚀 Next Steps

Now that you have the basic setup running, here are some ideas for expansion:

1. **Add Authentication**
   - Implement NextAuth.js for customer login
   - Add role-based access control

2. **Email Integration**
   - Send invoice emails automatically
   - Notification system

3. **Advanced Features**
   - PDF invoice generation
   - Payment integration (Stripe)
   - Real-time tracking updates
   - Multi-customer support

4. **Deployment**
   - Deploy to Vercel (frontend)
   - Use Railway or Supabase (database)

## 📚 Learning Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Radix UI](https://www.radix-ui.com/)
- [Tailwind CSS](https://tailwindcss.com/)

## 💡 Tips for Beginners

1. **Start Small**: Get the basic flow working first
2. **Use Prisma Studio**: It's a great way to understand your data
3. **Check the Console**: Browser console and terminal for errors
4. **Read the Logs**: Prisma logs all queries (helpful for debugging)
5. **Experiment**: Try modifying the seed data or adding fields

## 🤝 Need Help?

If you get stuck:
1. Check the error messages carefully
2. Review the setup steps
3. Look at the sample data in Prisma Studio
4. Check if the database is running

---

**Congratulations!** 🎉 You now have a professional shipping dashboard running. Start by exploring the demo data, then upload your own CSVs!
