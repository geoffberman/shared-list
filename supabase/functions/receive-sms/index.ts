// Supabase Edge Function: receive-sms
// Receives Twilio webhook when someone texts items to the grocery list number.
// Parses the message, looks up the sender's phone number, finds their active
// list, and adds the items.
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

    // Find the user's active (non-archived) list
    // Also check family group lists
    let listId: string | null = null;
    let listOwnerId: string = userId;

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
      listId = ownList.id;
      listOwnerId = ownList.user_id;
    } else {
      // Check if user is in a family group and find the group owner's active list
      const { data: membership } = await supabase
        .from("family_members")
        .select("family_group_id")
        .eq("user_id", userId)
        .eq("status", "accepted")
        .limit(1)
        .single();

      if (membership) {
        // Find any family member's active list
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
            listId = familyList.id;
            listOwnerId = familyList.user_id;
          }
        }
      }
    }

    if (!listId) {
      return twimlResponse(
        "No active grocery list found. Open the app and start a new list first."
      );
    }

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
