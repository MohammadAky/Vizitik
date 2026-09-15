# Vizitik - Render Deployment with Supabase

This guide walks you through deploying Vizitik on [Render](https://render.com) with [Supabase](https://supabase.com) as the database.

## Prerequisites

1. A [Render](https://render.com) account (free tier works for testing)
2. A [Supabase](https://supabase.com) account (free tier includes 500MB database)
3. Your Vizitik code pushed to GitHub

## Step 1: Set Up Supabase Database

1. Go to [Supabase](https://supabase.com) and create a new project
2. Choose a region close to your users (e.g., `ap-south-1` for Iran/India)
3. Wait for the project to be ready (1-2 minutes)
4. Go to **Settings** → **Database** and copy the **Connection string** (URI format)
5. It looks like: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

### Enable Prisma Extensions (Recommended)

Supabase works best with Prisma using the `pgbouncer` connection string (port 6543) for serverless deployments.

## Step 2: Configure Environment Variables on Render

Create a **Blueprint** or **Web Service** on Render and set these environment variables:

```bash
# Database (Supabase)
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Backend
NODE_ENV=production
PORT=3000
BIND_HOST=0.0.0.0
JWT_SECRET=<generate with: openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48>
JWT_EXPIRES_IN=30d

# Branding
APP_NAME_FA=ویزیتیک
APP_NAME_EN=Vizitik

# Bale Bot (optional)
BALE_BOT_TOKEN=
BALE_BOT_USERNAME=
BALE_ADMIN_CHAT_ID=

# Frontend
VITE_API_URL=/api
```

### Generate JWT_SECRET

Run this command to generate a secure JWT secret:
```bash
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48
```

## Step 3: Update Prisma Schema for PostgreSQL

The default schema uses MySQL. For Supabase (PostgreSQL), make these changes in `backend/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"  // Change from mysql
  url      = env("DATABASE_URL")
}

// ... rest of schema remains the same
```

## Step 4: Deploy to Render

### Option A: Using render.yaml (Recommended)

1. Create a `render.yaml` file in your repo root:

```yaml
services:
  - type: web
    name: vizitik-backend
    runtime: node
    plan: free
    buildCommand: cd backend && npm install && npx prisma generate && npm run build
    startCommand: cd backend && node dist/main.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        sync: false  # Set manually in Render dashboard
      - key: JWT_SECRET
        generateValue: true
      - key: JWT_EXPIRES_IN
        value: 30d
      - key: PORT
        value: 3000
      - key: BIND_HOST
        value: 0.0.0.0
      - key: APP_NAME_FA
        value: ویزیتیک
      - key: APP_NAME_EN
        value: Vizitik
```

2. Go to Render Dashboard → **New** → **Blueprint**
3. Connect your GitHub repo
4. Render will detect `render.yaml` and set up the service
5. Add the `DATABASE_URL` manually in the environment variables

### Option B: Manual Setup

1. Go to Render Dashboard → **New** → **Web Service**
2. Connect your GitHub repo
3. Configure:
   - **Name**: `vizitik-backend`
   - **Runtime**: Node
   - **Plan**: Free (or Starter for production)
   - **Build Command**:
     ```bash
     cd backend && npm install && npx prisma generate && npm run build
     ```
   - **Start Command**:
     ```bash
     cd backend && node dist/main.js
     ```
4. Add all environment variables from Step 2
5. Click **Create Web Service**

## Step 5: Run Database Migrations

After the first deploy, you need to push the schema to Supabase:

### Option 1: Render Shell

1. Go to your Render service → **Shell**
2. Run:
   ```bash
   cd backend
   npx prisma db push
   ```

### Option 2: Local Command

Run this from your local machine (make sure `DATABASE_URL` points to Supabase):
```bash
cd backend
npx prisma db push
```

## Step 6: Deploy Frontend (Optional)

If you want to serve the frontend from Render too:

1. Create another **Web Service** or use **Static Site**
2. Build command:
   ```bash
   cd frontend-app && npm install && npm run build
   ```
3. Start command: `npx serve frontend-app/dist` (for static) or configure as needed
4. Set `VITE_API_URL` to your backend URL (e.g., `https://vizitik-backend.onrender.com/api`)

**Note**: The free tier spins down after inactivity. First request may take 30-60 seconds.

## Step 7: Custom Domain (Optional)

1. In Render dashboard, go to **Settings** → **Custom Domains**
2. Add your domain (e.g., `app.vizitik.ir`)
3. Update your DNS:
   - Add a CNAME record pointing to `vizitik-backend.onrender.com`
4. SSL is automatic with Render

## Step 8: Initial Data Setup

After deployment, you'll need to create an admin user. Use the Render Shell:

```bash
cd backend
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('admin123', 10);
  const user = await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'User',
      phone: '09120000000',
      passwordHash: hash,
      role: 'ADMIN',
    },
  });
  console.log('Admin user created:', user.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.\$disconnect());
"
```

## Troubleshooting

### Build Fails with Memory Error

Render free tier has 512MB RAM. If build fails:

1. Upgrade to Starter plan (512MB → 2GB)
2. Or optimize build:
   ```bash
   NODE_OPTIONS="--max-old-space-size=384" npm run build
   ```

### Database Connection Errors

- Ensure `DATABASE_URL` uses the pooler port (6543), not direct (5432)
- Check Supabase dashboard for connection limits
- Free tier: 60 concurrent connections

### Prisma Push Fails

If `prisma db push` fails on Render Shell, try:
```bash
cd backend
npx prisma generate
npx prisma db push --skip-generate
```

### Cold Start (Free Tier)

Free tier spins down after 15 minutes of inactivity. First request takes 30-60 seconds. Solutions:
1. Upgrade to Starter plan ($7/month)
2. Use a cron pinger (e.g., UptimeRobot) to keep it awake

## Production Recommendations

1. **Upgrade to Starter Plan** ($7/month): No spin-down, better performance
2. **Use Connection Pooling**: Supabase pooler (port 6543) handles this automatically
3. **Enable Backups**: Supabase free tier includes daily backups
4. **Set Up Monitoring**: Use Render's built-in metrics or external tools
5. **Custom Domain**: Essential for PWA installation and professional appearance

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT tokens (generate with openssl) |
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | Yes | Port for the backend (3000) |
| `BIND_HOST` | Yes | Set to `0.0.0.0` for Render |
| `APP_NAME_EN` | No | App name in English (default: Vizitik) |
| `APP_NAME_FA` | No | App name in Persian (default: ویزیتیک) |
| `BALE_BOT_TOKEN` | No | Bale bot token for notifications |
| `BALE_BOT_USERNAME` | No | Bale bot username |
| `VITE_API_URL` | For frontend | API URL for frontend build |

## Cost Estimate

- **Supabase Free Tier**: 500MB database, 50K monthly active users
- **Render Free Tier**: 750 hours/month, spins down after inactivity
- **Render Starter**: $7/month, no spin-down, better performance

**Total**: $0-7/month depending on tier choices

## Next Steps

1. Set up automatic deployments from GitHub
2. Configure backups
3. Set up monitoring and alerts
4. Add custom domain and SSL
5. Deploy frontend separately or use a CDN
