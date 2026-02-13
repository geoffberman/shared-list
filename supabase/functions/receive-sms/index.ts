// Supabase Edge Function: receive-sms
// Receives Twilio webhook when someone texts items to the grocery list number.
// Parses the message, looks up the sender's phone number, finds their active
// list, and adds the items.
//
// Commands:
//   "start new list" (first line) - archives active list, creates new one
//     with frequent items, then adds any remaining items from the text
//   Otherwise - adds items to the active list
//
// Twilio sends POST with form-encoded body including:
//   - From: sender phone number (e.g. "+15551234567")
//   - Body: the text message content
//
// Expected text format:
//   "milk, eggs, bread" (comma-separated)
//   or one item per line

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ============================================================================
// SKYLIGHT SYNC (optional - syncs items to Skylight Calendar grocery list)
// ============================================================================

/**
 * Sync items to Skylight Calendar grocery list (best effort, fails silently)
 * Uses pre-configured token instead of login (Skylight blocks server-side login)
 */
async function syncToSkylight(itemNames: string[]): Promise<void> {
  console.log("Skylight sync called with items:", itemNames);
  const userId = Deno.env.get("SKYLIGHT_USER_ID");
  const token = Deno.env.get("SKYLIGHT_TOKEN");
  const frameId = Deno.env.get("SKYLIGHT_FRAME_ID");

  console.log("Skylight config - userId:", userId ? "set" : "missing", "token:", token ? "set" : "missing", "frameId:", frameId ? "set" : "missing");

  // Skip if Skylight not configured
  if (!userId || !token || !frameId) {
    console.log("Skylight: Skipping - not configured");
    return;
  }

  try {
    const credentials = btoa(`${userId}:${token}`);
    const headers = {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    // Fetch lists to find the grocery list
    const listsRes = await fetch(`https://app.ourskylight.com/api/frames/${frameId}/lists`, { headers });
    if (!listsRes.ok) {
      throw new Error(`Failed to fetch lists: ${listsRes.status}`);
    }
    const lists = await listsRes.json();
    const groceryList = lists.data.find((l: { attributes: { kind: string } }) => l.attributes.kind === "shopping");

    if (!groceryList) {
      console.log("Skylight: No grocery list found");
      return;
    }

    // Add each item
    for (const name of itemNames) {
      const addRes = await fetch(
        `https://app.ourskylight.com/api/frames/${frameId}/lists/${groceryList.id}/list_items`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ label: name }),
        }
      );
      if (!addRes.ok) {
        console.error(`Skylight: Failed to add "${name}": ${addRes.status}`);
      }
    }

    console.log(`Skylight: Synced ${itemNames.length} items`);
  } catch (error) {
    // Fail silently - don't break SMS flow if Skylight sync fails
    console.error("Skylight sync failed:", error instanceof Error ? error.message : error);
  }
}

// ============================================================================

// Auto-categorize function (mirrors client-side logic)
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

// Load category overrides for a user (and their family members)
async function loadCategoryOverrides(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {};

  // Check if user is in a family group
  const { data: membership } = await supabase
    .from("family_members")
    .select("family_group_id")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .limit(1)
    .single();

  let query = supabase
    .from("item_category_overrides")
    .select("item_name, category, updated_at")
    .order("updated_at", { ascending: false });

  if (membership) {
    // Include overrides from all family members
    const { data: members } = await supabase
      .from("family_members")
      .select("user_id")
      .eq("family_group_id", membership.family_group_id)
      .eq("status", "accepted");

    const memberIds = (members || []).map((m) => m.user_id).filter(Boolean);
    if (memberIds.length > 0) {
      query = query.in("user_id", memberIds);
    } else {
      query = query.eq("user_id", userId);
    }
  } else {
    query = query.eq("user_id", userId);
  }

  const { data } = await query;
  if (data) {
    for (const row of data) {
      const key = row.item_name.toLowerCase();
      // First occurrence is the most recent due to order
      if (!overrides[key]) {
        overrides[key] = row.category;
      }
    }
  }

  return overrides;
}

