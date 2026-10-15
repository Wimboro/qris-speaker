# QRIS Speaker

Speaker kasir untuk QRIS. Layar menampilkan kode QR. Setelah uang masuk, speaker mengucapkan nominalnya.

Board-nya LCDWiki 2.8 inci, ESP32-S3 (ES3C28P). Server-nya Node.js. Kunci Midtrans, Duitku, dan QiosPay tinggal di server. Perangkat hanya menyimpan alamat server dan satu token.

Ada dua jalur pembayaran. Bawaan: QR dinamis lewat Duitku, notifikasi QR statis GoPay lewat Midtrans. Kalau `PAYMENT_PROVIDER=qiospay`, keduanya pindah ke QiosPay. Firmware tidak berubah.

## Yang perlu ada

- Board ES3C28P. Speaker dicolok ke soket horn 1,25 mm, paling besar 1,5 W pada 8 ohm.
- Node.js 22 atau lebih baru.
- `ffmpeg`, hanya kalau layanan suara membalas MP3. WAV yang sudah jadi dipakai apa adanya.
- PlatformIO, untuk mengunggah firmware.
- Akun Duitku plus Midtrans, atau akun QiosPay. Pilih satu jalur, jangan diisi dua-duanya.

## Server

```bash
cd backend
cp .env.example .env
npm install
npm test
npm start
```

Server mendengar di port 3000. `curl http://127.0.0.1:3000/health` membalas `{"ok":true}` kalau prosesnya hidup. Variabel yang wajib tapi kosong membuat proses berhenti, namanya tertulis di log.

Pesanan dan berkas suara tersimpan di `backend/data/`. Folder itu tidak ikut git. Hapus kalau mau mulai dari nol.

### Yang diisi di semua jalur

| Variabel | Isi |
|---|---|
| `DEVICE_TOKEN` | Rahasia yang sama dengan yang diketik di perangkat |
| `PUBLIC_BASE_URL` | Asal yang bisa dihubungi dari internet, tanpa garis miring di akhir. Contoh `https://toko.example.com` |
| `PORT` | Boleh dikosongkan. Bawaan `3000` |
| `STATIC_QR_STRING` | Payload QR yang menempel di layar |

Untuk Duitku dan Midtrans, string itu dari menu Manage Static QRIS. Untuk QiosPay, dari dashboard QRIS Toko. Di jalur QiosPay string ini wajib dan harus memuat `5802ID`. Di jalur Duitku server tetap jalan kalau kosong, tapi layar hanya menampilkan tulisan QR statis kosong.

### Duitku dan Midtrans

Kosongkan `PAYMENT_PROVIDER`, atau isi `duitku`.

| Variabel | Isi |
|---|---|
| `MIDTRANS_SERVER_KEY` | Server Key sandbox atau produksi |
| `MIDTRANS_IS_PRODUCTION` | `false` untuk sandbox, `true` untuk produksi |
| `DUITKU_MERCHANT_CODE` | Kode merchant proyek Duitku |
| `DUITKU_API_KEY` | API key Duitku |
| `DUITKU_IS_PRODUCTION` | `false` untuk sandbox, `true` untuk produksi |
| `DUITKU_PAYMENT_METHOD` | Kode QRIS. Bawaan `SP` (ShopeePay). `NQ` Nobu, `SQ` Nusapay |
| `DUITKU_EMAIL` | Email yang diminta inquiry Duitku |
| `DUITKU_CUSTOMER_NAME` | Nama pada inquiry. Dipotong sampai 20 karakter |

### QiosPay

`PAYMENT_PROVIDER=qiospay`. Kunci Midtrans dan Duitku tidak dipakai.

| Variabel | Isi |
|---|---|
| `QIOSPAY_MERCHANT_CODE` | Merchant code di dashboard, menu Integrasi API |
| `QIOSPAY_API_KEY` | API key di menu yang sama |
| `QIOSPAY_CALLBACK_SECRET` | Rahasia yang Anda tentukan sendiri. Menjadi segmen terakhir URL callback |

### Suara dari server

Hanya firmware `esp32s3` yang mengunduh rekaman. Dua firmware kata merangkai suara dari flash, jadi bagian ini boleh dikosongkan.

| Variabel | Isi |
|---|---|
| `TTS_URL` | Endpoint suara. Bawaan `http://127.0.0.1:20128/v1/audio/speech` |
| `TTS_API_KEY` | Token layanan suara |
| `TTS_MODEL` | Model. Contoh di `.env.example`: `gemini/gemini-3.1-flash-tts-preview/Rasalgethi` |
| `TTS_LANGUAGE` | Bahasa. Bawaan `Indonesian` |

