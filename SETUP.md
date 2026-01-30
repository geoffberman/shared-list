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

## SMS Integration (Text-to-List via Twilio)

Users and family members can add items to the active grocery list by texting them to a Twilio phone number. Here's how to set it up:

### Step 1: Create a Twilio Account

1. Sign up at [twilio.com](https://www.twilio.com)
2. Complete verification (free trial works)
3. From the console, note your **Account SID** and **Auth Token**

### Step 2: Get a Twilio Phone Number

1. In Twilio Console → **Phone Numbers** → **Buy a Number**
2. Choose a number with **SMS** capability
3. Note the number (e.g. `+15551234567`)

### Step 3: Run the Database Schema

Make sure you've run the latest `schema.sql` in your Supabase SQL Editor. It includes the `user_phones` table needed for phone number registration.

### Step 4: Deploy the Supabase Edge Function

1. Install the Supabase CLI: `npm install -g supabase`
2. Link to your project:
   ```bash
   cd shared-list
   supabase login
   supabase link --project-ref ilinxxocqvgncglwbvom
   ```
3. Deploy the SMS function:
   ```bash
   supabase functions deploy receive-sms --no-verify-jwt
   ```
   The `--no-verify-jwt` flag is required because Twilio sends unauthenticated webhooks.

4. Note the function URL. It will be:
   ```
   https://ilinxxocqvgncglwbvom.supabase.co/functions/v1/receive-sms
   ```

### Step 5: Configure the Twilio Webhook

1. In Twilio Console → **Phone Numbers** → click your number
2. Under **Messaging** → **A Message Comes In**:
   - Set to **Webhook**
   - URL: `https://ilinxxocqvgncglwbvom.supabase.co/functions/v1/receive-sms`
   - Method: **HTTP POST**
3. Click **Save**

### Step 6: Set the SMS Number in the App

Add a `data-sms-number` attribute to the `<body>` tag in `index.html`, or store it in localStorage:

```javascript
localStorage.setItem('smsNumber', '+15551234567');
```

Replace with your actual Twilio number. This displays in Settings so users know where to text.

### Step 7: Register Phone Numbers

Each user/family member should:
1. Open the app → **Settings** → **Text-to-List (SMS)**
2. Enter their phone number and click **Save**
3. They can now text items to the Twilio number

### How It Works

- User texts: `milk, eggs, bread, bananas`
- Twilio forwards the SMS to the Supabase Edge Function
- The function looks up the sender's phone number in `user_phones`
- Finds their active grocery list (or their family group's list)
- Parses the items (comma-separated or one per line)
- Auto-categorizes each item and inserts into the list
- Sends a reply SMS confirming what was added

### SMS Format Examples

```
milk, eggs, bread
```
```
chicken breast
broccoli
rice
canned beans
```
```
steak and potatoes and salad
```

---

## Email Invitations (via Resend)

When you invite a family member, the app sends them an email with a link to join. This uses [Resend](https://resend.com) for email delivery.

### Step 1: Create a Resend Account

1. Sign up at [resend.com](https://resend.com) (free tier: 100 emails/day)
2. Go to **API Keys** → **Create API Key**
3. Copy the key (starts with `re_...`)

### Step 2: Store the API Key as a Supabase Secret

```bash
supabase secrets set RESEND_API_KEY=re_your_api_key_here
```

### Step 3: Deploy the Email Edge Function

```bash
supabase functions deploy send-invite-email --no-verify-jwt
```

### Step 4 (Optional): Custom From Address

By default, emails come from `Shared List <onboarding@resend.dev>` (Resend's test domain). To use your own domain:

1. In Resend → **Domains** → **Add Domain** → follow DNS verification
2. Set the custom from address:
   ```bash
   supabase secrets set FROM_EMAIL="Shared List <noreply@yourdomain.com>"
   ```

### How It Works

- You enter an email in Settings → Family Group → Send Invite
- The app creates a `family_members` record with status "pending"
- The app calls the `send-invite-email` Edge Function
- The function sends a styled HTML email via Resend with a link to the app
- When the invitee signs up with that email, the app detects the pending invite and shows an accept prompt

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
