# Grocery App Setup Guide

## Quick Start

### 1. Create Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **"New Project"**
3. Enter:
   - **Name:** `family-grocery-list`
   - **Database Password:** (choose a strong password and save it!)
   - **Region:** Choose closest to you
4. Click **"Create new project"**
5. Wait 2-3 minutes for provisioning

### 2. Run Database Schema

1. In your new project, click **"SQL Editor"** in left sidebar
2. Click **"New Query"**
3. Copy and paste the entire contents of `grocery/schema.sql`
4. Click **"Run"** or press Ctrl+Enter
5. You should see "Success" message

### 3. Get API Credentials

1. Go to **Settings** (gear icon) → **API**
2. Copy these two values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

### 4. Update App Configuration

Open `grocery/supabase-client.js` and replace:

```javascript
const SUPABASE_URL = 'YOUR_GROCERY_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_GROCERY_SUPABASE_ANON_KEY';
```

With your actual values:

```javascript
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGc...your-actual-key...';
```

### 5. Deploy

Push your changes:

```bash
git add grocery/supabase-client.js
git commit -m "Configure grocery app Supabase credentials"
git push
```

### 6. Test

Visit your app at:
```
https://yourdomain.com/grocery/
```

Try:
- Sign up for an account
- Add some items
- Check them off
- Archive the list
- Start a new list (should auto-add frequent items!)

---

## Optional: SMS/Email Integration

### SMS Setup (Twilio)

1. Sign up at [twilio.com](https://www.twilio.com)
2. Get a phone number
3. Configure webhook:
   - URL: `https://yourdomain.com/api/grocery/webhook`
   - Method: POST
4. Update `grocery/index.html` line with your Twilio number:
   ```html
   <code id="sms-number">+1 (YOUR-NUMBER)</code>
   ```

5. Test by texting: "Grocery list: milk, bread, eggs"

### Email Setup (SendGrid)

1. Sign up at [sendgrid.com](https://sendgrid.com)
2. Set up Inbound Parse
3. Configure domain: `grocery@yourdomain.com`
4. Webhook URL: `https://yourdomain.com/api/grocery/webhook`
5. Update `grocery/index.html`:
   ```html
   <code id="email-address">grocery@yourdomain.com</code>
   ```

6. Test by emailing with subject "Grocery list"

---

## Troubleshooting

### "Can't connect to database"
- Check that you ran the schema.sql
- Verify your credentials in supabase-client.js
- Check browser console for errors

### "Permission denied"
- Make sure RLS policies were created (they're in schema.sql)
- Try signing out and back in

### Items not saving
- Check browser console for errors
- Verify you're signed in (or using skip auth)
- Items save to localStorage if no Supabase connection

### Frequent items not showing
- You need to archive a list first
- Only checked items become "frequent"
- Archive at least 2-3 lists to build up frequency data

---

## Environment Variables (for Vercel)

If you want to use server-side features (webhooks), add these to Vercel:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Get service role key from: Supabase Settings → API → service_role key

---

## Database Backup

To backup your grocery data:

1. Go to Supabase Dashboard → Database → Backups
2. Enable automatic backups (recommended)
3. Or manually export: Database → Export

---

## Support

If you need help:
1. Check browser console for errors
2. Review this setup guide
3. Check `grocery/README.md` for feature documentation
