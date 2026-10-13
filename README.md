# QRIS Speaker

Speaker QRIS untuk board LCDWiki 2.8 inci ESP32-S3 (ES3C28P). Layar menampilkan QR statis. Keypad sentuh meminta QR dinamis. Setelah pembayaran masuk, speaker mengucapkan nominalnya.

QR dinamis bawaan lewat Duitku. Notifikasi QR statis GoPay masuk lewat Midtrans. `PAYMENT_PROVIDER=qiospay` memindahkan QR dinamis dan notifikasi ke QiosPay. Firmware tetap sama.

Server Key Midtrans, API key Duitku, dan API key QiosPay ada di backend. ESP32 hanya menyimpan token perangkat.

## Backend

Butuh Node.js 22 atau lebih baru. Kalau layanan suara mengirim WAV, berkas itu dipakai apa adanya. Kalau yang datang MP3, seperti Edge TTS, `ffmpeg` mengubahnya menjadi WAV mono 16 kHz.

```bash
cd backend
cp .env.example .env
npm install
npm test
npm start
```

Isi `.env`:

| Variabel | Isi |
|---|---|
| `MIDTRANS_SERVER_KEY` | Server Key sandbox atau produksi |
| `MIDTRANS_IS_PRODUCTION` | `false` untuk sandbox, `true` untuk produksi |
| `DEVICE_TOKEN` | Rahasia yang sama dengan yang diisi di perangkat |
| `STATIC_QR_STRING` | Payload EMV QR statis. Untuk Duitku/Midtrans dari menu Manage Static QRIS. Untuk QiosPay dari dashboard QRIS Toko |
| `PUBLIC_BASE_URL` | Asal HTTPS publik tanpa garis miring di akhir, misalnya `https://toko.example.com` |
| `PORT` | Port dengar, bawaan `3000` |
| `DUITKU_MERCHANT_CODE` | Kode merchant proyek Duitku |
| `DUITKU_API_KEY` | API key Duitku |
| `DUITKU_IS_PRODUCTION` | `false` untuk sandbox, `true` untuk produksi |
| `DUITKU_PAYMENT_METHOD` | Kode QRIS, bawaan `SP` (ShopeePay). `NQ` Nobu, `SQ` Nusapay |
| `DUITKU_EMAIL` | Email yang diminta inquiry Duitku |
| `DUITKU_CUSTOMER_NAME` | Nama pada inquiry. Backend memotongnya sampai 20 karakter |
| `PAYMENT_PROVIDER` | `duitku` (bawaan) atau `qiospay` |
| `QIOSPAY_MERCHANT_CODE` | Merchant code di dashboard QiosPay, menu Integrasi API |
| `QIOSPAY_API_KEY` | API key di dashboard yang sama |
| `QIOSPAY_CALLBACK_SECRET` | Rahasia yang Anda tentukan sendiri, menjadi segmen terakhir URL callback |
| `TTS_URL` | Endpoint suara, bawaan `http://127.0.0.1:20128/v1/audio/speech` |
| `TTS_API_KEY` | Token layanan suara |
| `TTS_MODEL` | Model suara. Contoh di `.env.example`: `gemini/gemini-3.1-flash-tts-preview/Rasalgethi` |
| `TTS_LANGUAGE` | Bahasa, bawaan `Indonesian` |

Kalau provider-nya `qiospay`, yang wajib diisi `DEVICE_TOKEN`, `PUBLIC_BASE_URL`, `STATIC_QR_STRING`, `QIOSPAY_MERCHANT_CODE`, `QIOSPAY_API_KEY`, dan `QIOSPAY_CALLBACK_SECRET`. `STATIC_QR_STRING` harus memuat `5802ID`. Selain itu, yang wajib adalah kunci Midtrans, kunci Duitku, email, dan nama pelanggan.

### Midtrans

Di dashboard Midtrans, Settings, Payment Notification URL:

```text
https://toko.example.com/midtrans/notification
```

URL itu untuk pembayaran QR statis GoPay. Backend memeriksa `signature_key` = SHA512(`order_id` + `status_code` + `gross_amount` + Server Key). Suara hanya dibuat jika `transaction_status` bernilai `settlement` dan `fraud_status` bernilai `accept`.

### Duitku

QR dinamis dibuat lewat inquiry Duitku. Callback-nya `application/x-www-form-urlencoded` ke:

```text
https://toko.example.com/duitku/callback
```

Tanda tangan inquiry adalah HMAC-SHA256(`merchantCode` + `merchantOrderId` + `paymentAmount`). Tanda tangan callback adalah HMAC-SHA256(`merchantCode` + `amount` + `merchantOrderId`). Suara dinamis hanya dibuat jika `resultCode` callback `00` dan cek status Duitku juga `00`. QR berlaku 15 menit.

### QiosPay

`STATIC_QR_STRING` diisi payload EMV dari dashboard QRIS Toko. QR dinamis dibuat di server dari string itu: penanda statis `010211` menjadi `010212`, nominal keypad masuk tag 54, CRC16 dihitung ulang. Server tidak menambahkan biaya, jadi nominal di keypad sama dengan nominal di QR.

