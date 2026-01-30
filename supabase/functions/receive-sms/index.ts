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

// Parse SMS body into individual item names
function parseItems(body: string): string[] {
  // Split on commas, newlines, or "and"
  const items = body
    .split(/[,\n]+|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 100);

  return items;
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

// Find the user's active list (own or family group's)
async function findActiveList(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<{ listId: string; listOwnerId: string } | null> {
  // First try: user's own active list
  const { data: ownList } = await supabase
    .from("grocery_lists")
    .select("id, user_id")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (ownList) {
    return { listId: ownList.id, listOwnerId: ownList.user_id };
  }

  // Check if user is in a family group and find the group's active list
  const { data: membership } = await supabase
    .from("family_members")
    .select("family_group_id")
    .eq("user_id", userId)
    .eq("status", "accepted")
    .limit(1)
    .single();

  if (membership) {
    const { data: familyMembers } = await supabase
      .from("family_members")
      .select("user_id")
      .eq("family_group_id", membership.family_group_id)
      .eq("status", "accepted");

    if (familyMembers) {
      const memberIds = familyMembers.map((m) => m.user_id).filter(Boolean);
      const { data: familyList } = await supabase
        .from("grocery_lists")
        .select("id, user_id")
        .in("user_id", memberIds)
        .eq("is_archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (familyList) {
        return { listId: familyList.id, listOwnerId: familyList.user_id };
      }
    }
  }

  return null;
}

// Get common items from archived list history (mirrors client-side getCommonItemsFromHistory)
// Items on 2+ of last 3 lists OR 4+ of last 10 lists
async function getCommonItemsFromHistory(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<Array<{ name: string; category: string; quantity: string }>> {
  // Fetch recent archived lists with their items
  const { data: archivedLists } = await supabase
    .from("grocery_lists")
    .select("id, grocery_items(name, category, quantity)")
    .eq("user_id", userId)
    .eq("is_archived", true)
    .order("archived_at", { ascending: false })
    .limit(10);

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
  activeListId: string | null
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

  // Create new list
  const { data: newList, error: createError } = await supabase
    .from("grocery_lists")
    .insert([
      {
        user_id: userId,
        name: listName,
        is_archived: false,
      },
    ])
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
      category: item.category || autoCategorize(item.name),
      quantity: item.quantity || null,
      is_checked: false,
      added_by: userId,
      notes: "auto-added common item",
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

    // Check if this is a "start new list" command
    const lines = body.split("\n").map((l) => l.trim());
    const firstLine = lines[0].toLowerCase();
    const isNewListCommand = firstLine === "start new list" || firstLine === "new list";

    if (isNewListCommand) {
      // Archive current list and create a new one with common items
      const activeList = await findActiveList(supabase, userId);

      const { newListId, commonItemCount, archivedOld } =
        await archiveAndStartNewList(supabase, userId, activeList?.listId || null);

      // Parse any additional items from remaining lines
      const remainingText = lines.slice(1).join("\n").trim();
      let extraItemCount = 0;

      if (remainingText.length > 0) {
        const extraItems = parseItems(remainingText);
        if (extraItems.length > 0) {
          const itemsToInsert = extraItems.map((name) => ({
            list_id: newListId,
            name: name,
            category: autoCategorize(name),
            is_checked: false,
            added_by: userId,
            notes: "added via text",
          }));

          const { data: inserted, error: insertError } = await supabase
            .from("grocery_items")
            .insert(itemsToInsert)
            .select();

          if (!insertError && inserted) {
            extraItemCount = inserted.length;
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
    const itemNames = parseItems(body);

    if (itemNames.length === 0) {
      return twimlResponse("Couldn't find any items in your message. Try: milk, eggs, bread");
    }

    // Insert items into the list
    const itemsToInsert = itemNames.map((name) => ({
      list_id: listId,
      name: name,
      category: autoCategorize(name),
      is_checked: false,
      added_by: userId,
      notes: "added via text",
    }));

    const { data: insertedItems, error: insertError } = await supabase
      .from("grocery_items")
      .insert(itemsToInsert)
      .select();

    if (insertError) {
      console.error("Error inserting items:", insertError);
      return twimlResponse("Sorry, something went wrong adding your items. Try again.");
    }

    // Log the integration
    await supabase.from("integration_log").insert([
      {
        user_id: userId,
        source: "sms",
        raw_message: body,
        items_added: itemNames,
      },
    ]);

    const count = insertedItems?.length || itemNames.length;
    const itemList = itemNames.join(", ");
    return twimlResponse(
      `Added ${count} item${count !== 1 ? "s" : ""} to your grocery list: ${itemList}`
    );
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
