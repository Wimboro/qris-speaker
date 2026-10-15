# QRIS Speaker

Speaker kasir untuk QRIS. Layar menampilkan kode QR. Setelah uang masuk, speaker mengucapkan nominalnya.

Board-nya LCDWiki 2.8 inci, ESP32-S3 (ES3C28P). Server-nya Node.js. API key Midtrans, Duitku, dan QiosPay tinggal di server. Device hanya menyimpan host dan satu token.

Ada dua payment provider. Default: QR dinamis lewat Duitku, notification QR statis GoPay lewat Midtrans. Kalau `PAYMENT_PROVIDER=qiospay`, keduanya pindah ke QiosPay. Firmware tidak berubah.

## Yang perlu ada

- Board ES3C28P. Speaker dicolok ke soket horn 1,25 mm, paling besar 1,5 W pada 8 ohm.
- Node.js 22 atau lebih baru.
- `ffmpeg`, hanya kalau TTS membalas MP3. File WAV yang sudah jadi dipakai apa adanya.
- PlatformIO, untuk upload firmware.
- Akun Duitku plus Midtrans, atau akun QiosPay. Pilih satu provider, jangan diisi dua-duanya.

## Server

```bash
cd backend
cp .env.example .env
npm install
npm test
npm start
```

Server listen di port 3000. `curl http://127.0.0.1:3000/health` membalas `{"ok":true}` kalau process-nya jalan. Env yang wajib tapi kosong membuat process berhenti, namanya tertulis di log.

Order dan file audio tersimpan di `backend/data/`. Folder itu tidak ikut git. Hapus kalau mau mulai dari nol.

### Yang diisi di semua provider

| Env | Isi |
|---|---|
| `DEVICE_TOKEN` | Secret yang sama dengan yang diketik di device |
| `PUBLIC_BASE_URL` | Base URL yang bisa dihubungi dari internet, tanpa trailing slash. Contoh `https://toko.example.com` |
| `PORT` | Boleh dikosongkan. Default `3000` |
| `STATIC_QR_STRING` | Payload QR yang tampil di layar |

Untuk Duitku dan Midtrans, string itu dari menu Manage Static QRIS. Untuk QiosPay, dari dashboard QRIS Toko. Di provider QiosPay string ini wajib dan harus memuat `5802ID`. Di provider Duitku server tetap jalan kalau kosong, tapi layar hanya menampilkan tulisan QR statis kosong.

### Duitku dan Midtrans

Kosongkan `PAYMENT_PROVIDER`, atau isi `duitku`.

| Env | Isi |
|---|---|
| `MIDTRANS_SERVER_KEY` | Server Key sandbox atau production |
| `MIDTRANS_IS_PRODUCTION` | `false` untuk sandbox, `true` untuk production |
| `DUITKU_MERCHANT_CODE` | Merchant code proyek Duitku |
| `DUITKU_API_KEY` | API key Duitku |
| `DUITKU_IS_PRODUCTION` | `false` untuk sandbox, `true` untuk production |
| `DUITKU_PAYMENT_METHOD` | Payment method QRIS. Default `SP` (ShopeePay). `NQ` Nobu, `SQ` Nusapay |
| `DUITKU_EMAIL` | Email yang diminta inquiry Duitku |
| `DUITKU_CUSTOMER_NAME` | Customer name pada inquiry. Maksimum 20 karakter |

### QiosPay

`PAYMENT_PROVIDER=qiospay`. API key Midtrans dan Duitku tidak dipakai.

| Env | Isi |
|---|---|
| `QIOSPAY_MERCHANT_CODE` | Merchant code di dashboard, menu Integrasi API |
| `QIOSPAY_API_KEY` | API key di menu yang sama |
| `QIOSPAY_CALLBACK_SECRET` | Secret yang Anda tentukan sendiri. Menjadi path segment terakhir pada URL callback |

### TTS

Hanya firmware `esp32s3` yang download WAV dari server. Dua firmware kata merangkai audio dari flash, jadi bagian ini boleh dikosongkan.

| Env | Isi |
|---|---|
| `TTS_URL` | Endpoint TTS. Default `http://127.0.0.1:20128/v1/audio/speech` |
| `TTS_API_KEY` | Token layanan TTS |
| `TTS_MODEL` | Model. Contoh di `.env.example`: `gemini/gemini-3.1-flash-tts-preview/Rasalgethi` |
| `TTS_LANGUAGE` | Language. Default `Indonesian` |

