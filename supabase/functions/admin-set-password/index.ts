import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Giriş gerekli" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ ok: false, error: "Oturum doğrulanamadı" }, 401);

    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (profileError || !callerProfile?.is_admin) {
      return json({ ok: false, error: "Admin yetkisi gerekli" }, 403);
    }

    const body = await req.json();
    const targetUserId = String(body?.target_user_id || "");
    const newPassword = String(body?.new_password || "");

    if (!targetUserId) return json({ ok: false, error: "Kullanıcı seçilmedi" }, 400);
    if (newPassword.length < 8) return json({ ok: false, error: "Şifre en az 8 karakter olmalı" }, 400);

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("username")
      .eq("id", targetUserId)
      .single();

    if (targetError || !targetProfile) return json({ ok: false, error: "Kullanıcı bulunamadı" }, 404);

    const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
      password: newPassword,
    });

    if (updateError) return json({ ok: false, error: updateError.message }, 400);

    return json({ ok: true, username: targetProfile.username });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "Beklenmeyen hata" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
