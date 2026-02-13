// Supabase Edge Function: sync-from-skylight
// Pulls items from Skylight Calendar grocery list and adds them to the web app
// Can be called manually via button or by scheduled cron job

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface SkylightListItem {
  id: string;
  type: "list_item";
  attributes: {
    label: string;
    status: "incomplete" | "complete";
    section: string | null;
  };
}

interface SkylightListItemsResponse {
  data: SkylightListItem[];
}

// Auto-categorize function (same as receive-sms)
function autoCategorize(itemName: string): string {
  const name = itemName.toLowerCase();

  if (/bread|bun\b|rolls?\b|bagel|croissant|muffin|donut|cake\b|cookie|pastry|biscuit|scone|waffle|pancake|tortilla|pita/.test(name)) return "bakery";
  if (/cheese|cheddar|mozzarella|parmesan|brie|feta|gouda|swiss|provolone/.test(name)) return "cheese";
  if (/chicken|beef|pork|fish|turkey|lamb|meat|steak|bacon|sausage|hamburger|ham\b|salmon|tuna|shrimp|ribs?\b|roast|brisket|chop|wing|thigh|breast|drumstick|ground\b|hot dog|bratwurst|jerky|veal|venison/.test(name)) return "meat";
  if (/rice|pasta|bean|soup|sauce|oil\b|vinegar|spice|flour|sugar|salt\b|pepper|cereal|oat|jar|noodle|pickle|canned|broth|ketchup|mustard|mayo|honey|syrup|peanut butter|jelly|jam/.test(name)) return "pantry";
  if (/milk|yogurt|butter|cream\b|eggs?\b/.test(name)) return "dairy";
  if (/apple|banana|orange|grape|berry|lettuce|tomato|potato|onion|carrot|celery|spinach|kale|broccoli|cucumber|bell pepper|jalape|fruit|vegetable|avocado|lemon|lime|garlic|mushroom|zucchini|squash|corn\b|peas?\b|peach|pear\b|plum|mango|melon|watermelon|cantaloupe|pineapple|cherry|cabbage|cauliflower|asparagus|radish|beet|turnip|herb|cilantro|parsley|basil|ginger|green onion|scallion/.test(name)) return "produce";
  if (/frozen|ice cream|pizza|fries|popsicle/.test(name)) return "frozen";
  if (/water\b|juice|soda|coffee|\btea\b|wine\b|beer|kombucha|drink|sparkling/.test(name)) return "beverages";
  if (/chips?\b|cracker|nuts?\b|popcorn|pretzel|trail mix|granola|candy|chocolate/.test(name)) return "snacks";
  if (/soap|detergent|paper\b|towel|tissue|trash|bags?\b|sponge|cleaner|bleach|wrap\b|foil|plastic/.test(name)) return "household";

  return "";
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // Get Skylight credentials — use email/password login (same as sync-skylight)
    const skylightEmail = Deno.env.get("SKYLIGHT_EMAIL");
    const skylightPassword = Deno.env.get("SKYLIGHT_PASSWORD");
    const frameId = Deno.env.get("SKYLIGHT_FRAME_ID");

    if (!skylightEmail || !skylightPassword || !frameId) {
      return new Response(
        JSON.stringify({ error: "Skylight not configured", details: "Missing SKYLIGHT_EMAIL, SKYLIGHT_PASSWORD, or SKYLIGHT_FRAME_ID" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body for user context (optional - for manual sync)
    let targetUserId: string | null = null;
    try {
      const body = await req.json();
      targetUserId = body.userId || null;
    } catch {
      // No body or invalid JSON - that's ok for cron calls
    }

    // Connect to Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Login to Skylight to get a fresh auth token (tokens expire)
    const loginRes = await fetch("https://app.ourskylight.com/api/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ email: skylightEmail, password: skylightPassword }),
    });

    if (!loginRes.ok) {
      throw new Error(`Skylight login failed: HTTP ${loginRes.status}`);
    }

    const loginData = await loginRes.json();
    const skylightUserId = loginData.data.id;
    const skylightToken = loginData.data.attributes.token;

    const credentials = btoa(`${skylightUserId}:${skylightToken}`);
    const skylightHeaders = {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    // Fetch Skylight lists to find the grocery list
    const listsRes = await fetch(`https://app.ourskylight.com/api/frames/${frameId}/lists`, {
      headers: skylightHeaders
    });
    if (!listsRes.ok) {
      throw new Error(`Failed to fetch Skylight lists: ${listsRes.status}`);
    }
    const lists = await listsRes.json();
    const groceryList = lists.data.find((l: { attributes: { kind: string } }) =>
      l.attributes.kind === "shopping"
    );

    if (!groceryList) {
      return new Response(
        JSON.stringify({ error: "No Skylight grocery list found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch items from Skylight grocery list
    const itemsRes = await fetch(
      `https://app.ourskylight.com/api/frames/${frameId}/lists/${groceryList.id}/list_items`,
      { headers: skylightHeaders }
    );
    if (!itemsRes.ok) {
      throw new Error(`Failed to fetch Skylight items: ${itemsRes.status}`);
    }
    const skylightItems: SkylightListItemsResponse = await itemsRes.json();

    // Get incomplete (unchecked) items from Skylight
    // Use !== "complete" instead of === "incomplete" to be robust against status value changes
    const incompleteItems = skylightItems.data.filter(
      (item) => item.attributes.status !== "complete"
    );

    // Build a set of ALL Skylight item names (for delete sync)
    const allSkylightNames = new Set(
      skylightItems.data.map((item) => item.attributes.label.toLowerCase().trim())
    );

    // Find the active grocery list in our app
    // If targetUserId provided, use that user's list; otherwise find any active family list
    let listQuery = supabase
      .from("grocery_lists")
      .select("id, user_id")
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (targetUserId) {
      // First check if user is in a family group
      const { data: membership } = await supabase
        .from("family_members")
        .select("family_group_id")
        .eq("user_id", targetUserId)
        .eq("status", "accepted")
        .limit(1)
        .single();

      if (membership) {
        listQuery = listQuery.eq("family_id", membership.family_group_id);
      } else {
        listQuery = listQuery.eq("user_id", targetUserId);
      }
    }

    const { data: activeList } = await listQuery.single();

    if (!activeList) {
      return new Response(
        JSON.stringify({ error: "No active grocery list found in app" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get existing UNCHECKED items in our grocery list to avoid duplicates
    // Only compare against unchecked items so checked-off items can be re-added
    const { data: existingItems } = await supabase
      .from("grocery_items")
      .select("name")
      .eq("list_id", activeList.id)
      .eq("is_checked", false);

    const existingNames = new Set(
      (existingItems || []).map((i) => i.name.toLowerCase().trim())
    );

    // Filter out items that already exist (unchecked) in our list
    const newItems = incompleteItems.filter(
      (item) => !existingNames.has(item.attributes.label.toLowerCase().trim())
    );

    // Delete sync: remove items that were synced from Skylight but no longer exist there
    const { data: skylightSyncedItems } = await supabase
      .from("grocery_items")
      .select("id, name")
      .eq("list_id", activeList.id)
      .eq("notes", "From Skylight")
      .eq("is_checked", false);

    const itemsToDelete = (skylightSyncedItems || []).filter(
      (item) => !allSkylightNames.has(item.name.toLowerCase().trim())
    );

    let removedCount = 0;
    let removedNames: string[] = [];
    if (itemsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("grocery_items")
        .delete()
        .in("id", itemsToDelete.map((i) => i.id));

      if (!deleteError) {
        removedCount = itemsToDelete.length;
        removedNames = itemsToDelete.map((i) => i.name);
        console.log(`Removed ${removedCount} items no longer on Skylight:`, removedNames);
      }
    }

    if (newItems.length === 0 && removedCount === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "All Skylight items already in your list",
          added: 0,
          removed: 0,
          skylightTotal: incompleteItems.length,
          debug: {
            skylightItemCount: skylightItems.data.length,
            incompleteCount: incompleteItems.length,
            existingAppItems: (existingItems || []).length,
            skylightItemNames: incompleteItems.map((i) => i.attributes.label),
            existingItemNames: (existingItems || []).map((i) => i.name),
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Add new items to our grocery list
    let addedNames: string[] = [];
    if (newItems.length > 0) {
      const itemsToInsert = newItems.map((item) => ({
        list_id: activeList.id,
        name: item.attributes.label,
        category: autoCategorize(item.attributes.label),
        is_checked: false,
        added_by: activeList.user_id,
        notes: "From Skylight",
      }));

      const { error: insertError } = await supabase
        .from("grocery_items")
        .insert(itemsToInsert)
        .select();

      if (insertError) {
        throw new Error(`Failed to insert items: ${insertError.message}`);
      }

      addedNames = newItems.map((i) => i.attributes.label);
      console.log(`Synced ${addedNames.length} items from Skylight:`, addedNames);
    }

    // Bump the list's updated_at
    await supabase
      .from("grocery_lists")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", activeList.id);

    const parts: string[] = [];
    if (addedNames.length > 0) {
      parts.push(`Added ${addedNames.length} item${addedNames.length !== 1 ? "s" : ""}`);
    }
    if (removedCount > 0) {
      parts.push(`Removed ${removedCount} item${removedCount !== 1 ? "s" : ""}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: parts.join(", "),
        added: addedNames.length,
        items: addedNames,
        removed: removedCount,
        removedItems: removedNames,
        skylightTotal: incompleteItems.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync from Skylight error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Failed to sync from Skylight", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
