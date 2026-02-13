// Supabase Edge Function: sync-skylight
// Syncs grocery items to Skylight Calendar's grocery list
// Uses the reverse-engineered Skylight API (unofficial, may break)
const FUNCTION_VERSION = "v2-token-fallback";

const SKYLIGHT_BASE_URL = "https://app.ourskylight.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Skylight API types
interface SkylightLoginResponse {
  data: {
    id: string;
    type: "authenticated_user";
    attributes: {
      email: string;
      token: string;
      subscription_status: string;
    };
  };
}

interface SkylightList {
  id: string;
  type: "list";
  attributes: {
    label: string;
    kind: "shopping" | "to_do";
    default_grocery_list?: boolean;
  };
}

interface SkylightListsResponse {
  data: SkylightList[];
}

interface SkylightListItemResponse {
  data: {
    id: string;
    type: "list_item";
    attributes: {
      label: string;
      status: string;
    };
  };
}

interface SkylightListItemsResponse {
  data: {
    id: string;
    type: "list_item";
    attributes: {
      label: string;
      status: string;
    };
  }[];
}

// Cache auth token in memory (per function invocation)
let cachedAuth: { userId: string; token: string } | null = null;

/**
 * Get Skylight auth credentials.
 * Tries email/password login first, falls back to static SKYLIGHT_USER_ID/SKYLIGHT_TOKEN.
 */
