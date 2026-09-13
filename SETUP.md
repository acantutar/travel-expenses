# TripSplit v3 - Kurulum

## 1) Database
Supabase > SQL Editor > New query içinde `schema.sql` dosyasının tamamını çalıştır.

## 2) Yeni kullanıcı kaydını kapat
Supabase Authentication ayarlarında **Allow new users to sign up** seçeneğini kapat. Uygulamada zaten "Hesap Oluştur" ekranı yoktur.

## 3) Dört kullanıcıyı Supabase Dashboard'dan oluştur
Authentication > Users > Add user üzerinden aşağıdaki dahili e-postaları kullan:

- ACT: `act@travel-expenses.app`
- Büşra: `busra@travel-expenses.app`
- Fatma: `fatma@travel-expenses.app`
- Sena: `sena@travel-expenses.app`

Şifreleri public GitHub repository'ye veya herhangi bir dosyaya yazma. Dashboard'da kullanıcıları oluştururken daha önce belirlediğin şifreleri gir ve kullanıcıların e-posta doğrulaması gerektirmeden giriş yapabildiğinden emin ol.

ACT profili schema trigger'ı tarafından otomatik Admin yapılır.

## 4) Admin'in kullanıcı şifresi değiştirebilmesi için Edge Function
Supabase > Edge Functions > Deploy a new function > Via Editor.

Function name: `admin-set-password`

`supabase/functions/admin-set-password/index.ts` içeriğini editöre yapıştır ve deploy et.
Service-role anahtarını hiçbir zaman GitHub'a veya frontend'e koyma; Supabase Edge Function ortamında server-side secret olarak kullanılır.

## 5) GitHub Pages
Repository root'una şu dosyaları koy:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `schema.sql`

GitHub > Settings > Pages > Deploy from a branch > `main` / `(root)`.