Kalimat yang dikirim: "Pembayaran diterima sebesar … rupiah". Kalau TTS gagal, layar tetap menampilkan `Lunas`. Hanya audionya yang tidak ada.

## Callback dan notification

Ganti `toko.example.com` dengan `PUBLIC_BASE_URL` Anda.

### Midtrans

Di dashboard, Settings, Payment Notification URL:

```text
https://toko.example.com/midtrans/notification
```

Ini untuk pembayaran QR statis GoPay. Server menolak notification yang signature-nya tidak cocok: SHA512 dari `order_id`, `status_code`, `gross_amount`, dan Server Key. Announcement hanya dibuat kalau `transaction_status` bernilai `settlement` dan `fraud_status` bernilai `accept`.

### Duitku

QR dinamis dibuat lewat inquiry. Callback-nya `application/x-www-form-urlencoded` ke:

```text
https://toko.example.com/duitku/callback
```

Signature inquiry adalah HMAC-SHA256 dari `merchantCode`, `merchantOrderId`, dan `paymentAmount`. Signature callback dari `merchantCode`, `amount`, dan `merchantOrderId`. Announcement hanya dibuat kalau `resultCode` callback `00` dan status check Duitku juga `00`. QR berlaku 15 menit. `01` menandai order `expire`, layar menampilkan `Gagal`.

### QiosPay

Server tidak request QR baru ke QiosPay. Ia mengambil string QR statis toko, mengganti indicator `010211` menjadi `010212`, menyisipkan nominal keypad di tag 54, lalu menghitung CRC16 lagi. Tidak ada fee tambahan, jadi angka di keypad sama dengan angka di QR.

Di dashboard, URL Callback QRIS:

```text
https://toko.example.com/qiospay/callback/callback-secret
```

`callback-secret` sama dengan `QIOSPAY_CALLBACK_SECRET`. Secret yang salah ditolak dengan HTTP 403. Route ini hanya hidup saat `PAYMENT_PROVIDER=qiospay`.

Yang dibuatkan announcement hanya mutasi kredit (`CR`). Server poll mutasi tiap 5 detik, dan juga menerima callback. Poll pertama setelah database kosong hanya mark mutasi yang sudah ada sebagai seen, supaya speaker tidak mengulang transaksi lama.

QR dinamis berlaku 15 menit. Pembayaran yang lebih tua dari itu tidak masuk announcement, kecuali amount dan waktunya masih match dengan QR yang sedang menunggu. Window-nya dari 2 menit sebelum order dibuat sampai 15 menit sesudahnya. QiosPay kadang menulis tipe `static` untuk QR yang kita susun sendiri. Order itu tetap berstatus `settlement` lewat amount dan waktu.

Callback dan poll mutasi untuk pembayaran yang sama dihitung satu. Amount yang sama dalam 2 menit setelah QR dinamis lunas juga dianggap pembayaran yang sama, supaya tidak bunyi dua kali. Kalau tidak ada order yang match, pembayaran masuk announcement sebagai QR statis. Termasuk orang yang mengetik nominal sendiri di aplikasi pembayaran.

## Device

Ada tiga firmware. Layar, Wi-Fi, dan poll pembayaran tiap 2 detik sama. Yang beda hanya sumber audionya.

- `esp32s3` download WAV dari server. Butuh TTS yang hidup.
- `esp32s3-kata` merangkai kata dari flash. Suaranya Rowosari, file-nya di `firmware/voices/rowosari`. Tidak memanggil TTS.
- `esp32s3-kata-bank` sama seperti di atas, memakai clip lama di `firmware/bank`.

Urutannya bunyi koin, "pembayaran diterima", angka, lalu "rupiah". Nama file-nya tetap: `satu.wav`, `seribu.wav`, `rupiah.wav`, dan seterusnya. Codec memutar pada 16 kHz, PCM 16-bit. File yang bukan 16 kHz kedengaran terlalu cepat atau terlalu lambat.

```bash
cd firmware
pio run -e esp32s3-kata -t upload --upload-port /dev/ttyACM0
pio device monitor -p /dev/ttyACM0
```

Ganti nama environment kalau mau firmware yang lain. Port di mesin ini `/dev/ttyACM0`. Kalau tidak ketemu, `pio device list`.

### Setup pertama