async function getSkylightAuth(): Promise<{ userId: string; token: string }> {
  if (cachedAuth) return cachedAuth;

  const email = Deno.env.get("SKYLIGHT_EMAIL");
  const password = Deno.env.get("SKYLIGHT_PASSWORD");

  // Try email/password login first
  if (email && password) {
    console.log("Attempting Skylight login with email/password...");
    try {
      const response = await fetch(`${SKYLIGHT_BASE_URL}/api/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = (await response.json()) as SkylightLoginResponse;
        cachedAuth = {
          userId: data.data.id,
          token: data.data.attributes.token,
        };
        console.log("Skylight email/password login succeeded");
        return cachedAuth;
      }
      console.log(`Skylight email/password login failed: HTTP ${response.status}`);
    } catch (e) {
      console.log(`Skylight email/password login error: ${e}`);
    }
  }

  // Fall back to static token
  const skylightUserId = Deno.env.get("SKYLIGHT_USER_ID");
  const skylightToken = Deno.env.get("SKYLIGHT_TOKEN");
  if (skylightUserId && skylightToken) {
    console.log("Using static SKYLIGHT_USER_ID/SKYLIGHT_TOKEN for sync-skylight");
    cachedAuth = { userId: skylightUserId, token: skylightToken };
    return cachedAuth;
  }

  throw new Error("No Skylight credentials available. Need SKYLIGHT_EMAIL+SKYLIGHT_PASSWORD or SKYLIGHT_USER_ID+SKYLIGHT_TOKEN");
}

/**
 * Make an authenticated request to Skylight API
 */
async function skylightRequest<T>(
  endpoint: string,
  auth: { userId: string; token: string },
  frameId: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const { method = "GET", body } = options;
  const resolvedEndpoint = endpoint.replace("{frameId}", frameId);
  const url = `${SKYLIGHT_BASE_URL}${resolvedEndpoint}`;

  // Skylight uses Basic auth with userId:token
  const credentials = btoa(`${auth.userId}:${auth.token}`);

  const headers: Record<string, string> = {
    Authorization: `Basic ${credentials}`,
    Accept: "application/json",
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Skylight API error: HTTP ${response.status} for ${method} ${resolvedEndpoint}`);
  }

  // DELETE often returns 204 No Content
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Find the default grocery list
 */
async function findGroceryList(
  auth: { userId: string; token: string },
  frameId: string
): Promise<SkylightList | null> {
  const listsResponse = await skylightRequest<SkylightListsResponse>(
    "/api/frames/{frameId}/lists",
    auth,
    frameId
  );

  // First try to find the default grocery list
  const defaultList = listsResponse.data.find(
    (list) => list.attributes.kind === "shopping" && list.attributes.default_grocery_list
  );
  if (defaultList) return defaultList;

  // Fall back to any shopping list
  const shoppingList = listsResponse.data.find((list) => list.attributes.kind === "shopping");
  return shoppingList || null;
}

/**
 * Add an item to a Skylight list
 */
async function addItemToList(
  auth: { userId: string; token: string },
  frameId: string,
  listId: string,
  label: string
): Promise<SkylightListItemResponse> {
  return skylightRequest<SkylightListItemResponse>(
    `/api/frames/{frameId}/lists/${listId}/list_items`,
    auth,
    frameId,
    {
      method: "POST",
      body: {
        data: {
          type: "list_item",
          attributes: {
            label,
            section: null,
          },
        },
      },
    }
  );
}

/**
 * Delete items from a Skylight list by name (case-insensitive match)
 */
async function deleteItemsFromList(
  auth: { userId: string; token: string },
  frameId: string,
  listId: string,
  itemNames: string[]
): Promise<{ deleted: string[]; notFound: string[] }> {
  // Fetch all items from the Skylight list
  const allItems = await skylightRequest<SkylightListItemsResponse>(
    `/api/frames/{frameId}/lists/${listId}/list_items`,
    auth,
    frameId
  );

  const namesToDelete = new Set(itemNames.map(n => n.toLowerCase().trim()));
  const deleted: string[] = [];
  const notFound = [...itemNames];

  for (const item of allItems.data) {
    const label = item.attributes.label.toLowerCase().trim();
    if (namesToDelete.has(label)) {
      // Delete this item from Skylight
      try {
        await skylightRequest<unknown>(
          `/api/frames/{frameId}/lists/${listId}/list_items/${item.id}`,
          auth,
          frameId,
          { method: "DELETE" }
        );
        deleted.push(item.attributes.label);
        // Remove from notFound
        const idx = notFound.findIndex(n => n.toLowerCase().trim() === label);
        if (idx >= 0) notFound.splice(idx, 1);
        console.log(`Deleted from Skylight: ${item.attributes.label}`);
      } catch (err) {
        console.error(`Failed to delete ${item.attributes.label}:`, err);
      }
    }
  }

  return { deleted, notFound };
}

// Main handler
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // Check frame ID
    const frameId = Deno.env.get("SKYLIGHT_FRAME_ID");

    if (!frameId) {
      return new Response(
        JSON.stringify({
          error: "Skylight integration not configured",
          details: "Missing SKYLIGHT_FRAME_ID",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body — supports { items: [...] } for add and { deleteItems: [...] } for delete
    const body = (await req.json()) as { items?: string[]; deleteItems?: string[] };
    const { items, deleteItems } = body;

    if ((!items || items.length === 0) && (!deleteItems || deleteItems.length === 0)) {
      return new Response(
        JSON.stringify({ error: "No items or deleteItems provided" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Authenticate with Skylight (tries email/password first, falls back to static token)
    console.log("Authenticating with Skylight...");
    const auth = await getSkylightAuth();

    // Find the grocery list
    console.log("Finding grocery list...");
    const groceryList = await findGroceryList(auth, frameId);

    if (!groceryList) {
      return new Response(
        JSON.stringify({ error: "No grocery list found in Skylight" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Found grocery list: ${groceryList.attributes.label} (${groceryList.id})`);

    // Handle adds
    const addResults: { item: string; success: boolean; error?: string }[] = [];
    if (items && items.length > 0) {
      for (const item of items) {
        try {
          await addItemToList(auth, frameId, groceryList.id, item);
          addResults.push({ item, success: true });
          console.log(`Added: ${item}`);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          addResults.push({ item, success: false, error: errorMessage });
          console.error(`Failed to add ${item}: ${errorMessage}`);
        }
      }
    }

    // Handle deletes
    let deleteResult = { deleted: [] as string[], notFound: [] as string[] };
    if (deleteItems && deleteItems.length > 0) {
      deleteResult = await deleteItemsFromList(auth, frameId, groceryList.id, deleteItems);
    }

    const addedCount = addResults.filter((r) => r.success).length;
    const parts: string[] = [];
    if (addedCount > 0) parts.push(`Added ${addedCount}/${items?.length ?? 0}`);
    if (deleteResult.deleted.length > 0) parts.push(`Deleted ${deleteResult.deleted.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        version: FUNCTION_VERSION,
        message: `${parts.join(", ")} items in Skylight`,
        listName: groceryList.attributes.label,
        results: addResults,
        deleted: deleteResult.deleted,
        notFound: deleteResult.notFound,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Skylight sync error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ error: "Failed to sync with Skylight", details: errorMessage, version: FUNCTION_VERSION }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
