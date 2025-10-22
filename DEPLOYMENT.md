# 🚀 Deployment Guide

This guide will help you deploy your shipping dashboard to production.

## 🎯 Recommended Setup: Vercel + Railway

This is the easiest and most cost-effective way to deploy:
- **Vercel**: Free tier for Next.js hosting
- **Railway**: $5/month for PostgreSQL database

Total cost: **~$5/month** (or free with smaller databases)

## Step 1: Deploy Database to Railway

### 1.1 Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Create a new project

### 1.2 Add PostgreSQL
1. Click "New" → "Database" → "Add PostgreSQL"
2. Wait for provisioning (1-2 minutes)
3. Click on the PostgreSQL service

### 1.3 Get Connection String
1. Go to "Connect" tab
2. Copy the "DATABASE_URL"
3. It looks like: `postgresql://postgres:xxx@xxx.railway.app:5432/railway`

### 1.4 Initialize Database
On your local machine:
```bash
# Set the Railway database URL temporarily
export DATABASE_URL="your-railway-database-url"

# Push schema to Railway database
npm run db:push

# Optionally seed with sample data
npm run db:seed
```

## Step 2: Deploy Application to Vercel

### 2.1 Prepare Your Repository
```bash
# Make sure everything is committed
git add .
git commit -m "Ready for deployment"

# Push to GitHub
git remote add origin https://github.com/yourusername/shipping-dashboard.git
git push -u origin main
```

### 2.2 Deploy to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repository
4. Vercel will auto-detect Next.js settings

### 2.3 Add Environment Variables
In Vercel dashboard → Settings → Environment Variables, add:

```env
DATABASE_URL=your-railway-database-url
NEXTAUTH_SECRET=generate-a-new-secret-key
NEXTAUTH_URL=https://your-app-name.vercel.app
NODE_ENV=production
```

Generate a secure secret:
```bash
openssl rand -base64 32
```

### 2.4 Deploy
1. Click "Deploy"
2. Wait 2-3 minutes
3. Visit your live site at `https://your-app.vercel.app`

## 🎉 You're Live!

Your application is now deployed and accessible worldwide!

---

## Alternative: Netlify + Supabase

