import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return Response.json({ error: "Sign in again before deleting your account." }, {
      status: 401,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return Response.json({ error: "Account deletion is not configured on the server." }, {
      status: 500,
      headers: corsHeaders,
    });
  }

  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authenticationError } = await caller.auth.getUser(token);
  if (authenticationError || !user) {
    return Response.json({ error: "Your sign-in has expired. Sign in again and retry." }, {
      status: 401,
      headers: corsHeaders,
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: preparationError } = await admin.rpc("prepare_account_deletion", {
    p_auth_user_id: user.id,
  });
  if (preparationError) {
    return Response.json({ error: `Could not remove account data: ${preparationError.message}` }, {
      status: 500,
      headers: corsHeaders,
    });
  }

  const { error: deletionError } = await admin.auth.admin.deleteUser(user.id);
  if (deletionError) {
    return Response.json({
      error: `Your profile has been de-identified, but sign-in account deletion did not complete. Retry account deletion: ${deletionError.message}`,
    }, { status: 500, headers: corsHeaders });
  }

  return Response.json({ ok: true }, { headers: corsHeaders });
});