Kalimat yang diminta: "Pembayaran diterima sebesar … rupiah". Kalau TTS gagal, layar tetap menampilkan `Lunas`. Hanya suaranya yang tidak ada.

## Mengarahkan pembayaran

Ganti `toko.example.com` dengan `PUBLIC_BASE_URL` Anda.

### Midtrans

Di dashboard, Settings, Payment Notification URL:

```text
https://toko.example.com/midtrans/notification
```

Ini untuk pembayaran QR statis GoPay. Server menolak pemberitahuan yang tanda tangannya tidak cocok: SHA512 dari `order_id`, `status_code`, `gross_amount`, dan Server Key. Suara hanya dibuat kalau `transaction_status` bernilai `settlement` dan `fraud_status` bernilai `accept`.

### Duitku

QR dinamis diminta lewat inquiry. Callback-nya `application/x-www-form-urlencoded` ke:

```text
https://toko.example.com/duitku/callback
```

Tanda tangan inquiry adalah HMAC-SHA256 dari `merchantCode`, `merchantOrderId`, dan `paymentAmount`. Tanda tangan callback dari `merchantCode`, `amount`, dan `merchantOrderId`. Suara hanya dibuat kalau `resultCode` callback `00` dan cek status Duitku juga `00`. QR berlaku 15 menit. `01` menandai order kedaluwarsa, layar menampilkan `Gagal`.

### QiosPay

Server tidak meminta QR baru ke QiosPay. Ia mengambil string QR statis toko, mengganti penanda `010211` menjadi `010212`, menyisipkan nominal keypad di tag 54, lalu menghitung CRC16 lagi. Tidak ada biaya tambahan, jadi angka di keypad sama dengan angka di QR.

Di dashboard, URL Callback QRIS:

```text
https://toko.example.com/qiospay/callback/rahasia-callback
```

`rahasia-callback` sama dengan `QIOSPAY_CALLBACK_SECRET`. Secret yang salah ditolak dengan HTTP 403. Route ini hanya hidup saat `PAYMENT_PROVIDER=qiospay`.

Yang dibunyikan hanya mutasi kredit (`CR`). Server menarik daftar mutasi tiap 5 detik, dan juga menerima callback. Tarikan pertama setelah database kosong hanya menandai pembayaran yang sudah ada, supaya speaker tidak mengulang transaksi lama.

QR dinamis berlaku 15 menit. Pembayaran yang lebih tua dari itu tidak diumumkan, kecuali nominal dan waktunya masih cocok dengan QR yang sedang menunggu. Jendelanya longgar: dari 2 menit sebelum order dibuat sampai 15 menit sesudahnya. QiosPay kadang menulis tipe static untuk QR yang kita susun sendiri. Order itu tetap ditutup lewat nominal dan waktu.

Callback dan tarikan mutasi untuk pembayaran yang sama dihitung satu. Nominal yang sama dalam 2 menit setelah QR dinamis lunas juga dianggap pembayaran yang sama, supaya tidak bunyi dua kali. Kalau tidak ada order yang cocok, pembayaran diumumkan sebagai QR statis. Termasuk orang yang mengetik nominal sendiri di aplikasi pembayaran.

## Perangkat

Ada tiga firmware. Layar, Wi-Fi, dan tanya pembayaran tiap 2 detik sama. Yang beda hanya dari mana suaranya datang.

- `esp32s3` mengunduh WAV dari server. Butuh TTS yang hidup.
- `esp32s3-kata` merangkai kata dari flash. Suaranya Rowosari, berkasnya di `firmware/voices/rowosari`. Tidak memanggil TTS.
- `esp32s3-kata-bank` sama seperti di atas, memakai potongan lama di `firmware/bank`.

Urutannya bunyi koin, "pembayaran diterima", angka, lalu "rupiah". Nama berkasnya tetap: `satu.wav`, `seribu.wav`, `rupiah.wav`, dan seterusnya. Codec memutar pada 16 kHz, PCM 16-bit. Rekaman yang bukan 16 kHz kedengaran terlalu cepat atau terlalu lambat.

```bash
cd firmware
pio run -e esp32s3-kata -t upload --upload-port /dev/ttyACM0
pio device monitor -p /dev/ttyACM0
```

Ganti nama environment kalau mau firmware yang lain. Port di mesin ini `/dev/ttyACM0`. Kalau tidak ketemu, `pio device list`.

### Pertama kali nyala

