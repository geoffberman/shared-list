// Supabase Edge Function: send-invite-email
// Sends a family group invitation email when a new pending invite is created.
// Triggered by a database trigger via pg_net, or called directly from the app.
//
// Expects JSON body:
//   { email, invited_by, family_group_id }
//
// Uses Resend API for email delivery.
// Set RESEND_API_KEY as a Supabase secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { email, invited_by, family_group_id } = await req.json();

    if (!email || !invited_by) {
      return new Response(
        JSON.stringify({ error: "Missing email or invited_by" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up inviter's name/email
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: inviter } = await supabase.auth.admin.getUserById(invited_by);
    const inviterEmail = inviter?.user?.email || "A family member";

    // Look up family group name
    let groupName = "their family group";
    if (family_group_id) {
      const { data: group } = await supabase
        .from("family_groups")
        .select("name")
        .eq("id", family_group_id)
        .single();
      if (group) {
        groupName = group.name;
      }
    }

    const appUrl = Deno.env.get("APP_URL") || "https://shared-list-eta.vercel.app";

    // Send email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY not set");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: Deno.env.get("FROM_EMAIL") || "Shared List <onboarding@resend.dev>",
        to: [email],
        subject: `${inviterEmail} invited you to ${groupName} on Shared List`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #4A7C59;">🛒 Shared List Invitation</h2>
            <p>Hi there!</p>
            <p><strong>${inviterEmail}</strong> has invited you to join <strong>${groupName}</strong> on Shared List — a collaborative grocery list app.</p>
            <p>Once you join, you'll be able to:</p>
            <ul>
              <li>Share grocery lists with the family</li>
              <li>Add items by texting from your phone</li>
              <li>See updates in real-time</li>
            </ul>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${appUrl}" style="background-color: #4A7C59; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Open Shared List
              </a>
            </div>
            <p style="color: #888; font-size: 14px;">
              Sign up with <strong>${email}</strong> to automatically join the family group.
            </p>
          </div>
        `,
      }),
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error("Resend error:", emailResult);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: emailResult }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Invite email sent to ${email} from ${inviterEmail}`);

    return new Response(
      JSON.stringify({ success: true, message: `Invite sent to ${email}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Send invite email error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
