-- Grocery List Database Schema
-- This schema supports collaborative grocery lists with frequency tracking

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Grocery Lists Table
-- Each list represents a shopping trip (current or archived)
CREATE TABLE IF NOT EXISTS grocery_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    archived_at TIMESTAMP WITH TIME ZONE,
    is_archived BOOLEAN DEFAULT FALSE,
    -- For collaborative lists, we track the "owner" but allow family sharing
    family_id UUID -- Optional: for multi-user families
);

-- Grocery Items Table
-- Items belong to a specific list
CREATE TABLE IF NOT EXISTS grocery_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    list_id UUID REFERENCES grocery_lists(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity TEXT, -- e.g., "2", "1 lb", "3 cans"
    category TEXT, -- produce, dairy, meat, etc.
    is_checked BOOLEAN DEFAULT FALSE,
    added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    checked_at TIMESTAMP WITH TIME ZONE,
    notes TEXT
);

-- Frequent Items Tracker
-- Tracks items that appear across multiple lists to suggest them
CREATE TABLE IF NOT EXISTS frequent_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    frequency_count INTEGER DEFAULT 1, -- How many times this item was purchased
    last_purchased TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    typical_quantity TEXT, -- Most common quantity
    UNIQUE(user_id, name)
);

-- Family Groups Table
-- Each group allows multiple users to share grocery lists
CREATE TABLE IF NOT EXISTS family_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Family Members Table
-- Tracks invitations and memberships within a family group
CREATE TABLE IF NOT EXISTS family_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_group_id UUID REFERENCES family_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending' or 'accepted'
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(family_group_id, email)
);

-- User Phone Numbers Table
-- Maps phone numbers to users for SMS integration
CREATE TABLE IF NOT EXISTS user_phones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(phone_number)
);

CREATE INDEX IF NOT EXISTS idx_user_phones_phone ON user_phones(phone_number);
CREATE INDEX IF NOT EXISTS idx_user_phones_user ON user_phones(user_id);

ALTER TABLE user_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own phone numbers"
    ON user_phones FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own phone numbers"
    ON user_phones FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own phone numbers"
    ON user_phones FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own phone numbers"
    ON user_phones FOR DELETE
    USING (auth.uid() = user_id);

-- Service role can read all phone numbers (for SMS webhook)
CREATE POLICY "Service role can read all phones"
    ON user_phones FOR SELECT
    USING (true);

-- SMS/Email Integration Log
-- Tracks items added via SMS or email
CREATE TABLE IF NOT EXISTS integration_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    source TEXT NOT NULL, -- 'sms' or 'email'
    raw_message TEXT,
    items_added JSONB, -- Array of items that were parsed and added
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Item Category Overrides Table
-- When a user recategorizes an item, save the mapping so future adds use it
CREATE TABLE IF NOT EXISTS item_category_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL, -- lowercase normalized name
    category TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, item_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_grocery_lists_user_id ON grocery_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_grocery_lists_archived ON grocery_lists(is_archived);
CREATE INDEX IF NOT EXISTS idx_grocery_items_list_id ON grocery_items(list_id);
CREATE INDEX IF NOT EXISTS idx_grocery_items_checked ON grocery_items(is_checked);