Di dashboard QiosPay, URL Callback QRIS:

```text
https://toko.example.com/qiospay/callback/rahasia-callback
```

`rahasia-callback` sama dengan `QIOSPAY_CALLBACK_SECRET`. Secret yang salah ditolak dengan HTTP 403. Route ini hanya hidup saat `PAYMENT_PROVIDER=qiospay`.

Hanya mutasi kredit (`CR`) yang dibuatkan suara. Backend menarik mutasi tiap 5 detik, dan juga menerima callback. Tarikan pertama menandai mutasi yang sudah ada. Pembayaran yang lebih lama dari 15 menit tidak diumumkan lagi, kecuali nominal dan waktunya cocok dengan QR dinamis yang masih menunggu. Pembayaran dalam 15 menit terakhir tetap diumumkan.

QiosPay menulis tipe static untuk pembayaran QR dinamis itu. Server menutup order lewat nominal dan waktu, lalu ESP32 membunyikannya. Cocoknya dari 2 menit sebelum order dibuat sampai 15 menit sesudahnya. Callback dan mutasi untuk pembayaran yang sama memakai satu order. Nominal yang sama dalam dua menit setelah QR dinamis lunas dianggap pembayaran yang sama. Kalau tidak ada order yang cocok, pembayaran diumumkan sebagai QR statis, termasuk QR statis yang nominalnya diketik di aplikasi pembayaran.

## Perangkat

Colok speaker ke soket horn 1.25 mm (maksimum 1,5 W pada 8 ohm). Di mesin ini port USB-nya `/dev/ttyACM0`.

Ada tiga firmware. `esp32s3` mengunduh WAV dari server. `esp32s3-kata` merangkai bank kata di flash, tanpa TTS. Suara bawaan kata adalah Rowosari. `esp32s3-kata-bank` memakai bank kata yang lama. Layar, Wi-Fi, dan polling pembayaran sama. Perangkat menanyakan pembayaran tiap 2 detik.

```bash
cd firmware
pio run -e esp32s3 -t upload --upload-port /dev/ttyACM0
pio run -e esp32s3-kata -t upload --upload-port /dev/ttyACM0
pio run -e esp32s3-kata-bank -t upload --upload-port /dev/ttyACM0
pio device monitor -p /dev/ttyACM0
```

Saat pertama menyala, layar setup muncul.

- Dari ponsel, sambungkan ke Wi-Fi `qris-speaker`, lalu buka `http://192.168.4.1`.
- Atau lewat serial 115200:

```text
WIFI=nama-wifi
PASS=sandi-wifi
HOST=https://toko.example.com
TOKEN=rahasia-perangkat
APPLY
```

`HOST` sama dengan `PUBLIC_BASE_URL`, tanpa path dan tanpa garis miring di akhir. Perangkat memakai HTTPS tanpa memeriksa sertifikat server.

Layar awal menampilkan QR statis. Tombol `NOMINAL` membuka keypad (sampai 8 angka). `BAYAR` meminta QR dinamis. `BATAL` kembali ke QR statis. Ketukan ganda di layar QR statis mematikan lampu layar, ketukan ganda lagi menyalakannya. Di keypad dan QR dinamis ketukan langsung masuk. Pembayaran yang masuk menyalakan layar kembali. Pembayaran yang sudah terlanjur discan tetap diumumkan. Layar menampilkan `Lunas` atau `Gagal`, lalu kembali ke QR statis.

## Uji suara

`cd backend && npm run uji` membuka `http://127.0.0.1:3040` di mesin ini saja. Isi nominal lalu tekan Bunyikan. Halaman itu mengirim callback kredit ke server yang sedang berjalan, jadi server harus `PAYMENT_PROVIDER=qiospay`, dengan `PUBLIC_BASE_URL`, `QIOSPAY_CALLBACK_SECRET`, dan `DEVICE_TOKEN` terisi. Speaker berbunyi bila layar ada di QR statis atau QR dinamis. Halaman `/perangkat` mengatur kecerahan dan volume lewat USB serial, setelah firmware yang mendukung `VOL` dan `LIGHT` terpasang.

## Uji sandbox

QR dinamis:

1. `DUITKU_IS_PRODUCTION=false`, kode merchant, dan API key sandbox.
2. `DUITKU_PAYMENT_METHOD=SP` untuk QRIS ShopeePay.
3. Buat nominal di keypad.
4. Pindai QR di layar dengan aplikasi Shopee sandbox.
5. Setelah callback masuk, speaker mengucapkan nominal dan layar menampilkan `Lunas`, lalu kembali ke QR statis.

QR statis diuji dengan memindai payload di `STATIC_QR_STRING`. Notifikasinya harus masuk ke URL Midtrans di dashboard.

## Lisensi

MIT. Kode ini boleh dipakai, disalin, dan dikembangkan. Pemberitahuan hak cipta harus ikut pada salinan atau bagian yang berarti. Teks lengkapnya ada di `LICENSE`.

Pustaka QR di `firmware/lib/qrcodegen` tetap berlisensi MIT milik Project Nayuki. Pemberitahuannya ada di berkas sumber itu.
