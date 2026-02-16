// Supabase Edge Function: sync-from-skylight
// Pulls items from Skylight Calendar grocery list and adds them to the web app
// Can be called manually via button or by scheduled cron job
const FUNCTION_VERSION = "v5-delete-checked";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SKYLIGHT_BASE_URL = "https://app.ourskylight.com";

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

/**
 * Get Skylight auth headers using static SKYLIGHT_USER_ID/SKYLIGHT_TOKEN.
 */
async function getSkylightAuth(): Promise<{ headers: Record<string, string>; method: string }> {
  const skylightUserId = Deno.env.get("SKYLIGHT_USER_ID");
  const skylightToken = Deno.env.get("SKYLIGHT_TOKEN");
  if (skylightUserId && skylightToken) {
    console.log("Using static SKYLIGHT_USER_ID/SKYLIGHT_TOKEN");
    const credentials = btoa(`${skylightUserId}:${skylightToken}`);
    return {
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      method: "static token",
    };
  }

  throw new Error("No Skylight credentials available. Set SKYLIGHT_USER_ID and SKYLIGHT_TOKEN secrets.");
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  // Collect debug info throughout the process
  const debug: Record<string, unknown> = { version: FUNCTION_VERSION };

  try {
    const frameId = Deno.env.get("SKYLIGHT_FRAME_ID");
    if (!frameId) {
      return new Response(
        JSON.stringify({ error: "Skylight not configured", details: "Missing SKYLIGHT_FRAME_ID" }),
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
    debug.targetUserId = targetUserId;

    // Connect to Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate with Skylight (tries email/password first, then static token)
    const auth = await getSkylightAuth();
    debug.authMethod = auth.method;

    // Fetch Skylight lists
    console.log(`Fetching Skylight lists for frame: ${frameId}`);
    const listsRes = await fetch(`${SKYLIGHT_BASE_URL}/api/frames/${frameId}/lists`, {
      headers: auth.headers,
    });
    if (!listsRes.ok) {
      const listsBody = await listsRes.text();
      throw new Error(`Failed to fetch Skylight lists: HTTP ${listsRes.status} - ${listsBody}`);
    }
    const listsJson = await listsRes.json();

    // Handle both possible response shapes: { data: [...] } or just [...]
    const listsArray = Array.isArray(listsJson) ? listsJson : (listsJson.data || []);
    debug.listsCount = listsArray.length;
    debug.lists = listsArray.map((l: { id: string; attributes?: { label?: string; kind?: string } }) => ({
      id: l.id,
      label: l.attributes?.label,
      kind: l.attributes?.kind,
    }));

    const groceryList = listsArray.find((l: { attributes?: { kind?: string } }) =>
      l.attributes?.kind === "shopping"
    );

    if (!groceryList) {
      return new Response(
        JSON.stringify({ error: "No Skylight grocery list found", debug }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    debug.groceryListId = groceryList.id;
    debug.groceryListLabel = groceryList.attributes?.label;

    // Fetch items from Skylight grocery list
    // Try with ?status=incomplete first to get only active items
    console.log(`Fetching items from Skylight list: ${groceryList.id}`);
    let itemsRes = await fetch(
      `${SKYLIGHT_BASE_URL}/api/frames/${frameId}/lists/${groceryList.id}/list_items?status=incomplete`,
      { headers: auth.headers }
    );
    // If status filter param isn't supported, fall back to unfiltered
    if (!itemsRes.ok) {
      console.log(`Filtered request failed (${itemsRes.status}), trying unfiltered...`);
      debug.filteredRequestFailed = true;
      itemsRes = await fetch(
        `${SKYLIGHT_BASE_URL}/api/frames/${frameId}/lists/${groceryList.id}/list_items`,
        { headers: auth.headers }
      );
    } else {
      debug.filteredRequestWorked = true;
    }
    if (!itemsRes.ok) {
      const itemsBody = await itemsRes.text();
      throw new Error(`Failed to fetch Skylight items: HTTP ${itemsRes.status} - ${itemsBody}`);
    }
    const itemsJson = await itemsRes.json();

    // Handle both possible response shapes
    const itemsArray: SkylightListItem[] = Array.isArray(itemsJson) ? itemsJson : (itemsJson.data || []);
    debug.skylightTotalItems = itemsArray.length;
    // Capture ALL raw attributes so we can find the right filter field
    debug.skylightAllItems = itemsArray.map(i => ({
      id: i.id,
      ...i.attributes,
    }));
    // Also dump first item's full raw JSON to see all fields
    if (itemsArray.length > 0) {
      debug.sampleRawItem = itemsArray[0];
    }

    // Log unique statuses so we can understand Skylight's data model
    const uniqueStatuses = [...new Set(itemsArray.map(i => i.attributes?.status))];
    debug.uniqueStatuses = uniqueStatuses;

    // Use all items from the Skylight shopping list (no status filter —
    // Skylight shopping lists appear to mark all items as "complete")
    const incompleteItems = itemsArray;
    debug.incompleteCount = incompleteItems.length;
    debug.incompleteItems = incompleteItems.map(i => i.attributes?.label);

    // Build a set of ALL Skylight item names (for delete sync)
    const allSkylightNames = new Set(
      itemsArray.map((item) => (item.attributes?.label || "").toLowerCase().trim())
    );

    // Find the active grocery list in our app
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
        debug.familyGroupId = membership.family_group_id;
        listQuery = listQuery.eq("family_id", membership.family_group_id);
      } else {
        debug.familyGroupId = null;
        listQuery = listQuery.eq("user_id", targetUserId);
      }
    }

    const { data: activeList, error: listError } = await listQuery.single();

    if (!activeList) {
      return new Response(
        JSON.stringify({ error: "No active grocery list found in app", details: listError?.message, debug }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    debug.appListId = activeList.id;
    debug.appListUserId = activeList.user_id;

    // Get ALL existing items in our grocery list to avoid duplicates
    // Check both checked and unchecked items — never add duplicates
    const { data: existingItems } = await supabase
      .from("grocery_items")
      .select("name")
      .eq("list_id", activeList.id);

    const existingNames = new Set(
      (existingItems || []).map((i) => i.name.toLowerCase().trim())
    );
    debug.existingItemCount = (existingItems || []).length;
    debug.existingUncheckedNames = (existingItems || []).map(i => i.name);

    // Filter out items that already exist in our list
    const newItems = incompleteItems.filter(
      (item) => !existingNames.has((item.attributes?.label || "").toLowerCase().trim())
    );
    debug.newItemsToAdd = newItems.map(i => i.attributes?.label);

    // --- Push app items to Skylight BEFORE delete sync ---
    // Items added in the app but not yet on Skylight need to be pushed first,
    // otherwise the delete sync below would incorrectly remove them.
    const { data: allUncheckedForPush } = await supabase
      .from("grocery_items")
      .select("name")
      .eq("list_id", activeList.id)
      .eq("is_checked", false);

    const itemsToPush = (allUncheckedForPush || [])
      .map((i) => i.name)
      .filter((name) => !allSkylightNames.has(name.toLowerCase().trim()));

    let pushedCount = 0;
    const pushedNames: string[] = [];
    if (itemsToPush.length > 0) {
      console.log(`Pushing ${itemsToPush.length} app items to Skylight:`, itemsToPush);
      for (const name of itemsToPush) {
        try {
          const addRes = await fetch(
            `${SKYLIGHT_BASE_URL}/api/frames/${frameId}/lists/${groceryList.id}/list_items`,
            {
              method: "POST",
              headers: auth.headers,
              body: JSON.stringify({ label: name }),
            }
          );
          if (addRes.ok) {
            pushedCount++;
            pushedNames.push(name);
            // Mark as known to Skylight so delete sync won't remove it
            allSkylightNames.add(name.toLowerCase().trim());
          } else {
            console.error(`Failed to push "${name}" to Skylight: ${addRes.status}`);
          }
        } catch (err) {
          console.error(`Error pushing "${name}" to Skylight:`, err);
        }
      }
      console.log(`Pushed ${pushedCount}/${itemsToPush.length} items to Skylight`);
    }
    debug.pushedToSkylight = pushedNames;
    debug.pushedCount = pushedCount;

    // Delete sync: remove items from app that no longer exist on Skylight.
    // This covers both:
    //   - Unchecked items removed from Skylight externally (safe because app-only items were pushed above)
    //   - Checked items that were deleted from Skylight when checked off in the app
    const { data: allAppItems } = await supabase
      .from("grocery_items")
      .select("id, name, is_checked")
      .eq("list_id", activeList.id);

    const itemsToDelete = (allAppItems || []).filter(
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

    if (newItems.length === 0 && removedCount === 0 && pushedCount === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          version: FUNCTION_VERSION,
          message: "All Skylight items already in your list",
          added: 0,
          removed: 0,
          pushed: 0,
          skylightTotal: incompleteItems.length,
          debug,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Add new items to our grocery list (one at a time to skip duplicates gracefully)
    let addedNames: string[] = [];
    if (newItems.length > 0) {
      for (const item of newItems) {
        const { error: insertError } = await supabase
          .from("grocery_items")
          .insert({
            list_id: activeList.id,
            name: item.attributes.label,
            category: autoCategorize(item.attributes.label),
            is_checked: false,
            added_by: activeList.user_id,
            notes: "From Skylight",
          });

        if (insertError) {
          // Skip duplicates (unique constraint violation), log others
          if (insertError.code === "23505") {
            console.log(`Skipped duplicate: ${item.attributes.label}`);
          } else {
            console.error(`Failed to insert ${item.attributes.label}:`, insertError.message);
          }
        } else {
          addedNames.push(item.attributes.label);
        }
      }
      if (addedNames.length > 0) {
        console.log(`Synced ${addedNames.length} items from Skylight:`, addedNames);
      }
    }

    // Bump the list's updated_at
    await supabase
      .from("grocery_lists")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", activeList.id);

    const parts: string[] = [];
    if (pushedCount > 0) {
      parts.push(`Pushed ${pushedCount} item${pushedCount !== 1 ? "s" : ""} to Skylight`);
    }
    if (addedNames.length > 0) {
      parts.push(`Added ${addedNames.length} item${addedNames.length !== 1 ? "s" : ""}`);
    }
    if (removedCount > 0) {
      parts.push(`Removed ${removedCount} item${removedCount !== 1 ? "s" : ""}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        version: FUNCTION_VERSION,
        message: parts.join(", "),
        added: addedNames.length,
        items: addedNames,
        removed: removedCount,
        removedItems: removedNames,
        pushed: pushedCount,
        pushedItems: pushedNames,
        skylightTotal: incompleteItems.length,
        debug,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync from Skylight error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Failed to sync from Skylight", details: errorMessage, debug }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
