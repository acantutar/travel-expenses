# TripSplit P0 — Misafir başlangıcı (geliştirme kapısı)

## Neler hazır?

- Kullanıcıya hesap açtırmadan Supabase Auth üzerinden anonim oturum açma akışı.
- Misafirin auth.users kaydına bağlı, yetkilendirilmiş `public.profiles` kaydı oluşturan, mevcut kullanıcıların davranışını değiştirmeyen trigger migration.
- Mevcut `create_trip_with_settings` ile TL varsayılan tek alanlı gezi başlatma.
- Çıkış ve tarayıcı depolaması kaybı için açık uyarı; misafire şifre değiştir seçeneği gösterilmiyor.
- Giriş ekranı, mevcut üyeler ve davet kayıtları etkilenmiyor. Davetli akışında misafir CTA gizli.
- İzole PostgreSQL RLS ve tarayıcı smoke testleri. Canlı veriler testlerde kullanılmıyor.

## Neden varsayılan kapalı?

`config.js` içinde `ENABLE_GUEST_SIGNIN: false` kalmalı. Tek başına ön yüzü açmak **güvenli/işlevsel bir yayın değildir**.

Açmadan önce:

1. Supabase Dashboard **Authentication → Providers → Anonymous Sign-Ins** özelliğinin etkin olduğunu doğrula. Bu ayarı bu projede GitHub ve mevcut Supabase araç erişimi üzerinden değiştiremiyoruz.
2. `migrations/v4_4_guest_profiles.sql` migration'ını kontrollü uygula, ardından yeni misafir hesabını **gerçek Supabase Auth** ile izole test ederek profil + RLS + gezi oluşturmanın çalıştığını doğrula.
3. Gerçek misafir hesabının tarayıcı verileri silinince **geri alınamadığını** hesaba kat: Kullanıcıya açık ve kalıcı hesap bağlama akışı (e-posta doğrulaması dahil) tamamlanmadan “hesapların güvenle saklanır” vaadi kullanılmamalı. Bu nedenle kamuya açık açılış için ek güvenlik incelemesi gerekiyor.
4. Bot/anonim üyelik spam'ini önlemek üzere Supabase Auth anonymous rate limit ve CAPTCHA/abuse mekanizmasını değerlendirmeden özelliği halka açık etkinleştirme.
5. `ENABLE_GUEST_SIGNIN` sadece bu kontrollerden sonra `true` yapılmalı; tarayıcı ve mobil uçtan uca test tekrar geçmeli.

## Arkadaşları sadece adla ekleme: neden ayrı iş?

Mevcut harcama ve borç ödeme tablolarının `payer_id`, `from_user_id`, `to_user_id` alanları gerçek `profiles(id)` kaydına yabancı anahtarla bağlı. Ayrıca SQL fonksiyonları katılımcıların aktif `trip_members` olmasını şart koşuyor. İsim girmek bu yetki ve borç modelini tek başına çözmüyor.

**Sahte Auth kullanıcıları açarak** bu engeli atlatmayacağız. Bunun yerine insan kimliğini ve sisteme giriş yapan hesabı ayıran `trip_participants` modeli gerekiyor: “Ahmet” kullanıcı hesabı olmadan masraf ortağı olabilir; güvenli davetle bağlandıktan sonra gerçek üyeliği ayrıca doğrulanır. Bunun için mevcut gider/ödeme sürümlerini silmeden yeni mantıksal katılımcı kimliğini ekleme, borç denkleştirme ve CSV dışa aktarma testleri gereklidir.

Bu PR **arkadaşları yalnız adla eklemeyi bitirmiş gibi göstermez**. O geliştirme bir sonraki bağımsız PR'ın konusudur.

## Yayın kararı

- Kullanıcı 5 Kasım 2026'da otomatik yedeklemeyi erteledi: bu PR'da yedekleme veya dış depolama kurulmaz.
- Canlı kullanıcı ve mali kayıtlarına doğrudan erişilmez; yeni şema ancak ayrı onaylı geçişte uygulanır.
- Anonim giriş canlı etkin değilken kod yayınlansa bile kullanıcı login ekranı eskisi gibi çalışır.
