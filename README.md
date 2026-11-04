# TripSplit

TripSplit, arkadaş grupları için gezilere özel ortak harcama, borç ve ödeme takibi uygulamasıdır.

## Özellikler (v4.1)

- Bir kullanıcı hesabıyla birden fazla gezi oluşturma ve yönetme
- Gezide kullanılacak para birimlerini ve ana raporlama para birimini seçme
- Kesin borçları kendi para biriminde tutma, yaklaşık özetleri gezi ana para biriminde hesaplama
- Yönetici tarafından yaklaşık döviz kurlarını belirleme
- Gezileri ve katılımcıları birbirinden ayıran Supabase RLS kontrolleri
- Harcama / borç ödemesi, revizyon geçmişi, iptal ve CSV/JSON dışa aktarma
- Gezi yöneticisinin oluşturduğu 7 gün geçerli, tek kullanımlık davet bağlantıları
- Davet üzerinden kendi kullanıcı adı ve şifresiyle kayıt olma, mevcut hesapla daveti kabul etme
- Daveti iptal etme ve gezi üyelerinin yönetimi

## Davet ve kayıt

Gezi yöneticisi **Hesabım → Gezi Üyeleri → Arkadaş Davet Et** bölümünden davet bağlantısı oluşturur. Bağlantı yalnızca oluşturulduğunda gösterilir; veritabanında SHA-256 hash saklanır. Kişi bağlantıyı WhatsApp veya kendi tercih ettiği iletişim aracıyla paylaşabilir.

Yeni gelen kullanıcı bağlantı üzerinden adını ve şifresini seçer. Gerçek e-posta adresi toplama, e-posta doğrulama, otomatik e-posta gönderimi ve e-postayla şifre kurtarma henüz **aktif değildir**. Supabase Auth içinde bu yeni hesapların adresi uygulamaya özel dahili bir giriş kimliğidir; gerçek e-posta olarak kullanılmamalıdır.

Eski ACT / Büşra / Fatma / Sena hesapları ve önceki ledger kayıtları korunur.

## Teknik yapı

- Statik frontend: GitHub Pages, `index.html`, `app.js`, `styles.css`
- Backend: Supabase Postgres (RLS, gezi/üye/harcama/transfer/kur/davet)
- Auth ve kayıt: Supabase Auth + `join-register` Edge Function
- Yönetici kullanıcı işlemleri: `admin-users` Edge Function
- Eski veri değişiklikleri silinmez; yeni sürüm eklenir (append-only)

Sıfırdan kurulum için önce `schema.sql`, ardından `migrations/v4_multitrip.sql` ve `migrations/v4_1_invites_currencies.sql` şema değişikliklerini **ortama göre gözden geçirerek** uygula. Mevcut canlı projede bunlar uygulanmıştır; tekrar çalıştırma.

## Güvenlik ve sınırlamalar

- `service_role`/secret anahtarları hiçbir zaman tarayıcıya veya GitHub kaynaklarına yazılmaz.
- Davetler tek kullanımlıktır; süresi dolan veya iptal edilen davetler kullanılamaz.
- Bir kişinin hesabına sahip olmak onu bütün gezilerin üyesi yapmaz.
- E-posta altyapısı kurulana kadar hesap kurtarma için yönetici desteği gerekir.
- Yaklaşık FX raporları kullanıcı tarafından girilen kurlara dayanır; harcama kayıtlarını ve kesin borçları otomatik değiştirmez.
