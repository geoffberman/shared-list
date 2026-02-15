// Supabase Edge Function: sync-skylight
// Syncs grocery items to/from Skylight Calendar's grocery list.
// Add items: POST { items: ["milk", "eggs"] }
// Delete items: POST { deleteItems: ["milk"] }
//
// Uses the exact same Skylight API calling pattern as receive-sms (which works).
const FUNCTION_VERSION = "v6-no-dedup";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const userId = Deno.env.get("SKYLIGHT_USER_ID");
    const token = Deno.env.get("SKYLIGHT_TOKEN");
    const frameId = Deno.env.get("SKYLIGHT_FRAME_ID");

    console.log("sync-skylight " + FUNCTION_VERSION);
    console.log("Config - userId:", userId ? "set" : "MISSING", "token:", token ? "set" : "MISSING", "frameId:", frameId ? "set" : "MISSING");

    if (!userId || !token || !frameId) {
      return new Response(
        JSON.stringify({ error: "Skylight not configured", details: "Missing SKYLIGHT_USER_ID, SKYLIGHT_TOKEN, or SKYLIGHT_FRAME_ID", version: FUNCTION_VERSION }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json()) as { items?: string[]; deleteItems?: string[] };
    const { items, deleteItems } = body;
    console.log("Request body:", JSON.stringify(body));

    if ((!items || items.length === 0) && (!deleteItems || deleteItems.length === 0)) {
      return new Response(
        JSON.stringify({ error: "No items or deleteItems provided", version: FUNCTION_VERSION }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build auth headers — exact same pattern as receive-sms syncToSkylight
    const credentials = btoa(`${userId}:${token}`);
    const headers = {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    // Find grocery list — exact same pattern as receive-sms
    const listsRes = await fetch(`https://app.ourskylight.com/api/frames/${frameId}/lists`, { headers });
    if (!listsRes.ok) {
      const text = await listsRes.text();
      console.error("Failed to fetch Skylight lists:", listsRes.status, text);
      return new Response(
        JSON.stringify({ error: "Failed to fetch Skylight lists", status: listsRes.status, details: text, version: FUNCTION_VERSION }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lists = await listsRes.json();
    const groceryList = lists.data.find((l: { attributes: { kind: string } }) => l.attributes.kind === "shopping");

    if (!groceryList) {
      return new Response(
        JSON.stringify({ error: "No grocery list found in Skylight", version: FUNCTION_VERSION }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found grocery list: ${groceryList.attributes.label} (id: ${groceryList.id})`);

    // Handle adds — just POST each item directly to Skylight (no dedup;
    // a duplicate on Skylight is better than a missing item)
    const addResults: { item: string; success: boolean; error?: string }[] = [];
    if (items && items.length > 0) {
      for (const item of items) {
        try {
          console.log(`Adding to Skylight: ${item}`);
          const addRes = await fetch(
            `https://app.ourskylight.com/api/frames/${frameId}/lists/${groceryList.id}/list_items`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ label: item }),
            }
          );
          if (!addRes.ok) {
            const errText = await addRes.text();
            console.error(`Failed to add "${item}": ${addRes.status} ${errText}`);
            addResults.push({ item, success: false, error: `HTTP ${addRes.status}: ${errText}` });
          } else {
            console.log(`Added: ${item}`);
            addResults.push({ item, success: true });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error adding "${item}":`, msg);
          addResults.push({ item, success: false, error: msg });
        }
      }
    }

    // Handle deletes
    const deleteResults: { deleted: string[]; notFound: string[] } = { deleted: [], notFound: [] };
    if (deleteItems && deleteItems.length > 0) {
      // Fetch all items from the list
      const itemsRes = await fetch(
        `https://app.ourskylight.com/api/frames/${frameId}/lists/${groceryList.id}/list_items`,
        { headers }
      );

      if (itemsRes.ok) {
        const allItems = await itemsRes.json();
        const namesToDelete = new Set(deleteItems.map((n: string) => n.toLowerCase().trim()));

        for (const skyItem of allItems.data) {
          const label = skyItem.attributes.label.toLowerCase().trim();
          if (namesToDelete.has(label)) {
            try {
              const delRes = await fetch(
                `https://app.ourskylight.com/api/frames/${frameId}/lists/${groceryList.id}/list_items/${skyItem.id}`,
                { method: "DELETE", headers }
              );
              if (delRes.ok || delRes.status === 204) {
                deleteResults.deleted.push(skyItem.attributes.label);
                console.log(`Deleted: ${skyItem.attributes.label}`);
              }
            } catch (err) {
              console.error(`Failed to delete ${skyItem.attributes.label}:`, err);
            }
          }
        }

        deleteResults.notFound = deleteItems.filter(
          (n: string) => !deleteResults.deleted.some(d => d.toLowerCase().trim() === n.toLowerCase().trim())
        );
      }
    }

    const addedCount = addResults.filter(r => r.success).length;
    const parts: string[] = [];
    if (addedCount > 0) parts.push(`Added ${addedCount}/${items?.length ?? 0}`);
    if (deleteResults.deleted.length > 0) parts.push(`Deleted ${deleteResults.deleted.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        version: FUNCTION_VERSION,
        message: `${parts.join(", ")} items in Skylight`,
        listName: groceryList.attributes.label,
        results: addResults,
        deleted: deleteResults.deleted,
        notFound: deleteResults.notFound,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("sync-skylight error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: "Failed to sync with Skylight", details: msg, version: FUNCTION_VERSION }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
