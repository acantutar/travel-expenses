# TripSplit v4.2 — Ürün, yetki, para birimi ve arayüz geliştirme brief'i

## Hedef
TripSplit'i ayrıcalıklı bir platform admini olan dört kişilik araç yerine,
her kullanıcının gezi oluşturabildiği ve katıldığı gezilerde harcama tutabildiği
sade, güvenli ve çok gezili platforma dönüştürmek. V3'ün sade tasarımını korumak.

## 1. Kullanıcı ve yetki modeli
- Platform genelinde **Admin / Kullanıcı** ayrımı ve "Admin İşlemleri" paneli kaldırılacak.
- Tüm normal hesaplar gezi oluşturabilir, davete katılabilir, kendi şifresini
  değiştirebilir ve üyesi olduğu geziyi görebilir.
- Kullanıcılar başkasının özel gezisini görmez; paylaşılmış gezi RLS ile korunur.
- **Gezi düzeyindeki sahip/yönetici rolü korunur:** gezi daveti, üye
  ekleme/çıkarma ve gezi para birimi ayarı bu yetkiyle yapılır.
  Katılımcılar harcama ve borç ödemesi ekler; kendi kayıtlarını düzeltebilir.
- Üyelikten çıkarılan kişinin geçmiş kayıtları silinmez.
- E-posta kurtarma kurulmadığı için kendi kendine şifre değiştirme yalnız
  oturumu açık kullanıcılar içindir. Şifresini unutanlar için ayrı güvenli
  kurtarma akışı ileride tasarlanmalıdır.

## 2. Para birimi deneyimi
- Sabit 9 para birimi yerine **yaklaşık 159 ISO para birimi** desteklenir.
- Kullanıcı deneyiminde ilk önerilenler (kesin turist sıralaması değildir):
  TRY, EUR, USD, GEL, RSD, BAM, ALL, AZN, SAR, AED; ardından GBP, MYR,
  THB, VND, JPY, CHF, CAD, AUD.
- Kullanıcılar birimi hem kodundan hem Türkçe adından arayabilmelidir.
- Önerilenler + kullanıcının favorileri ilk görünür; 159 kutu aynı anda
  açılmaz. Arama sonuçları seçilerek geziye eklenir.
- **Kişisel favoriler** yalnız kendi hesabında saklanır; başka kişilerin
  listelerini değiştirmez. Birim seçimi otomatik olarak başka gezilere
  eklenmez.
- **Gezi para birimleri** geziye aittir ve tüm üyeler tarafından
  kullanılabilir; yalnız gezi sahibi/yöneticisi günceller.
- Ana para birimi yalnız yaklaşık raporlama içindir; kesin borçların
  kendi para birimleri korunur. Tarihi harcamaların mevcut para birimleri
  ayarlar değiştirilirken silinemez.
- Eski kayıtların `TL` veritabanı kodu geriye uyumluluk için korunur;
  arayüzde TRY gösterilir.
- İlk aşamada kurlar yöneticinin girdiği yaklaşık değerlerdir; otomatik
  kur API'sı / geçmiş kur kilitleme bu kapsamda yoktur.

## 3. Üst başlık ve görünüm
Ekran görüntüsünde işaretlenen hatalar:
1. TripSplit ve "GEZİLERİM" metni üst üste/geçişli görünüyor.
2. Gezi adı, büyük bir ikinci kutuda tekrar ediyor.
3. Sağdaki seçim alanı aşırı büyük ve "Yeni gezi" yanlış hizada duruyor.

Hedef tasarım:
- Tek yatay başlık: **TripSplit ✈️ | Aktif gezi seçici (tarih) | + Yeni gezi | Hesap**.
- İkinci büyük gezi başlığı/kutusu yok. Seçili gezi tek yerde gösterilir.
- Yerleşim genişliği sınırlı; masaüstünde aralıklar dengeli ve görsel
  olarak birbirine bağlı.
- Telefonda marka ilk satırda, kompakt seçici + Yeni gezi + hesap
  ikinci satırda. Eski sade renkleri ve kart tasarımını koru.
- Klasik web uygulaması hissi; ek bir onboarding/giriş seçim ekranı zorunlu değil.
- Son seçilen gezi otomatik açılır.

## 4. Kabul kriterleri
- [x] Global admin hesabı ayrıcalığı kaldırılmıştır.
- [x] Kendi şifresini değiştirme ve sadece kişisel para birimi favorileri vardır.
- [x] RLS başka kullanıcı favorilerini okuma/yazmayı engeller.
- [x] En az 150 para birimi listelenir, kod ve isimle aranabilir.
- [x] Gezi seçici ve Yeni gezi tek derli toplu üst başlıkta bulunur.
- [x] Eski ledger kayıtları / para birimi değerleri korunur.
- [ ] 375px, 768px, 1440px tarayıcı görsel kontrolü ve gerçek hesapla uçtan uca test.
- [ ] E-posta gönderimi, doğrulama ve kurtarma (bu çalışmanın dışında).

## 5. Teknik uygulama notları
- Backend: `migrations/v4_2_permissions_currencies.sql`
- Frontend: `index.html`, `styles.css`, `app.js`
- Veritabanı tabloları: `currency_catalog` (salt okunur),
  `user_currency_favorites` (user_id temelli RLS)
- Mevcut `trips.allowed_currencies` ortak gezi listesi;
  `trip_display_rates` gezi kur değerleri ve mevcut append-only kayıt modeli sürer.
- Global `profiles.is_admin` eski veriye uyumluluk için kolon olarak durur,
  ancak ayrıcalık tanımaz; rol göstergesi UI'dan çıkarılmıştır.
- Mail/SMTP, otomatik davet postası ve kişisel e-posta ile sıfırlama yok.

## Yayın kontrolü
PR üzerinde JS syntax / HTML element / sürüm kontrollerini çalıştır.
Merge'den sonra GitHub Pages ve Supabase veri bütünlüğünü doğrula.