### Database: Supabase
1. Go to [supabase.com](https://supabase.com)
2. Create new project
3. Wait for PostgreSQL provisioning
4. Get connection string from Settings → Database

### Application: Netlify
1. Go to [netlify.com](https://netlify.com)
2. Connect GitHub repository
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `.next`
4. Add environment variables
5. Deploy

---

## Alternative: Single Server (VPS)

For more control, deploy to a VPS:

### Recommended Providers:
- **DigitalOcean**: $6/month droplet
- **Linode**: $5/month Nanode
- **Vultr**: $5/month instance

### Setup Process:

#### 1. Server Setup
```bash
# SSH into your server
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Install PM2 for process management
npm install -g pm2
```

#### 2. Database Setup
```bash
# Create database
sudo -u postgres createdb shipping_dashboard

# Create user
sudo -u postgres psql
CREATE USER shipuser WITH PASSWORD 'securepassword';
GRANT ALL PRIVILEGES ON DATABASE shipping_dashboard TO shipuser;
\q
```

#### 3. Application Setup
```bash
# Clone your repository
git clone https://github.com/yourusername/shipping-dashboard.git
cd shipping-dashboard

# Install dependencies
npm install

# Create .env file
nano .env
# Add your environment variables

# Build the application
npm run build

# Initialize database
npm run db:push
npm run db:seed

# Start with PM2
pm2 start npm --name "shipping-dashboard" -- start
pm2 save
pm2 startup
```

#### 4. Nginx Setup (Optional)
```bash
# Install Nginx
apt install -y nginx

# Configure Nginx
nano /etc/nginx/sites-available/shipping-dashboard
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/shipping-dashboard /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

#### 5. SSL with Let's Encrypt
```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get SSL certificate
certbot --nginx -d your-domain.com
```

---

## Environment Variables Reference

### Required for Production:
```env
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
NEXTAUTH_SECRET="secure-random-string-at-least-32-characters"
NEXTAUTH_URL="https://your-production-domain.com"
NODE_ENV="production"
```

### Optional:
```env
# Email service (for notifications)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-app-password"

# Analytics
NEXT_PUBLIC_GA_ID="G-XXXXXXXXXX"
```

---

## Post-Deployment Checklist

After deploying, verify:

- [ ] Landing page loads correctly
- [ ] Dashboard pages work
- [ ] Database connection is successful
- [ ] CSV upload functionality works
- [ ] Charts render properly
- [ ] No console errors
- [ ] Environment variables are set
- [ ] SSL certificate is active (https)
- [ ] Responsive design on mobile
- [ ] Performance is good (use Lighthouse)

---

## Monitoring & Maintenance

### Vercel Monitoring
Vercel provides automatic:
- Error tracking
- Performance monitoring
- Analytics
- Logs

Access in: Vercel Dashboard → Your Project → Monitoring

### Railway Monitoring
Railway provides:
- Database metrics
- Query performance
- Storage usage
- Connection counts

### Setup Alerts
1. **Vercel**: Enable deployment notifications
2. **Railway**: Set up usage alerts
3. **UptimeRobot**: Free uptime monitoring

---

## Scaling Considerations

### Database Scaling (Railway)
- Start: Hobby plan ($5/month) - 100 MB
- Grow: Developer plan ($10/month) - 1 GB
- Scale: Pro plan ($20/month) - 8 GB

### Application Scaling (Vercel)
- Vercel automatically scales
- No configuration needed
- Handles traffic spikes
- Global CDN included

---

## Backup Strategy

### Database Backups

**Railway** (Automatic):
- Automatic daily backups
- Point-in-time recovery
- One-click restore

**Manual Backup**:
```bash
# Backup database
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Restore database
psql $DATABASE_URL < backup-20251022.sql
```

### Application Backups
- Code: Backed up in GitHub
- Config: Document all environment variables
- Assets: Store in version control

---

## Security Best Practices

### Production Checklist:
- [x] Use HTTPS (SSL certificate)
- [x] Secure DATABASE_URL (not in code)
- [x] Strong NEXTAUTH_SECRET
- [ ] Implement authentication
- [ ] Add rate limiting
- [ ] Set up CORS properly
- [ ] Enable database connection pooling
- [ ] Use environment-specific configs
- [ ] Regular security updates

### Railway Database Security:
- Enable SSL connections
- Use connection pooling
- Rotate credentials periodically
- Monitor access logs

---

## Troubleshooting Deployment Issues

### Build Fails
```bash
# Check build locally
npm run build

# Common fixes:
npm install --legacy-peer-deps
rm -rf node_modules package-lock.json && npm install
```

### Database Connection Issues
- Verify DATABASE_URL is correct
- Check if IP is whitelisted (Railway/Supabase)
- Ensure SSL mode is set correctly
- Test connection with Prisma Studio locally

### Environment Variables Not Working
- Double-check spelling
- Ensure no extra spaces
- Redeploy after adding variables
- Check if variables are in correct environment (production/preview)

### 500 Internal Server Error
- Check Vercel logs
- Verify all environment variables are set
- Ensure database is accessible
- Check for syntax errors in server components

---

## Cost Breakdown

### Free Tier (Testing):
- Vercel: Free (hobby projects)
- Supabase: Free (500MB database)
- **Total: $0/month**

### Starter (Small Business):
- Vercel: Free
- Railway: $5/month
- **Total: $5/month**

### Growing (Medium Business):
- Vercel: $20/month (Pro)
- Railway: $20/month (Pro)
- **Total: $40/month**

---

## Domain Setup

### 1. Buy Domain
- Namecheap: ~$10/year
- Google Domains: ~$12/year
- Cloudflare: ~$9/year

### 2. Configure DNS (Vercel)
1. Add domain in Vercel dashboard
2. Add DNS records from your provider:
   ```
   Type: A
   Name: @
   Value: 76.76.21.21
   
   Type: CNAME
   Name: www
   Value: cname.vercel-dns.com
   ```

### 3. SSL Auto-Configures
Vercel handles SSL automatically via Let's Encrypt.

---

## CI/CD Setup

Already configured! 🎉

Vercel automatically:
1. Detects git push
2. Runs `npm run build`
3. Deploys if successful
4. Rolls back if failed

### Branch Deployments:
- `main` → Production
- Other branches → Preview deployments

---

## Performance Optimization

### Already Optimized:
✅ Server Components
✅ Code splitting
✅ Image optimization ready
✅ CSS purging with Tailwind
✅ Database indexes

### Additional Steps:
- [ ] Add Redis for caching
- [ ] Enable database connection pooling
- [ ] Add CDN for static assets
- [ ] Implement ISR (Incremental Static Regeneration)

---

## 📞 Support Resources

- **Vercel Docs**: https://vercel.com/docs
- **Railway Docs**: https://docs.railway.app
- **Prisma Deployment**: https://www.prisma.io/docs/guides/deployment

---

**Congratulations!** 🚀 Your shipping dashboard is now live and serving customers worldwide!
