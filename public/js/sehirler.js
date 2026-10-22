// Türkiye'nin 81 ili ve Türkçe harf duyarsız arama.
export const SEHIRLER = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin',
  'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur',
  'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan',
  'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul',
  'İzmir', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis', 'Kırıkkale', 'Kırklareli',
  'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş',
  'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt', 'Sinop',
  'Şırnak', 'Sivas', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak',
];

// "Kürşat", "KÜRŞAT", "kursat" → "kursat"
export function fold(text) {
  return String(text)
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[c])
    .replace(/̇/g, '')
    .trim();
}

// Önce başı eşleşenler, sonra içinde geçenler.
export function searchCities(query, exclude = []) {
  const q = fold(query);
  const skip = new Set(exclude.map(fold));
  const pool = SEHIRLER.filter((c) => !skip.has(fold(c)));
  if (!q) return pool;
  const starts = pool.filter((c) => fold(c).startsWith(q));
  const contains = pool.filter((c) => !fold(c).startsWith(q) && fold(c).includes(q));
  return [...starts, ...contains];
}

// Kayıttaki "Ankara, Konya" metnini şehirlere ayırır.
export const splitCities = (region) => String(region || '').split(',').map((s) => s.trim()).filter(Boolean);
export const joinCities = (list) => list.join(', ');