Layar menampilkan cara mengatur. Perangkat membuka Wi-Fi terbuka bernama `qris-speaker`. Dari ponsel, sambungkan ke situ lalu buka `http://192.168.4.1`. Isi nama Wi-Fi toko, sandinya, alamat server, dan token.

Bisa juga lewat serial 115200. Satu baris, satu perintah:

```text
WIFI=nama-wifi
PASS=sandi-wifi
HOST=https://toko.example.com
TOKEN=rahasia-perangkat
APPLY
```

`HOST` sama dengan `PUBLIC_BASE_URL`. `http://` boleh kalau server memang tidak memakai TLS. Garis miring di akhir dibuang sendiri. `APPLY` menyalakan ulang.

Perangkat memakai HTTPS tanpa memeriksa sertifikat, supaya sertifikat toko yang ditandatangani sendiri tetap bisa dipakai. Jangan arahkan `HOST` ke server yang bukan milik Anda.

Volume dan lampu bisa diubah kapan saja, tanpa mengulang setup:

```text
VOL=70
LIGHT=40
STATUS
```

`VOL` dari 0 (bisu) sampai 100. `LIGHT` dari 1 sampai 100.

### Di kasir

Layar awal adalah QR statis. `NOMINAL` membuka keypad, paling banyak 8 angka. `C` mengosongkan, `<` menghapus satu angka. `BAYAR` meminta QR dinamis. `BATAL` kembali ke QR statis.

Ketukan ganda di layar QR statis mematikan lampu. Ketukan ganda lagi menyalakannya. Di keypad dan di QR dinamis, ketukan langsung masuk.

Pembayaran menyalakan layar, menampilkan `Lunas`, lalu kembali. Kalau saat itu layar sedang menampilkan QR dinamis lain, setelah bunyi layar kembali ke QR yang sedang ditunggu. QR yang kedaluwarsa, dibatalkan, atau ditolak menampilkan `Gagal` sebentar.

Speaker hanya bunyi saat layar ada di QR statis atau QR dinamis. Kalau kasir sedang di keypad, pengumuman menunggu sampai layar itu ditinggalkan. Pembayaran yang sudah terlanjur discan tetap diumumkan.

Lampu di board: kuning saat setup, biru saat QR dinamis menunggu, hijau saat lunas, merah saat gagal. Mati di QR statis dan di keypad.

## Coba tanpa pembeli

`cd backend && npm run uji` membuka `http://127.0.0.1:3040`, hanya di mesin itu. Isi nominal, tekan Bunyikan. Halaman itu mengirim callback kredit ke server yang sedang berjalan, jadi `PAYMENT_PROVIDER` harus `qiospay`, dan `PUBLIC_BASE_URL`, `QIOSPAY_CALLBACK_SECRET`, serta `DEVICE_TOKEN` sudah terisi. Speaker berbunyi kalau layar ada di QR statis atau QR dinamis.

`http://127.0.0.1:3040/perangkat` mengatur kecerahan dan volume lewat kabel USB. Firmware yang terpasang harus sudah mengenal `VOL` dan `LIGHT`.

## Coba di sandbox Duitku

1. `DUITKU_IS_PRODUCTION=false`, pakai kode merchant dan API key sandbox.
2. `DUITKU_PAYMENT_METHOD=SP` untuk QRIS ShopeePay.
3. Buat nominal di keypad.
4. Pindai QR di layar dengan aplikasi Shopee sandbox.
5. Setelah callback masuk, speaker mengucapkan nominal, layar menampilkan `Lunas`, lalu kembali ke QR statis.

QR statis diuji dengan memindai isi `STATIC_QR_STRING`. Notifikasinya harus sampai ke URL Midtrans di dashboard.

## Di dalam repo

`backend/src/server.js` menerima callback dan melayani perangkat. `duitku.js`, `midtrans.js`, dan `qiospay.js` masing-masing satu jalur. `speech.js` minta rekaman dan mengubah MP3 menjadi WAV mono 16 kHz. `terbilang.js` mengubah angka menjadi kalimat.

`firmware/src/` layar, sentuh, Wi-Fi, dan codec ES8311. `firmware/voices/rowosari/` dan `firmware/bank/` klip kata. `firmware/lib/qrcodegen` menggambar QR, pustaka Project Nayuki.

Tes ada di `backend/test/`. `npm test` menjalankannya.

## Lisensi

MIT. Hak cipta Wimboro, 2026. Teks lengkapnya di `LICENSE`.

Pustaka QR di `firmware/lib/qrcodegen` tetap MIT milik Project Nayuki. Pemberitahuannya ada di berkas sumber itu.