// Categorize an item using overrides first, then regex fallback
function categorizeItem(
  itemName: string,
  overrides: Record<string, string>
): string {
  const key = itemName.toLowerCase();
  if (overrides[key]) {
    return overrides[key];
  }
  return autoCategorize(itemName);
}

// Parse SMS body into individual items with optional notes in parentheses
// e.g. "chicken (organic), milk (2%), bread" => [{name:"chicken", notes:"organic"}, ...]
interface ParsedItem {
  name: string;
  notes: string;
}

function parseItems(body: string): ParsedItem[] {
  // Normalize common Unicode bracket variants to ASCII ( and ).
  // Phone keyboards may produce fullwidth or other variants.
  const normalized = body
    .replace(/\uFF08/g, "(").replace(/\uFF09/g, ")")   // fullwidth
    .replace(/\uFE59/g, "(").replace(/\uFE5A/g, ")")   // small form
    .replace(/\[/g, "(").replace(/\]/g, ")");           // square brackets

  // Split on commas or newlines — but NOT when inside parentheses.
  // We walk the string tracking depth so that e.g.
  // "chips (sour cream and onion), milk" keeps the grouped text intact.
  const raw: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")" && depth > 0) {
      depth--;
      current += ch;
    } else if (depth === 0 && (ch === "," || ch === "\n")) {
      raw.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  raw.push(current);

  const items = raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 100);

  return items.map((s) => {
    const match = s.match(/^(.+?)\s*\((.+?)\)\s*$/);
    if (match) {
      return { name: match[1].trim(), notes: match[2].trim() };
    }
    return { name: s, notes: "" };
  });
}

// Generate a date-based list name (mirrors client-side generateListName)
function generateListName(existingTodayCount: number): string {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const sequenceNum = existingTodayCount + 1;
  return `${dateStr} #${sequenceNum}`;
}

