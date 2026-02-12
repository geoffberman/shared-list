// Supabase Edge Function: sync-skylight
// Syncs grocery items to Skylight Calendar's grocery list
// Uses the reverse-engineered Skylight API (unofficial, may break)

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

// Cache auth token in memory (per function invocation)
let cachedAuth: { userId: string; token: string } | null = null;

/**
 * Login to Skylight and get auth credentials
 */
async function skylightLogin(email: string, password: string): Promise<{ userId: string; token: string }> {
  if (cachedAuth) return cachedAuth;

  const response = await fetch(`${SKYLIGHT_BASE_URL}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid Skylight email or password");
    }
    throw new Error(`Skylight login failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as SkylightLoginResponse;
  cachedAuth = {
    userId: data.data.id,
    token: data.data.attributes.token,
  };
  return cachedAuth;
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
    // Get Skylight credentials from environment
    const email = Deno.env.get("SKYLIGHT_EMAIL");
    const password = Deno.env.get("SKYLIGHT_PASSWORD");
    const frameId = Deno.env.get("SKYLIGHT_FRAME_ID");

    if (!email || !password || !frameId) {
      return new Response(
        JSON.stringify({
          error: "Skylight integration not configured",
          details: "Missing SKYLIGHT_EMAIL, SKYLIGHT_PASSWORD, or SKYLIGHT_FRAME_ID",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const { items } = (await req.json()) as { items: string[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "No items provided" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Login to Skylight
    console.log("Logging in to Skylight...");
    const auth = await skylightLogin(email, password);

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

    // Add each item
    const results: { item: string; success: boolean; error?: string }[] = [];

    for (const item of items) {
      try {
        await addItemToList(auth, frameId, groceryList.id, item);
        results.push({ item, success: true });
        console.log(`Added: ${item}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        results.push({ item, success: false, error: errorMessage });
        console.error(`Failed to add ${item}: ${errorMessage}`);
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Added ${successCount}/${items.length} items to Skylight`,
        listName: groceryList.attributes.label,
        results,
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
      JSON.stringify({ error: "Failed to sync with Skylight", details: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
