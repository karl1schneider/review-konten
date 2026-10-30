# Panduan online-kan Review Konten

Semua layanan di bawah gratis. Ikuti urutannya. Kalau bingung di satu langkah, kirim screenshot ke Claude.

## 1. GitHub: tempat kode
1. Buka https://github.com/new
2. Repository name: `review-konten`, pilih **Private**, klik **Create repository**.
3. Kabari Claude. Claude akan mengupload semua kode ke repo ini.

## 2. Supabase: database, login, dan file
1. Daftar di https://supabase.com/dashboard/sign-up (pilih Continue with GitHub).
2. Klik **New project**. Nama: `review-konten`. Buat kata sandi database (simpan baik-baik). Region: **Southeast Asia (Singapore)**. Klik **Create**.
3. Tunggu 1–2 menit sampai proyek siap.
4. Menu kiri **SQL Editor** → **New query**. Buka file `supabase/schema.sql`, salin semua isinya, tempel, lalu klik **Run**. Harus muncul "Success".
5. Menu **Authentication** → **Sign In / Providers** → **Email**: matikan **Confirm email** supaya kreator bisa langsung masuk setelah daftar (opsional, tapi lebih praktis).
6. Menu **Project Settings** → **API** (atau **Data API**): salin **Project URL** dan kunci **anon public**. Kirim keduanya ke Claude, atau isi sendiri di file `config.js`. Keduanya memang boleh terlihat publik.
   - Jangan pernah membagikan kunci **service_role**.

## 3. Netlify: menayangkan website
1. Daftar di https://app.netlify.com/signup (Continue with GitHub).
2. **Add new project** → **Import an existing project** → **GitHub** → pilih repo `review-konten`.
3. Build command: kosongkan. Publish directory: `.` (titik). Klik **Deploy**.
4. **Project configuration** → **Change project name** → isi `review-konten`. Alamatnya menjadi https://review-konten.netlify.app (kalau sudah dipakai orang, coba `review-konten-kwas`).
5. Kembali ke Supabase → **Authentication** → **URL Configuration** → **Site URL**: isi alamat Netlify tadi → **Save**.

Setiap kali kode di GitHub berubah, Netlify otomatis memperbarui website.

## 4. Jadikan dirimu admin
1. Buka website, pilih **Daftar**, buat akun dengan email kamu.
2. Di Supabase → **SQL Editor** → **New query**, jalankan (ganti emailnya):
   ```sql
   update public.profiles set role = 'admin' where email = 'email-kamu@gmail.com';
   ```
3. Muat ulang website. Tab **⚙ Pengaturan** akan muncul.

## 5. Google Drive: arsip otomatis (akun nissielid@gmail.com)
Langkah ini paling panjang, tapi cukup sekali.

**a. Proyek Google Cloud**
1. Buka https://console.cloud.google.com dan masuk dengan **nissielid@gmail.com**. Setujui syaratnya kalau diminta (tidak perlu kartu kredit).
2. Klik pilihan proyek di atas → **New project** → nama `Review Konten` → **Create**.
3. Buka https://console.cloud.google.com/apis/library/drive.googleapis.com → pastikan proyek `Review Konten` terpilih → **Enable**.

**b. Layar izin (OAuth consent screen)**
1. Menu **Google Auth Platform** (atau **APIs & Services → OAuth consent screen**) → **Get started**.
2. App name: `Review Konten`, support email: nissielid@gmail.com, Audience: **External**, contact email: nissielid@gmail.com → **Create**.
3. **Data access** → **Add or remove scopes** → cari dan centang `.../auth/drive.file` → **Update** → **Save**.
4. **Audience** → **Publish app** → **Confirm**. (Ini penting. Kalau masih "Testing", izin kedaluwarsa setiap 7 hari.)

**c. Kunci aplikasi (OAuth client)**
1. **Clients** → **Create client** → Application type: **Web application**, nama `Review Konten`.
2. **Authorized redirect URIs** → **Add URI** → `https://developers.google.com/oauthplayground` → **Create**.
3. Salin **Client ID** dan **Client secret** (simpan, jangan dibagikan ke orang lain).

**d. Ambil refresh token**
1. Buka https://developers.google.com/oauthplayground
2. Klik ikon ⚙ di kanan atas → centang **Use your own OAuth credentials** → tempel Client ID dan Client secret.
3. Di kotak kiri bawah "Input your own scopes", ketik `https://www.googleapis.com/auth/drive.file` → **Authorize APIs**.
4. Pilih akun nissielid@gmail.com. Kalau muncul "Google hasn't verified this app", klik **Advanced** → **Go to Review Konten (unsafe)** → **Continue**. Ini aman karena aplikasinya milikmu sendiri.
5. Klik **Exchange authorization code for tokens**. Salin **Refresh token**.

**e. Pasang fungsi arsip di Supabase**
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nama fungsi: `archive`. Hapus isi contoh, tempel seluruh isi file `supabase/functions/archive/index.ts` → **Deploy function**.
3. **Edge Functions** → **Secrets** → tambahkan tiga secret:
   - `GOOGLE_CLIENT_ID` = Client ID
   - `GOOGLE_CLIENT_SECRET` = Client secret
   - `GOOGLE_REFRESH_TOKEN` = Refresh token
4. Selesai. Saat kreator klik **Sudah diposting, arsipkan**, file masuk ke Google Drive di folder **Review Konten › (kategori) › (tanggal + judul)**.

## Batasan paket gratis
- Supabase: database 500 MB, file 1 GB, **maksimal 50 MB per file**. Kompres Reels sebelum upload (CapCut/HandBrake, biasanya jadi 15–30 MB).
- Proyek Supabase gratis dijeda kalau tidak dipakai 7 hari. Buka dashboard Supabase dan klik **Restore** untuk mengaktifkan lagi.
- Google Drive: 15 GB, dipakai bersama Gmail dan Google Foto akun tersebut.