Layar menampilkan cara mengatur. Device membuka open AP bernama `qris-speaker`. Dari ponsel, sambungkan ke situ lalu buka `http://192.168.4.1`. Isi SSID toko, password, host, dan token.

Bisa juga lewat serial 115200. Satu baris, satu perintah:

```text
WIFI=nama-wifi
PASS=sandi-wifi
HOST=https://toko.example.com
TOKEN=rahasia-perangkat
APPLY
```

`HOST` sama dengan `PUBLIC_BASE_URL`. `http://` boleh kalau server memang tidak memakai TLS. Trailing slash dibuang sendiri. `APPLY` merestart device.

Device memakai HTTPS tanpa certificate check, supaya self-signed certificate tetap bisa dipakai. Jangan arahkan `HOST` ke server yang bukan milik Anda.

Volume dan backlight bisa diubah kapan saja, tanpa mengulang setup:

```text
VOL=70
LIGHT=40
STATUS
```

`VOL` dari 0 (mute) sampai 100. `LIGHT` dari 1 sampai 100.

### Di kasir

Layar awal adalah QR statis. `NOMINAL` membuka keypad, paling banyak 8 digit. `C` mengosongkan, `<` menghapus satu digit. `BAYAR` request QR dinamis. `BATAL` kembali ke QR statis.

Double tap di layar QR statis mematikan backlight. Double tap lagi menyalakannya. Di keypad dan di QR dinamis, tap langsung masuk.

Pembayaran menyalakan layar, menampilkan `Lunas`, lalu kembali. Kalau saat itu layar sedang menampilkan QR dinamis lain, setelah bunyi layar kembali ke QR yang sedang ditunggu. Status `expire`, `cancel`, atau `deny` menampilkan `Gagal` sebentar.

Speaker hanya bunyi saat layar ada di QR statis atau QR dinamis. Kalau kasir sedang di keypad, announcement menunggu sampai layar itu ditinggalkan. Pembayaran yang sudah terlanjur discan tetap diumumkan.

LED di board: kuning saat setup, biru saat QR dinamis menunggu, hijau saat lunas, merah saat gagal. Mati di QR statis dan di keypad.

## Coba tanpa pembeli

`cd backend && npm run uji` membuka `http://127.0.0.1:3040`, hanya di mesin itu. Isi nominal, tekan Bunyikan. Halaman itu mengirim callback kredit ke server yang sedang berjalan, jadi `PAYMENT_PROVIDER` harus `qiospay`, dan `PUBLIC_BASE_URL`, `QIOSPAY_CALLBACK_SECRET`, serta `DEVICE_TOKEN` sudah terisi. Speaker berbunyi kalau layar ada di QR statis atau QR dinamis.

`http://127.0.0.1:3040/perangkat` mengatur brightness dan volume lewat USB serial. Firmware yang terpasang harus sudah mengenal perintah `VOL` dan `LIGHT`.

## Sandbox Duitku

1. `DUITKU_IS_PRODUCTION=false`, pakai merchant code dan API key sandbox.
2. `DUITKU_PAYMENT_METHOD=SP` untuk QRIS ShopeePay.
3. Buat nominal di keypad.
4. Scan QR di layar dengan aplikasi Shopee sandbox.
5. Setelah callback masuk, speaker mengucapkan nominal, layar menampilkan `Lunas`, lalu kembali ke QR statis.

QR statis diuji dengan scan isi `STATIC_QR_STRING`. Notification-nya harus sampai ke URL Midtrans di dashboard.

## Di dalam repo

`backend/src/server.js` menerima callback dan melayani device. `duitku.js`, `midtrans.js`, dan `qiospay.js` masing-masing satu provider. `speech.js` request audio dan mengubah MP3 menjadi WAV mono 16 kHz. `terbilang.js` mengubah angka menjadi kalimat.

`firmware/src/` layar, touch, Wi-Fi, dan codec ES8311. `firmware/voices/rowosari/` dan `firmware/bank/` clip kata. `firmware/lib/qrcodegen` menggambar QR, library Project Nayuki.

Test ada di `backend/test/`. `npm test` menjalankannya.

## Lisensi

MIT. Copyright Wimboro, 2026. Teks lengkapnya di `LICENSE`.

Library QR di `firmware/lib/qrcodegen` tetap MIT milik Project Nayuki. Copyright notice-nya ada di source file itu.
