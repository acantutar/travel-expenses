import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = {
  "Access-Control-Allow-Origin": "https://acantutar.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function normalizeName(input: string) {
  return input.trim().toLocaleLowerCase("tr-TR")
    .replaceAll("ı","i").replaceAll("ğ","g").replaceAll("ü","u")
    .replaceAll("ş","s").replaceAll("ö","o").replaceAll("ç","c")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ok:false,error:"Geçersiz istek"},405);
  try {
    const body = await req.json();
    const token = String(body?.token || "");
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    const loginName = normalizeName(username);
    if (!/^[a-f0-9]{64}$/.test(token)) return respond({ok:false,error:"Geçersiz davet bağlantısı"},400);
    if (username.length < 2 || username.length > 50 || !/^[a-z0-9][a-z0-9.]{1,39}$/.test(loginName)) {
      return respond({ok:false,error:"Geçerli bir kullanıcı adı (2-40 karakter) gir"},400);
    }
    if (password.length < 10) return respond({ok:false,error:"Şifre en az 10 karakter olmalı"},400);
    if (!/[0-9]/.test(password) || !/[A-Za-z]/.test(password)) {
      return respond({ok:false,error:"Şifrede en az bir harf ve bir rakam olmalı"},400);
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!url || !secret) return respond({ok:false,error:"Sunucu yapılandırma hatası"},500);
    const admin = createClient(url, secret, {
      auth: { persistSession:false, autoRefreshToken:false },
    });
    // A valid invitation is the sole authorization to create a new account.
    const { data: invite, error: inviteError } = await admin.rpc("preview_trip_invite", {p_token:token});
    if (inviteError || !Array.isArray(invite) || !invite.length) {
      return respond({ok:false,error:"Davet geçersiz, kullanılmış veya süresi dolmuş"},403);
    }
    const {data: existing, error: existsError} = await admin.from("profiles")
      .select("id").eq("login_name",loginName).maybeSingle();
    if (existsError) return respond({ok:false,error:"Kayıt kontrolü başarısız"},500);
    if (existing) return respond({ok:false,error:"Bu kullanıcı adı alınmış. Hesabın varsa giriş yap."},409);
    // Synthetic auth email is intentionally not a real email address. SMTP/verification
    // is a separate future capability. The user signs in with their login name.
    const {data: created,error:createError} = await admin.auth.admin.createUser({
      email:`${loginName}@travel-expenses.app`,
      password,
      email_confirm:true,
      user_metadata:{username},
    });
    if (createError || !created.user) {
      return respond({ok:false,error:createError?.message?.includes("already")
        ? "Bu kullanıcı adı zaten mevcut" : "Hesap oluşturulamadı"},400);
    }
    return respond({ok:true,login_name:loginName,username});
  } catch (e) {
    return respond({ok:false,error:"Kayıt işlemi tamamlanamadı"},500);
  }
});