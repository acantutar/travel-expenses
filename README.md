# TripSplit

**v4.3:** İlk ekranda 10 pratik seyahat para birimi; diğerleri yalnız ihtiyaç halinde arama ile eklenir. Gezi oluşturma, üye daveti ve kişisel hesap ekranları sadeleştirildi.

TripSplit, arkadaş grupları için gezilere özel ortak harcama, borç ve ödeme takibi uygulamasıdır.

## Özellikler (v4.1)

- Her kullanıcının kendi gezisini oluşturabilmesi; ayrıcalıklı platform admini yok
- Bir kullanıcı hesabıyla birden fazla gezi oluşturma ve yönetme
- İlk ekranda 10 önerilen para birimi (TRY, EUR, USD, GBP, AED, SAR, GEL, THB, MYR, JPY)
- Diğer 149 birimi yalnızca "Diğer para birimlerini ekle" üzerinden arayarak seçme
- Kişisel favorileri kod veya isimle arayarak ekleme (yalnız ilgili kullanıcıya ait)
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

## Arayüz

Üstte tek, kompakt gezi seçici bulunur. Eski büyük/tekrarlanan gezi paneli kaldırılmıştır. Kişisel şifre değiştirme ve favoriler **Hesabım** sayfasındadır.

## Teknik yapı

- Statik frontend: GitHub Pages, `index.html`, `app.js`, `styles.css`
- Backend: Supabase Postgres (RLS, gezi/üye/harcama/transfer/kur/davet)
- Auth ve kayıt: Supabase Auth + `join-register` Edge Function
- Yönetici kullanıcı işlemleri: `admin-users` Edge Function
- Eski veri değişiklikleri silinmez; yeni sürüm eklenir (append-only)

Kurulum ve geçiş sırasını `SETUP.md` açıklar. GitHub'daki eski `schema.sql` tek başına v4.1 kurmak için yeterli değildir; canlı Supabase projesinin migration geçmişi esas alınmalıdır.

## Güvenlik ve sınırlamalar

- `service_role`/secret anahtarları hiçbir zaman tarayıcıya veya GitHub kaynaklarına yazılmaz.
- Davetler tek kullanımlıktır; süresi dolan veya iptal edilen davetler kullanılamaz.
- Bir kişinin hesabına sahip olmak onu bütün gezilerin üyesi yapmaz.
- E-posta altyapısı kurulana kadar hesap kurtarma için yönetici desteği gerekir.
- Yaklaşık FX raporları kullanıcı tarafından girilen kurlara dayanır; harcama kayıtlarını ve kesin borçları otomatik değiştirmez.

## V4.2 geliştirme brief'i

Bkz. [docs/tripsplit-v4.2-brief.md](docs/tripsplit-v4.2-brief.md). Şema değişiklikleri [migrations/v4_2_permissions_currencies.sql](migrations/v4_2_permissions_currencies.sql) içinde sürümlenmiştir.

## v4.3 tasarım / test

Gezi oluştururken önerilen 10 birim iki kısa satırda görünür. Seçilmeyen birimleri aramak için ek panel açılır; eklenenler kolayca kaldırılabilir. Hesabım sayfasında önce seçili geziye ait üyeler ve kurlar, ardından kişisel hesap ayarları bulunur.

`tests/ui-layout-smoke.mjs` Chrome üzerinden masaüstü, tablet ve mobil 375/768/1440 px yerleşim duman testlerini yapar. Bu test gerçek bir kullanıcının oturum açmasını veya davet kabulünü test etmez.
