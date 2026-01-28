# Family Grocery List App 🛒

A collaborative, smart grocery list app built for families. Track frequent purchases, sync across devices, and add items via SMS or email.

## Features

### Core Features ✨

1. **Collaborative Lists**
   - Multiple family members can access and edit the same list
   - Real-time sync across all devices via Supabase
   - See who added each item

2. **Smart Frequent Items**
   - Automatically tracks items you buy frequently
   - "Start New List" auto-adds your frequent purchases
   - Learn from your shopping patterns over time

3. **List Management**
   - Create dated lists (e.g., "List - Jan 22, 2026")
   - Archive completed lists for shopping history
   - View past shopping trips and what you bought

4. **SMS Integration** 📱
   - Text items to a dedicated phone number
   - Format: "Grocery list: milk, bread, eggs, 2 lb chicken"
   - Items automatically parsed and added to your current list

5. **Email Integration** 📧
   - Email your list to a dedicated address
   - Subject: "Grocery list"
   - Body: list of items (one per line or comma-separated)

6. **Smart Features**
   - Categories: Automatically categorize items (produce, dairy, meat, etc.)
   - Quantities: Track how much you need (e.g., "2 gallons", "3 lbs")
   - Checkoff: Mark items as you shop
   - Group by category: Organize your list by store section

### Progressive Web App 📲

- Install on your phone like a native app
- Works offline with local storage
- Fast, responsive, mobile-first design
- Matches the design of the Better Coffee app

## Getting Started

### For Users

1. **Visit the App**
   - Navigate to `https://yourdomain.com/grocery/`
   - Or add `/grocery/` to your current domain

2. **Sign Up (Optional)**
   - Create an account to sync across devices
   - Or skip sign-in to use locally (data stored in browser)

3. **Add Items**
   - Type item name, quantity, and category
   - Or click on frequent items for quick add
   - Or text/email items (see integration setup below)

4. **Shop**
   - Check off items as you shop
   - Archive the list when done

5. **Start New List**
   - Click "Start New List" button
   - Frequent items automatically added (if enabled)
   - Previous list archived to history

### For Developers

#### 1. Database Setup

Run the SQL schema in Supabase:

```bash
# In Supabase SQL Editor, run:
# grocery/schema.sql
```

This creates the following tables:
- `grocery_lists` - Lists with date/archive status
- `grocery_items` - Individual items on lists
- `frequent_items` - Tracks purchase frequency
- `family_members` - For sharing lists (optional)
- `integration_log` - SMS/email integration logs

#### 2. Environment Variables

Add to your Vercel environment variables:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

#### 3. SMS Integration Setup (Twilio)