-- Prevent duplicate items (by name) within the same list
-- Uses lower(name) for case-insensitive matching
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_item_name_per_list
  ON grocery_items(list_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_frequent_items_user_id ON frequent_items(user_id);
CREATE INDEX IF NOT EXISTS idx_frequent_items_frequency ON frequent_items(frequency_count DESC);
CREATE INDEX IF NOT EXISTS idx_family_groups_created_by ON family_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_family_members_family_group_id ON family_members(family_group_id);
CREATE INDEX IF NOT EXISTS idx_family_members_email ON family_members(email);
CREATE INDEX IF NOT EXISTS idx_item_category_overrides_user ON item_category_overrides(user_id);

-- NOTE: The old unique constraint (idx_unique_active_list_per_user) that
-- limited each user to one active list has been removed. The application
-- now handles list lifecycle properly: when a new list is created,
-- existing active lists are archived first. The constraint caused silent
-- insert failures in edge cases (e.g. family_id mismatch on reload).
--
-- To drop the old constraint from an existing database, run:
--   DROP INDEX IF EXISTS idx_unique_active_list_per_user;

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE grocery_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE grocery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE frequent_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_category_overrides ENABLE ROW LEVEL SECURITY;

-- Grocery Lists Policies
-- Users can read their own lists, lists tagged with their family_id,
-- AND lists owned by any member of their family group (even if family_id isn't set)
CREATE POLICY "Users can view their own lists"
    ON grocery_lists FOR SELECT
    USING (
        auth.uid() = user_id
        OR family_id IN (SELECT family_group_id FROM family_members WHERE user_id = auth.uid())
        OR user_id IN (
            SELECT fm2.user_id FROM family_members fm1
            JOIN family_members fm2 ON fm1.family_group_id = fm2.family_group_id
            WHERE fm1.user_id = auth.uid() AND fm2.status = 'accepted'
        )
    );

-- Users can insert their own lists
CREATE POLICY "Users can create lists"
    ON grocery_lists FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own lists and family lists
CREATE POLICY "Users can update their own lists"
    ON grocery_lists FOR UPDATE
    USING (
        auth.uid() = user_id
        OR family_id IN (SELECT family_group_id FROM family_members WHERE user_id = auth.uid())
        OR user_id IN (
            SELECT fm2.user_id FROM family_members fm1
            JOIN family_members fm2 ON fm1.family_group_id = fm2.family_group_id
            WHERE fm1.user_id = auth.uid() AND fm2.status = 'accepted'
        )
    );

-- Users can delete their own lists
CREATE POLICY "Users can delete their own lists"
    ON grocery_lists FOR DELETE
    USING (auth.uid() = user_id);

-- Grocery Items Policies
-- Users can view items in their lists and family lists
CREATE POLICY "Users can view items in their lists"
    ON grocery_items FOR SELECT
    USING (
        list_id IN (
            SELECT id FROM grocery_lists
            WHERE user_id = auth.uid()
            OR family_id IN (SELECT family_group_id FROM family_members WHERE user_id = auth.uid())
            OR user_id IN (
                SELECT fm2.user_id FROM family_members fm1
                JOIN family_members fm2 ON fm1.family_group_id = fm2.family_group_id
                WHERE fm1.user_id = auth.uid() AND fm2.status = 'accepted'
            )
        )
    );

-- Users can add items to their lists and family lists
CREATE POLICY "Users can add items to their lists"
    ON grocery_items FOR INSERT
    WITH CHECK (
        list_id IN (
            SELECT id FROM grocery_lists
            WHERE user_id = auth.uid()
            OR family_id IN (SELECT family_group_id FROM family_members WHERE user_id = auth.uid())
            OR user_id IN (
                SELECT fm2.user_id FROM family_members fm1
                JOIN family_members fm2 ON fm1.family_group_id = fm2.family_group_id
                WHERE fm1.user_id = auth.uid() AND fm2.status = 'accepted'
            )
        )
    );

-- Users can update items in their lists and family lists
CREATE POLICY "Users can update items in their lists"
    ON grocery_items FOR UPDATE
    USING (
        list_id IN (
            SELECT id FROM grocery_lists
            WHERE user_id = auth.uid()
            OR family_id IN (SELECT family_group_id FROM family_members WHERE user_id = auth.uid())
            OR user_id IN (
                SELECT fm2.user_id FROM family_members fm1
                JOIN family_members fm2 ON fm1.family_group_id = fm2.family_group_id
                WHERE fm1.user_id = auth.uid() AND fm2.status = 'accepted'
            )
        )
    );

-- Users can delete items from their lists and family lists
CREATE POLICY "Users can delete items from their lists"
    ON grocery_items FOR DELETE
    USING (
        list_id IN (
            SELECT id FROM grocery_lists
            WHERE user_id = auth.uid()
            OR family_id IN (SELECT family_group_id FROM family_members WHERE user_id = auth.uid())
            OR user_id IN (
                SELECT fm2.user_id FROM family_members fm1
                JOIN family_members fm2 ON fm1.family_group_id = fm2.family_group_id
                WHERE fm1.user_id = auth.uid() AND fm2.status = 'accepted'
            )
        )
    );

-- Frequent Items Policies
CREATE POLICY "Users can view their own frequent items"
    ON frequent_items FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own frequent items"
    ON frequent_items FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Item Category Overrides Policies
-- Users can view their own overrides + overrides from family members
CREATE POLICY "Users can view category overrides"
    ON item_category_overrides FOR SELECT
    USING (
        auth.uid() = user_id
        OR user_id IN (
            SELECT fm2.user_id FROM family_members fm1
            JOIN family_members fm2 ON fm1.family_group_id = fm2.family_group_id
            WHERE fm1.user_id = auth.uid() AND fm2.status = 'accepted'
        )
    );

CREATE POLICY "Users can manage their own category overrides"
    ON item_category_overrides FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Family Groups Policies
CREATE POLICY "Users can view their family groups"
    ON family_groups FOR SELECT
    USING (
        created_by = auth.uid()
        OR id IN (SELECT family_group_id FROM family_members WHERE user_id = auth.uid())
    );

CREATE POLICY "Users can create family groups"
    ON family_groups FOR INSERT
    WITH CHECK (auth.uid() = created_by);

-- Helper function to look up family group IDs without triggering RLS recursion
CREATE OR REPLACE FUNCTION get_user_family_group_ids(uid UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT family_group_id FROM family_members WHERE user_id = uid;
$$;

-- Family Members Policies
-- Note: Uses auth.jwt() ->> 'email' instead of SELECT FROM auth.users (which
-- is not accessible to authenticated role), and get_user_family_group_ids()
-- to avoid infinite recursion in the self-referencing subquery.
CREATE POLICY "Users can view their family members"
    ON family_members FOR SELECT
    USING (
        user_id = auth.uid()
        OR email = (auth.jwt() ->> 'email')
        OR family_group_id IN (SELECT get_user_family_group_ids(auth.uid()))
    );

CREATE POLICY "Users can invite family members"
    ON family_members FOR INSERT
    WITH CHECK (
        invited_by = auth.uid()
    );

CREATE POLICY "Users can accept their own invites"
    ON family_members FOR UPDATE
    USING (
        email = (auth.jwt() ->> 'email')
    );

-- Integration Log Policies
CREATE POLICY "Users can view their own integration logs"
    ON integration_log FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert integration logs"
    ON integration_log FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_grocery_lists_updated_at ON grocery_lists;
CREATE TRIGGER update_grocery_lists_updated_at
    BEFORE UPDATE ON grocery_lists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update frequent items when a list is archived
CREATE OR REPLACE FUNCTION update_frequent_items_on_archive()
RETURNS TRIGGER AS $$
BEGIN
    -- When a list is archived, increment frequency count for all items in that list
    IF NEW.is_archived = TRUE AND OLD.is_archived = FALSE THEN
        INSERT INTO frequent_items (user_id, name, category, frequency_count, last_purchased, typical_quantity)
        SELECT
            NEW.user_id,
            gi.name,
            gi.category,
            1,
            NOW(),
            gi.quantity
        FROM grocery_items gi
        WHERE gi.list_id = NEW.id AND gi.is_checked = TRUE
        ON CONFLICT (user_id, name)
        DO UPDATE SET
            frequency_count = frequent_items.frequency_count + 1,
            last_purchased = NOW(),
            typical_quantity = CASE
                WHEN EXCLUDED.typical_quantity IS NOT NULL THEN EXCLUDED.typical_quantity
                ELSE frequent_items.typical_quantity
            END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_frequent_items_trigger ON grocery_lists;
CREATE TRIGGER update_frequent_items_trigger
    AFTER UPDATE ON grocery_lists
    FOR EACH ROW
    EXECUTE FUNCTION update_frequent_items_on_archive();

-- Grant permissions (covers all tables including family_groups)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