// Find the user's active list (prioritizes shared family list)
async function findActiveList(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<{ listId: string; listOwnerId: string } | null> {
  // Check if user is in a family group first
  const { data: membership } = await supabase
    .from("family_members")
    .select("family_group_id")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .limit(1)
    .single();

  if (membership) {
    // Look for the family's shared active list (tagged with family_id)
    // Use updated_at so the most recently modified list is selected
    const { data: familyList } = await supabase
      .from("grocery_lists")
      .select("id, user_id")
      .eq("family_id", membership.family_group_id)
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (familyList) {
      return { listId: familyList.id, listOwnerId: familyList.user_id };
    }

    // Fallback: look for any family member's active list
    const { data: familyMembers } = await supabase
      .from("family_members")
      .select("user_id")
      .eq("family_group_id", membership.family_group_id)
      .eq("status", "accepted");

    if (familyMembers) {
      const memberIds = familyMembers.map((m) => m.user_id).filter(Boolean);
      const { data: memberList } = await supabase
        .from("grocery_lists")
        .select("id, user_id")
        .in("user_id", memberIds)
        .eq("is_archived", false)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (memberList) {
        return { listId: memberList.id, listOwnerId: memberList.user_id };
      }
    }
  }

  // Solo mode: user's own active list
  const { data: ownList } = await supabase
    .from("grocery_lists")
    .select("id, user_id")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (ownList) {
    return { listId: ownList.id, listOwnerId: ownList.user_id };
  }

  return null;
}

// Get common items from archived list history (mirrors client-side getCommonItemsFromHistory)
// Items on 2+ of last 3 lists OR 4+ of last 10 lists
async function getCommonItemsFromHistory(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<Array<{ name: string; category: string; quantity: string }>> {
  // Check if user is in a family group to include family archives
  const { data: membership } = await supabase
    .from("family_members")
    .select("family_group_id")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .limit(1)
    .single();

  // Fetch recent archived lists with their items (own + family)
  let archiveQuery = supabase
    .from("grocery_lists")
    .select("id, grocery_items(name, category, quantity)")
    .eq("is_archived", true)
    .order("archived_at", { ascending: false })
    .limit(10);

  if (membership) {
    archiveQuery = archiveQuery.or(
      `user_id.eq.${userId},family_id.eq.${membership.family_group_id}`
    );
  } else {
    archiveQuery = archiveQuery.eq("user_id", userId);
  }

  const { data: archivedLists } = await archiveQuery;

  if (!archivedLists || archivedLists.length < 2) {
    return [];
  }

  const commonItems = new Map<string, { name: string; category: string; quantity: string }>();

  // Check: appeared on 2 of the last 3 lists
  const last3 = archivedLists.slice(0, 3);
  if (last3.length >= 2) {
    const itemCounts: Record<string, number> = {};
    last3.forEach((list) => {
      const items = list.grocery_items || [];
      const seen = new Set<string>();
      items.forEach((item: { name: string }) => {
        const key = item.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          itemCounts[key] = (itemCounts[key] || 0) + 1;
        }
      });
    });
    for (const [key, count] of Object.entries(itemCounts)) {
      if (count >= 2) {
        const source = last3
          .flatMap((l) => l.grocery_items || [])
          .find((i: { name: string }) => i.name.toLowerCase() === key);
        if (source) {
          commonItems.set(key, {
            name: source.name,
            category: source.category || autoCategorize(source.name),
            quantity: source.quantity || "",
          });
        }
      }
    }
  }

  // Check: appeared on 4 of the last 10 lists
  if (archivedLists.length >= 4) {
    const itemCounts: Record<string, number> = {};
    archivedLists.forEach((list) => {
      const items = list.grocery_items || [];
      const seen = new Set<string>();
      items.forEach((item: { name: string }) => {
        const key = item.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          itemCounts[key] = (itemCounts[key] || 0) + 1;
        }
      });
    });
    for (const [key, count] of Object.entries(itemCounts)) {
      if (count >= 4 && !commonItems.has(key)) {
        const source = archivedLists
          .flatMap((l) => l.grocery_items || [])
          .find((i: { name: string }) => i.name.toLowerCase() === key);
        if (source) {
          commonItems.set(key, {
            name: source.name,
            category: source.category || autoCategorize(source.name),
            quantity: source.quantity || "",
          });
        }
      }
    }
  }

  return Array.from(commonItems.values());
}

