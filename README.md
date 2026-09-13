# Travel Expenses v2

Küçük gezi masraf paylaşım uygulaması. Düz HTML/CSS/JS + Supabase; build gerektirmez.

## Özellikler
- Kullanıcı adı + şifre ile giriş
- Harcayan kişi otomatik giriş yapan kullanıcı
- MYR / VND / USD / TL
- Kart / Cash
- Borca ortak kişiler: varsayılan herkes seçili, istenmeyen kişi çıkarılabilir
- Rapor: harcamalar + etkilenmiş kişiler + kişi bazlı toplamlar
- Borç tablosu: kim kime ne kadar borçlu
- Kart harcamalarına sonradan kesin TL karşılığı girme
- Immutable ledger: eski harcama kayıtları UPDATE/DELETE edilmez
- Admin düzeltmeleri yeni revizyon olarak eklenir
- Admin iptalinde veri silinmez; voided revizyon eklenir
- Admin tam JSON yedek ve CSV dışa aktarım
- DB'den başarılı cevap gelmeden “kaydedildi” mesajı gösterilmez

## Kurulum
1. Supabase SQL Editor'de `schema.sql` dosyasının tamamını çalıştır.
2. Authentication > Providers > Email altında Confirm email kapalı olsun.
3. Siteyi açıp `act` hesabını oluştur.
4. SQL Editor'de:
   `update public.profiles set is_admin = true where username = 'act';`
5. Dosyaları GitHub repo root'una yükle ve GitHub Pages'i `main / (root)` üzerinden aç.

## Önemli
Supabase Free plan otomatik database backup sunmuyor. Uygulamadaki “Tam Yedek (JSON) İndir” düğmesi tüm sürüm geçmişini dışa aktarır. Ek olarak periyodik `supabase db dump` / `pg_dump` ile ayrı bir yedek alınması önerilir.