1. **Create Twilio Account**
   - Sign up at [twilio.com](https://www.twilio.com)
   - Get a phone number

2. **Configure Webhook**
   - In Twilio console, set webhook URL to:
     ```
     https://yourdomain.com/api/grocery/webhook
     ```
   - Method: POST
   - Message format: URL-encoded

3. **Update Settings**
   - Update the SMS number in `grocery/index.html`:
     ```html
     <code id="sms-number">+1 (YOUR-TWILIO-NUMBER)</code>
     ```

4. **Test**
   - Text your Twilio number: "Grocery list: milk, bread, eggs"
   - Items should appear in your current list

#### 4. Email Integration Setup (SendGrid)

1. **Create SendGrid Account**
   - Sign up at [sendgrid.com](https://sendgrid.com)
   - Create an Inbound Parse webhook

2. **Configure Domain**
   - Set up domain: `grocery@yourdomain.com`
   - Or use subdomain: `grocery@grocery.yourdomain.com`

3. **Set Webhook URL**
   - Inbound Parse URL:
     ```
     https://yourdomain.com/api/grocery/webhook
     ```

4. **Update Settings**
   - Update the email in `grocery/index.html`:
     ```html
     <code id="email-address">grocery@yourdomain.com</code>
     ```

5. **Test**
   - Email grocery@yourdomain.com
   - Subject: "Grocery list"
   - Body: "milk, bread, eggs, 2 lb chicken"

## How It Works

### Data Flow

```
User → Add Item → Supabase Database → Real-time Sync → All Devices
                 ↓
            localStorage (backup)

SMS/Email → Webhook → Parse Items → Add to Database → Sync
```

### Frequent Items Algorithm

1. When you archive a list, all checked items are counted
2. Frequency counter increments for each checked item
3. Items sorted by frequency count
4. Top 5-10 items shown as "frequent items"
5. When starting a new list, top 5 auto-added (if enabled)

### Smart Parsing

The webhook intelligently parses messages:

```
"Grocery list: milk, 2 lb chicken, bread, 3 cans soup"
  ↓
[
  { name: "Milk", quantity: null, category: "dairy" },
  { name: "Chicken", quantity: "2 lb", category: "meat" },
  { name: "Bread", quantity: null, category: "bakery" },
  { name: "Soup", quantity: "3 cans", category: "pantry" }
]
```

Categories auto-detected based on keywords.

## Usage Examples

### Adding Items

**Via Web:**
```
Item: Milk
Qty: 2 gallons
Category: Dairy
[Add]
```

**Via SMS:**
```
Text to: +1 (555) 123-4567
"Grocery list: milk, bread, eggs, 2 lb chicken"
```

**Via Email:**
```
To: grocery@yourdomain.com
Subject: Grocery list
Body:
milk
bread
eggs
2 lb chicken
```

### Starting New List

1. Click "Start New List"
2. Confirms archival of current list
3. Creates new list with today's date
4. Auto-adds frequent items (if enabled)

## Settings

- **Auto-add frequent items**: Toggle on/off
- **Group by category**: Organize list by store sections
- **View shopping history**: See past archived lists
- **Clear frequent items**: Reset frequency tracking

## Architecture

### Frontend
- Vanilla JavaScript (no framework dependencies)
- Supabase client for real-time sync
- localStorage fallback for offline use
- CSS with design matching Better Coffee app

### Backend
- Supabase (PostgreSQL) for database
- Vercel serverless functions for webhooks
- Row-level security (RLS) for data privacy

### Database Schema

```sql
grocery_lists
├── id (UUID)
├── user_id (UUID)
├── name (TEXT)
├── created_at (TIMESTAMP)
├── archived_at (TIMESTAMP)
└── is_archived (BOOLEAN)

grocery_items
├── id (UUID)
├── list_id (UUID)
├── name (TEXT)
├── quantity (TEXT)
├── category (TEXT)
├── is_checked (BOOLEAN)
└── added_by (UUID)

frequent_items
├── id (UUID)
├── user_id (UUID)
├── name (TEXT)
├── frequency_count (INTEGER)
└── typical_quantity (TEXT)
```

## Future Enhancements

Ideas for additional features:

1. **Recipe Integration**
   - Import ingredients from recipes
   - Link to meal planning

2. **Barcode Scanning**
   - Scan items to add to list
   - Price tracking

3. **Store Maps**
   - Optimize route through store
   - Find items faster

4. **Price Tracking**
   - Track prices over time
   - Find best deals

5. **Meal Planning**
   - Plan weekly meals
   - Auto-generate grocery list

6. **Voice Commands**
   - "Add milk to grocery list"
   - Hands-free shopping

7. **Sharing**
   - Share lists with roommates
   - Family group lists

8. **Notifications**
   - Remind when near store
   - Alert when list updated

9. **Receipt Scanning**
   - Scan receipt to mark items purchased
   - Track spending

10. **Smart Suggestions**
    - "You usually buy eggs when you buy milk"
    - Seasonal recommendations

## Support

For issues or questions:
1. Check the browser console for errors
2. Verify Supabase connection
3. Check webhook configuration
4. Review RLS policies

## License

MIT License - feel free to use and modify!

---

Built with ❤️ for families who want to simplify grocery shopping.