// Get frequency-based common items
async function getFrequentItems(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<Array<{ name: string; category: string; quantity: string }>> {
  const { data: frequentItems } = await supabase
    .from("frequent_items")
    .select("name, category, typical_quantity")
    .eq("user_id", userId)
    .order("frequency_count", { ascending: false })
    .limit(10);

  if (!frequentItems) return [];

  return frequentItems.map((fi) => ({
    name: fi.name,
    category: fi.category || "",
    quantity: fi.typical_quantity || "",
  }));
}

// Archive a list and create a new one with common items
async function archiveAndStartNewList(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  activeListId: string | null,
  categoryOverrides: Record<string, string> = {}
): Promise<{ newListId: string; commonItemCount: number; archivedOld: boolean }> {
  let archivedOld = false;

  // Archive the current active list if one exists
  if (activeListId) {
    const { error: archiveError } = await supabase
      .from("grocery_lists")
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
      })
      .eq("id", activeListId);

    if (archiveError) {
      console.error("Error archiving list:", archiveError);
    } else {
      archivedOld = true;
    }
  }

  // Count today's lists for naming sequence
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  const { data: todaysLists } = await supabase
    .from("grocery_lists")
    .select("id")
    .eq("user_id", userId)
    .gte("created_at", todayStart.toISOString())
    .lt("created_at", todayEnd.toISOString());

  const existingCount = todaysLists?.length || 0;
  const listName = generateListName(existingCount);

  // Check if user is in a family group to set family_id on new list
  const { data: membership } = await supabase
    .from("family_members")
    .select("family_group_id")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .limit(1)
    .single();

  const listInsertData: Record<string, unknown> = {
    user_id: userId,
    name: listName,
    is_archived: false,
  };
  if (membership) {
    listInsertData.family_id = membership.family_group_id;
  }

  // Create new list
  const { data: newList, error: createError } = await supabase
    .from("grocery_lists")
    .insert([listInsertData])
    .select()
    .single();

  if (createError || !newList) {
    throw new Error(`Failed to create new list: ${createError?.message}`);
  }

  // Gather common items (merge recency-based + frequency-based)
  const recencyItems = await getCommonItemsFromHistory(supabase, userId);
  const frequencyItems = await getFrequentItems(supabase, userId);

  const merged = new Map<string, { name: string; category: string; quantity: string }>();
  recencyItems.forEach((item) => merged.set(item.name.toLowerCase(), item));
  frequencyItems.forEach((item) => {
    if (!merged.has(item.name.toLowerCase())) {
      merged.set(item.name.toLowerCase(), item);
    }
  });

  const commonItemsToAdd = Array.from(merged.values());
  let commonItemCount = 0;

  if (commonItemsToAdd.length > 0) {
    const itemsToInsert = commonItemsToAdd.map((item) => ({
      list_id: newList.id,
      name: item.name,
      category: item.category || categorizeItem(item.name, categoryOverrides),
      quantity: item.quantity || null,
      is_checked: false,
      added_by: userId,
      notes: "",
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("grocery_items")
      .insert(itemsToInsert)
      .select();

    if (!insertError && inserted) {
      commonItemCount = inserted.length;
    }
  }

  return { newListId: newList.id, commonItemCount, archivedOld };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Parse Twilio form-encoded body
    const formData = await req.formData();
    const from = formData.get("From")?.toString() || "";
    const body = formData.get("Body")?.toString() || "";

    if (!from || !body) {
      return twimlResponse("Sorry, we couldn't process your message.");
    }

    // Normalize phone number (strip spaces/dashes, keep +country code)
    const normalizedPhone = from.replace(/[\s\-()]/g, "");

    // Connect to Supabase with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up user by phone number
    const { data: phoneRecord, error: phoneError } = await supabase
      .from("user_phones")
      .select("user_id")
      .eq("phone_number", normalizedPhone)
      .single();

    if (phoneError || !phoneRecord) {
      console.log(`Unknown phone number: ${normalizedPhone}`);
      return twimlResponse(
        "Your phone number isn't registered. Add it in your grocery app settings first."
      );
    }

    const userId = phoneRecord.user_id;

    // Load category overrides for this user (and family members)
    const categoryOverrides = await loadCategoryOverrides(supabase, userId);

    // Check if this is a "start new list" command
    const lines = body.split("\n").map((l) => l.trim());
    const firstLine = lines[0].toLowerCase();
    const isNewListCommand = firstLine === "start new list" || firstLine === "new list";

    if (isNewListCommand) {
      // Archive current list and create a new one with common items
      const activeList = await findActiveList(supabase, userId);

      const { newListId, commonItemCount, archivedOld } =
        await archiveAndStartNewList(supabase, userId, activeList?.listId || null, categoryOverrides);

      // Parse any additional items from remaining lines
      const remainingText = lines.slice(1).join("\n").trim();
      let extraItemCount = 0;

      if (remainingText.length > 0) {
        const extraItems = parseItems(remainingText);
        if (extraItems.length > 0) {
          // Check for duplicates against common items already added
          const { data: existingOnNew } = await supabase
            .from("grocery_items")
            .select("name")
            .eq("list_id", newListId);

          const existingNewNames = new Set(
            (existingOnNew || []).map((i) => i.name.toLowerCase())
          );

          const nonDupExtras = extraItems.filter(
            (item) => !existingNewNames.has(item.name.toLowerCase())
          );

          if (nonDupExtras.length > 0) {
            const itemsToInsert = nonDupExtras.map((item) => ({
              list_id: newListId,
              name: item.name,
              category: categorizeItem(item.name, categoryOverrides),
              is_checked: false,
              added_by: userId,
              notes: item.notes || "",
            }));

            const { data: inserted, error: insertError } = await supabase
              .from("grocery_items")
              .insert(itemsToInsert)
              .select();

            if (!insertError && inserted) {
              extraItemCount = inserted.length;
              // Bump updated_at on the new list after adding extra items
              await supabase
                .from("grocery_lists")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", newListId);

              // Sync extra items to Skylight Calendar (if configured)
              await syncToSkylight(nonDupExtras.map((item) => item.name));
            }
          }
        }
      }

      // Log the integration
      await supabase.from("integration_log").insert([
        {
          user_id: userId,
          source: "sms",
          raw_message: body,
          items_added: ["__new_list__"],
        },
      ]);

      // Build response message
      const parts: string[] = [];
      if (archivedOld) {
        parts.push("Previous list archived.");
      }
      parts.push("New list started!");
      if (commonItemCount > 0) {
        parts.push(
          `Added ${commonItemCount} common item${commonItemCount !== 1 ? "s" : ""} automatically.`
        );
      }
      if (extraItemCount > 0) {
        parts.push(
          `Plus ${extraItemCount} item${extraItemCount !== 1 ? "s" : ""} from your text.`
        );
      }

      return twimlResponse(parts.join(" "));
    }

    // Standard flow: add items to active list
    const activeList = await findActiveList(supabase, userId);

    if (!activeList) {
      return twimlResponse(
        "No active grocery list found. Text \"new list\" to start one, or open the app."
      );
    }

    const listId = activeList.listId;

    // Parse items from the SMS body
    const parsedItems = parseItems(body);

    if (parsedItems.length === 0) {
      return twimlResponse("Couldn't find any items in your message. Try: milk, eggs, bread");
    }

    // Fetch existing items on the list to check for duplicates
    const { data: existingItems } = await supabase
      .from("grocery_items")
      .select("name")
      .eq("list_id", listId);

    const existingNames = new Set(
      (existingItems || []).map((i) => i.name.toLowerCase())
    );

    // Filter out duplicates
    const newItems = parsedItems.filter(
      (item) => !existingNames.has(item.name.toLowerCase())
    );
    const skippedNames = parsedItems
      .filter((item) => existingNames.has(item.name.toLowerCase()))
      .map((item) => item.name);

    if (newItems.length === 0) {
      const skippedList = skippedNames.join(", ");
      return twimlResponse(
        `All items already on your list: ${skippedList}`
      );
    }

    // Insert only non-duplicate items
    const itemsToInsert = newItems.map((item) => ({
      list_id: listId,
      name: item.name,
      category: categorizeItem(item.name, categoryOverrides),
      is_checked: false,
      added_by: userId,
      notes: item.notes || "",
    }));

    const { data: insertedItems, error: insertError } = await supabase
      .from("grocery_items")
      .insert(itemsToInsert)
      .select();

    if (insertError) {
      console.error("Error inserting items:", insertError);
      return twimlResponse("Sorry, something went wrong adding your items. Try again.");
    }

    // Bump the list's updated_at so it's recognized as the most recently
    // modified list when any family member opens the app
    await supabase
      .from("grocery_lists")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", listId);

    // Log the integration
    const newItemNames = newItems.map((i) => i.name);
    await supabase.from("integration_log").insert([
      {
        user_id: userId,
        source: "sms",
        raw_message: body,
        items_added: newItemNames,
      },
    ]);

    // Sync to Skylight Calendar (if configured, fails silently)
    await syncToSkylight(newItemNames);

    const count = insertedItems?.length || newItems.length;
    const itemList = newItemNames.join(", ");
    let responseMsg = `Added ${count} item${count !== 1 ? "s" : ""} to your grocery list: ${itemList}`;
    if (skippedNames.length > 0) {
      responseMsg += `. Already on list: ${skippedNames.join(", ")}`;
    }
    return twimlResponse(responseMsg);
  } catch (error) {
    console.error("SMS webhook error:", error);
    return twimlResponse("Sorry, something went wrong. Please try again.");
  }
});

// Return TwiML XML response (Twilio sends this back as SMS reply)
function twimlResponse(message: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/xml",
    },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
