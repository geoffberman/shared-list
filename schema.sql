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

-- Family Members Table (Optional for sharing)
-- Allows multiple users to share the same grocery list
CREATE TABLE IF NOT EXISTS family_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    role TEXT DEFAULT 'member', -- 'owner' or 'member'
    UNIQUE(family_id, user_id)
);

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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_grocery_lists_user_id ON grocery_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_grocery_lists_archived ON grocery_lists(is_archived);
CREATE INDEX IF NOT EXISTS idx_grocery_items_list_id ON grocery_items(list_id);
CREATE INDEX IF NOT EXISTS idx_grocery_items_checked ON grocery_items(is_checked);
CREATE INDEX IF NOT EXISTS idx_frequent_items_user_id ON frequent_items(user_id);
CREATE INDEX IF NOT EXISTS idx_frequent_items_frequency ON frequent_items(frequency_count DESC);
CREATE INDEX IF NOT EXISTS idx_family_members_family_id ON family_members(family_id);

-- Unique constraint: Only one active (non-archived) list per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_list_per_user
    ON grocery_lists(user_id)
    WHERE is_archived = FALSE;

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE grocery_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE grocery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE frequent_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_log ENABLE ROW LEVEL SECURITY;

-- Grocery Lists Policies
-- Users can read their own lists and lists from their family
CREATE POLICY "Users can view their own lists"
    ON grocery_lists FOR SELECT
    USING (
        auth.uid() = user_id
        OR family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    );

-- Users can insert their own lists
CREATE POLICY "Users can create lists"
    ON grocery_lists FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own lists
CREATE POLICY "Users can update their own lists"
    ON grocery_lists FOR UPDATE
    USING (
        auth.uid() = user_id
        OR family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
    );

-- Users can delete their own lists
CREATE POLICY "Users can delete their own lists"
    ON grocery_lists FOR DELETE
    USING (auth.uid() = user_id);

-- Grocery Items Policies
-- Users can view items in their lists
CREATE POLICY "Users can view items in their lists"
    ON grocery_items FOR SELECT
    USING (
        list_id IN (
            SELECT id FROM grocery_lists
            WHERE user_id = auth.uid()
            OR family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
        )
    );

-- Users can add items to their lists
CREATE POLICY "Users can add items to their lists"
    ON grocery_items FOR INSERT
    WITH CHECK (
        list_id IN (
            SELECT id FROM grocery_lists
            WHERE user_id = auth.uid()
            OR family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
        )
    );

-- Users can update items in their lists
CREATE POLICY "Users can update items in their lists"
    ON grocery_items FOR UPDATE
    USING (
        list_id IN (
            SELECT id FROM grocery_lists
            WHERE user_id = auth.uid()
            OR family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
        )
    );

-- Users can delete items from their lists
CREATE POLICY "Users can delete items from their lists"
    ON grocery_items FOR DELETE
    USING (
        list_id IN (
            SELECT id FROM grocery_lists
            WHERE user_id = auth.uid()
            OR family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
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

-- Family Members Policies
CREATE POLICY "Users can view their family members"
    ON family_members FOR SELECT
    USING (auth.uid() = user_id OR family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid()));

CREATE POLICY "Family owners can manage members"
    ON family_members FOR ALL
    USING (
        family_id IN (
            SELECT family_id FROM family_members
            WHERE user_id = auth.uid() AND role = 'owner'
        )
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

CREATE TRIGGER update_frequent_items_trigger
    AFTER UPDATE ON grocery_lists
    FOR EACH ROW
    EXECUTE FUNCTION update_frequent_items_on_archive();

-- Grant permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
