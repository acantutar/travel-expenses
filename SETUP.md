# TripSplit v4.2 — Kurulum ve işletim

Bu belge sistemin mevcut mimarisini açıklar. **Canlı Supabase projesinde SQL migrations zaten uygulanmıştır.**
Canlı veritabanına `schema.sql` veya migration dosyalarını gelişigüzel tekrar çalıştırmayın.

## Altyapı
- Statik GitHub Pages: `index.html`, `app.js`, `styles.css`, `config.js`
- Supabase Auth: kullanıcı adı + şifre (Auth içindeki dahili `@travel-expenses.app` kimliği)
- Veritabanı: `profiles`, `trips`, `trip_members`, `expense_versions`, `settlement_versions`, `trip_display_rates`, `trip_invitations`
- Edge Functions: `admin-users` (admin işlemleri), `admin-set-password` (eski arayüz uyumu), `join-register` (davetli kayıt)

## Davetler — e-posta servisi gerekmez
Gezi sahibi/yöneticisi `Hesabım → Gezi Üyeleri` üzerinden tek kullanımlık, 7 günlük davet oluşturur.
Davet bağlantısı `#invite=<token>` biçimindedir; token hash'i veritabanında saklanır.
Bir kişi bu linki açtığında:
1. Mevcut hesabı varsa giriş yapıp daveti kabul eder.
2. Hesabı yoksa adını ve şifresini kendisi belirler; `join-register` fonksiyonu yalnız geçerli token ile hesap açar.
3. Davet kabul edilince `trip_members` kaydı oluşturulur.

Önemli: **Şu anda gerçek e-posta doğrulaması, otomatik davet e-postası ve şifre kurtarma e-postası yok.**
Yeni kişilerin gerçek e-posta adresini doğrulamış gibi kabul etmeyin. Kullanıcıların şifrelerini saklamaları gerekir.
Supabase Auth ayarlarında açık anonim kayıt zorunlu değildir; kayıtlar Edge Function üzerinden davet kontrollüdür.

## Para birimleri
Her gezinin `base_currency` ve `allowed_currencies` ayarları bulunur.
- Kesin borçlar kaynağın para biriminde kalır; kendi kendine tek para birimine çevrilmez.
- Yaklaşık raporlar ana para biriminde ve yöneticinin girdiği `trip_display_rates.base_rate` değerleriyle hesaplanır.
- Eski Vietnam/Malezya gezisinin TL bazlı verileri ve önce kesinleşen kart TL tutarları korunur.
- Ana para birimi değişirse yaklaşık kurlar tekrar girilmelidir.

## Şema kaynakları
Mevcut GitHub deposu başlangıçta v3 şema dosyasını içeriyordu. v3.11 ve v4.0 değişiklikleri
Supabase proje migration history'sinde mevcuttur. v4.1 değişikliklerinin kaynak kopyası:
`migrations/v4_1_invites_currencies.sql`. Bu dosya **v4.0 şeması üzerine** uygulanmalıdır; v3'e doğrudan uygulanmamalıdır.

## Güvenlik
Tarayıcı yalnızca Supabase publishable key'i kullanır.
`SUPABASE_SERVICE_ROLE_KEY` yalnız sunucu fonksiyon ortamında tutulur.
Edge Function JWT ayarları `supabase/config.toml` içindedir.
`join-register` anonim çağrılabilir ancak yalnızca doğrulanan davet tokenı ile kullanıcı oluşturur.
Gezi verileri RLS ile yalnız üyelere görünür; admin veya gezi sahibi bu kuralları kendi uygulama yetkileriyle yönetir.

## Yayın
Değişiklikler test edilen GitHub pull request üzerinden `main` dalına alınır.
GitHub Actions statik testleri (JS syntax, HTML ID'leri, sürüm etiketleri) ve Pages deploy sonucunu kontrol edin.

## v4.2 notları
- Genel uygulama admin rolü kaldırıldı; gezi sahibi/yöneticisi yetkileri gezi kapsamında kalır.
- Para birimi kataloğu yaklaşık 159 kod içerir; kişisel favoriler `user_currency_favorites` tablosunda RLS ile saklanır.
- Mevcut kullanıcılar oturumları açıkken kendi şifrelerini değiştirebilir. E-posta kurtarma henüz yok.
- İlgili dosya: `migrations/v4_2_permissions_currencies.sql` (canlıda uygulanmış).
