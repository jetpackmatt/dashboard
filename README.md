# 🚢 ShipTrack - Shipping Dashboard & Analytics Platform

A modern, beautiful customer-facing dashboard for managing shipping operations, generating invoices, and analyzing shipping data.

![Built with Next.js](https://img.shields.io/badge/Next.js-14-black)
![Database](https://img.shields.io/badge/PostgreSQL-Database-blue)
![UI](https://img.shields.io/badge/Radix_UI-Components-purple)
![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)

## ✨ Features

### 📊 Dashboard Overview
- Real-time shipping statistics
- Revenue tracking
- Recent shipment activity
- Key performance indicators

### 📄 Invoice Management
- Automatic weekly invoice generation
- CSV-based data import
- Invoice status tracking (Pending, Sent, Paid, Overdue)
- Detailed line item breakdown

### 📈 Analytics & Reporting
- Visual charts and graphs using Recharts
- Monthly shipment trends
- Carrier performance analysis
- Service type distribution
- Revenue trends

### 📤 CSV Upload
- Easy drag-and-drop file upload
- Automatic data parsing and validation
- Support for multiple carriers and service types
- Sample template provided

## 🏗️ Tech Stack

### Frontend
- **Next.js 14** - React framework with App Router
- **TypeScript** - Type safety throughout
- **Tailwind CSS** - Utility-first styling
- **Radix UI** - Accessible component primitives
- **Recharts** - Data visualization
- **Lucide Icons** - Beautiful icons

### Backend
- **Next.js API Routes** - Serverless API endpoints
- **Prisma ORM** - Type-safe database access
- **PostgreSQL** - Relational database
- **PapaCSV** - CSV parsing

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm or pnpm

### Installation

1. **Clone and install:**
```bash
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your database credentials
```

3. **Set up the database:**
```bash
npm run db:generate  # Generate Prisma Client
npm run db:push      # Create database tables
npm run db:seed      # Add sample data (optional)
```

4. **Start the development server:**
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see your dashboard!

## 📖 Detailed Setup Guide

For a complete step-by-step guide, especially if you're new to web development, check out [SETUP_GUIDE.md](./SETUP_GUIDE.md).

## 📁 Project Structure

```
shipping-dashboard/
├── app/                      # Next.js App Router
│   ├── api/                 # API endpoints
│   │   ├── upload/         # CSV upload handler
│   │   └── invoices/       # Invoice operations
│   ├── dashboard/          # Dashboard pages
│   │   ├── page.tsx       # Overview
│   │   ├── invoices/      # Invoice list
│   │   ├── analytics/     # Analytics & charts
│   │   └── upload/        # CSV upload
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Landing page
├── components/             # React components
│   └── ui/                # Radix UI components
├── lib/                    # Utilities
│   ├── db.ts             # Prisma client
│   └── utils.ts          # Helper functions
├── prisma/                # Database
│   ├── schema.prisma     # Database schema
│   └── seed.ts           # Seed data
├── sample-data.csv        # Sample CSV for testing
└── SETUP_GUIDE.md        # Detailed setup instructions
```

## 💾 Database Schema

### Models

**Customer**
- Account information
- Company details
- Contact information

**Shipment**
- Tracking numbers
- Origin/destination
- Weight, dimensions
- Service type, carrier
- Costs and status

**Invoice**
- Invoice numbers
- Date ranges (weekly)
- Financial totals
- Status tracking

**InvoiceLineItem**
- Detailed charges
- Quantity and pricing

## 🎨 Key Features Explained

### CSV Upload
Upload shipping data with these columns:
- `tracking_number` - Unique identifier
- `shipment_date` - Date of shipment
- `origin` - Origin location
- `destination` - Destination location
- `weight` - Package weight
- `service_type` - Shipping service
- `shipping_cost` - Cost
- Optional: `carrier`, `status`, `dimensions`, etc.

### Invoice Generation
Automatically generates weekly invoices from shipment data:
- Groups shipments by week
- Calculates subtotals and taxes
- Creates line items
- Assigns unique invoice numbers

### Analytics Dashboard
Visual insights into your shipping operations:
- Monthly trends
- Carrier comparisons
- Service type distribution
- Revenue tracking

## 🛠️ Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

npm run db:generate  # Generate Prisma Client
npm run db:push      # Push schema to database
npm run db:studio    # Open Prisma Studio
npm run db:seed      # Seed database with sample data
```

## 🔐 Environment Variables

Required environment variables:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/shipping_dashboard"
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"
NODE_ENV="development"
```

## 🚀 Deployment

### Database
Deploy your PostgreSQL database to:
- [Railway](https://railway.app/)
- [Supabase](https://supabase.com/)
- [Neon](https://neon.tech/)

### Application
Deploy your Next.js app to:
- [Vercel](https://vercel.com/) (recommended)
- [Railway](https://railway.app/)
- [Netlify](https://www.netlify.com/)

Steps:
1. Push code to GitHub
2. Connect to Vercel
3. Add environment variables
4. Deploy!

## 🎯 Roadmap & Future Features

- [ ] Multi-tenant support (multiple customers)
- [ ] Authentication with NextAuth.js
- [ ] PDF invoice generation
- [ ] Email notifications
- [ ] Payment integration (Stripe)
- [ ] Real-time tracking updates
- [ ] Advanced filtering and search
- [ ] Export reports to Excel/PDF
- [ ] Mobile app
- [ ] Webhook integrations

## 🤝 Contributing

This is a starter template designed to be customized for your needs. Feel free to:
- Add new features
- Improve the UI
- Optimize performance
- Extend the database schema

## 📄 License

MIT License - feel free to use this for your projects!

## 🙏 Acknowledgments

Built with amazing open-source tools:
- [Next.js](https://nextjs.org/)
- [Prisma](https://www.prisma.io/)
- [Radix UI](https://www.radix-ui.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Recharts](https://recharts.org/)

---

**Happy Shipping!** 🚀📦

For questions or issues, please refer to the [SETUP_GUIDE.md](./SETUP_GUIDE.md) or open an issue.
