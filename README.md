# QRIS Speaker

Speaker QRIS untuk board LCDWiki 2.8 inci ESP32-S3 (ES3C28P). Layar menampilkan QR statis, keypad sentuh membuat QR dinamis, lalu speaker mengumumkan nominal setelah pembayaran berhasil. Penyedia bawaannya Duitku. `PAYMENT_PROVIDER=qiospay` memindahkan QR dinamis dan notifikasi ke QiosPay tanpa mengganti firmware.

Server Key Midtrans, API key Duitku, dan API key QiosPay hanya ada di backend. ESP32 memegang token perangkat, bukan kunci pembayaran.

## Backend

Butuh Node.js 22 dan `ffmpeg`. Kalau layanan suara mengirim WAV, berkas itu dipakai langsung. Kalau yang datang MP3, seperti Edge TTS, ffmpeg mengubahnya menjadi WAV mono 16 kHz.

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
| `DUITKU_CUSTOMER_NAME` | Nama pada inquiry, paling panjang 20 karakter |
| `PAYMENT_PROVIDER` | `duitku` (bawaan) atau `qiospay` |
| `QIOSPAY_MERCHANT_CODE` | Merchant code di dashboard QiosPay, menu Integrasi API |
| `QIOSPAY_API_KEY` | API key di dashboard yang sama |
| `QIOSPAY_CALLBACK_SECRET` | Rahasia yang Anda tentukan sendiri, menjadi segmen terakhir URL callback |
| `TTS_URL` | Endpoint suara, bawaan `http://127.0.0.1:20128/v1/audio/speech` |
| `TTS_API_KEY` | Token layanan suara |
| `TTS_MODEL` | Model suara |
| `TTS_LANGUAGE` | Bahasa, bawaan `Indonesian` |

Di dashboard Midtrans, Settings, Payment Notification URL:

```text
https://toko.example.com/midtrans/notification
```

URL itu hanya untuk pembayaran QR statis GoPay. Backend memeriksa `signature_key` = SHA512(`order_id` + `status_code` + `gross_amount` + Server Key). Hanya `transaction_status: settlement` dan `fraud_status: accept` yang dibuatkan suara.

QR dinamis dibuat lewat inquiry Duitku. Callback-nya `application/x-www-form-urlencoded` ke:

```text
https://toko.example.com/duitku/callback
```

Tanda tangan inquiry adalah HMAC-SHA256(`merchantCode` + `merchantOrderId` + `paymentAmount`). Tanda tangan callback adalah HMAC-SHA256(`merchantCode` + `amount` + `merchantOrderId`). Suara dinamis hanya dibuat jika `resultCode` callback `00` dan cek status Duitku juga `00`. QR berlaku 15 menit.

Kalau `PAYMENT_PROVIDER=qiospay`, kunci Midtrans dan Duitku tidak dipakai. `STATIC_QR_STRING` diisi payload EMV dari dashboard QRIS Toko. QR dinamis dibuat di server dari string itu: penanda statis `010211` menjadi `010212`, nominal masuk tag 54, CRC16 dihitung ulang. Tidak ada biaya layanan, jadi nominal keypad sama dengan yang harus dibayar.

Di dashboard QiosPay, URL Callback QRIS:

```text
https://toko.example.com/qiospay/callback/rahasia-callback
```

`rahasia-callback` sama dengan `QIOSPAY_CALLBACK_SECRET`. Secret yang salah ditolak dengan HTTP 403. Hanya mutasi kredit (`CR`) yang dibuatkan suara. Backend juga menarik mutasi tiap 5 detik. QR statis yang nominalnya diketik di aplikasi pembayaran ikut diumumkan. Tarikan pertama menandai riwayat lama supaya tidak diumumkan ulang, kecuali nominalnya sama dengan QR dinamis yang masih menunggu. QiosPay tetap menulis tipe static untuk pembayaran itu. Server menutup order dinamis lewat nominal dan waktu, lalu ESP32 membunyikannya. Callback dan mutasi untuk pembayaran yang sama memakai satu order. Order dinamis dicocokkan lewat nominal dan waktu, berlaku 15 menit. Nominal yang sama dalam dua menit setelah QR dinamis lunas dianggap pembayaran yang sama. Kalau tidak ada order yang cocok, pembayaran diumumkan sebagai QR statis.

Uji tanpa kartu:

```bash
cd backend && npm test
```

## Perangkat

Colok speaker ke soket horn 1.25 mm (maksimum 1,5 W pada 8 ohm). Port USB yang terdeteksi di mesin ini: `/dev/ttyACM0`.

```bash
cd firmware
pio run -t upload --upload-port /dev/ttyACM0
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

Layar awal menampilkan QR statis. Tombol **Nominal** membuka keypad. **Bayar** meminta QR dinamis. **Batal** kembali ke QR statis. Pembayaran yang sudah terlanjur discan tetap diumumkan.

## Uji sandbox

QR dinamis:

1. `DUITKU_IS_PRODUCTION=false`, kode merchant, dan API key sandbox.
2. `DUITKU_PAYMENT_METHOD=SP` untuk QRIS ShopeePay.
3. Buat nominal di keypad.
4. Pindai QR di layar dengan aplikasi Shopee sandbox.
5. Setelah callback masuk, speaker mengucapkan nominal dan layar menampilkan **Lunas**, lalu kembali ke QR statis.

QR statis diuji dengan memindai payload di `STATIC_QR_STRING`. Notifikasinya harus masuk ke URL Midtrans di dashboard.
