-- Review Konten: skema database Supabase
-- Cara pakai: buka Supabase > SQL Editor > New query, tempel seluruh isi file ini, klik Run.
-- Aman dijalankan sekali di proyek baru.

-- ========== Tabel ==========
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  email text,
  role text not null default 'kreator' check (role in ('kreator','admin')),
  created_at timestamptz not null default now()
);

create table public.settings (
  id int primary key default 1 check (id = 1),
  name text not null default 'Review',
  accent text not null default 'Konten',
  tagline text not null default 'KWaS',
  logo_url text not null default 'logo.png',
  h1 text not null default '#006514',
  h2 text not null default '#00c6a6',
  h3 text not null default '#d6ec3a'
);
insert into public.settings (id) values (1);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  emoji text not null default '📌',
  sort int not null default 0
);
insert into public.categories (label, emoji, sort) values
  ('Reels','🎬',1),('Carousel','🗂️',2),('Poster','🖼️',3),('Story','📱',4),('Foto produk','📷',5),('Lainnya','✨',6);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category_id uuid references public.categories on delete set null,
  kind text not null check (kind in ('image','carousel','video')),
  status text not null default 'wait' check (status in ('wait','rev','ok','arsip')),
  caption text not null default '',
  media text[] not null default '{}',      -- path file di storage bucket "media"
  version int not null default 1,
  owner uuid not null references public.profiles on delete cascade,
  owner_name text not null,
  drive_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.comments (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items on delete cascade,
  slide int,            -- nomor slide carousel (mulai 0)
  t real,               -- detik video
  x real not null,      -- posisi pin dalam persen
  y real not null,
  by_name text not null,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.replies (
  id bigint generated always as identity primary key,
  comment_id bigint not null references public.comments on delete cascade,
  by_name text not null,
  by_role text not null check (by_role in ('kreator','reviewer','admin')),
  text text not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id bigint generated always as identity primary key,
  to_user uuid references public.profiles on delete cascade,   -- untuk kreator tertentu
  to_role text check (to_role in ('reviewer','admin')),        -- untuk semua reviewer / admin
  text text not null,
  item_id uuid references public.items on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ========== Fungsi bantu ==========
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- Profil otomatis saat kreator mendaftar
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)), new.email);
  insert into notifications (to_role, text)
  values ('admin', coalesce(nullif(new.raw_user_meta_data->>'name',''), new.email) || ' mendaftar sebagai kreator');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Notifikasi otomatis
create or replace function public.notify_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (to_role, text, item_id) values ('reviewer', new.owner_name || ' mengupload ' || new.title, new.id);
  elsif new.version > old.version then
    insert into notifications (to_role, text, item_id) values ('reviewer', new.owner_name || ' mengupload revisi ' || new.title, new.id);
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger items_notify_ins after insert on public.items for each row execute function public.notify_item();
create trigger items_notify_upd before update on public.items for each row execute function public.notify_item();

create or replace function public.notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select * into it from items where id = new.item_id;
  insert into notifications (to_user, text, item_id)
  values (it.owner, new.by_name || ' mengomentari ' ||
    case when new.slide is not null then 'slide ' || (new.slide + 1)
         when new.t is not null then 'detik ' || floor(new.t)::int
         else 'gambar' end || ' di ' || it.title, it.id);
  return new;
end $$;
create trigger comments_notify after insert on public.comments for each row execute function public.notify_comment();

create or replace function public.notify_reply() returns trigger
language plpgsql security definer set search_path = public as $$
declare it items;
begin
  select i.* into it from items i join comments c on c.item_id = i.id where c.id = new.comment_id;
  if new.by_role = 'kreator' then
    insert into notifications (to_role, text, item_id) values ('reviewer', new.by_name || ' membalas komentar di ' || it.title, it.id);
  else
    insert into notifications (to_user, text, item_id) values (it.owner, new.by_name || ' membalas komentar di ' || it.title, it.id);
  end if;
  return new;
end $$;
create trigger replies_notify after insert on public.replies for each row execute function public.notify_reply();

-- Reviewer tidak punya akun, jadi aksi mereka lewat fungsi yang dibatasi ini
create or replace function public.set_status(p_item uuid, p_status text, p_by text) returns void
language plpgsql security definer set search_path = public as $$
declare it items;
begin
  if p_status not in ('rev','ok') then raise exception 'Status tidak valid'; end if;
  update items set status = p_status where id = p_item and status <> 'arsip' returning * into it;
  if found then
    insert into notifications (to_user, text, item_id) values (it.owner,
      p_by || case when p_status = 'ok' then ' menyetujui ' else ' meminta revisi untuk ' end || it.title, it.id);
  end if;
end $$;

create or replace function public.set_comment_done(p_comment bigint, p_done boolean) returns void
language sql security definer set search_path = public as $$
  update comments set done = p_done where id = p_comment;
$$;

create or replace function public.delete_comment(p_comment bigint, p_by text) returns void
language sql security definer set search_path = public as $$
  delete from comments where id = p_comment and (by_name = p_by or public.is_admin());
$$;

grant execute on function public.set_status, public.set_comment_done, public.delete_comment to anon, authenticated;

-- ========== Keamanan baris (RLS) ==========
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.comments enable row level security;
alter table public.replies enable row level security;
alter table public.notifications enable row level security;

create policy "baca profil" on public.profiles for select using (true);
create policy "ubah profil sendiri atau admin" on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (public.is_admin() or (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid())));
create policy "admin hapus profil" on public.profiles for delete using (public.is_admin());
-- email hanya bisa dibaca admin (lewat admin_profiles)
revoke select on public.profiles from anon, authenticated;
grant select (id, name, role, created_at) on public.profiles to anon, authenticated;
create or replace function public.admin_profiles()
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where public.is_admin() order by created_at;
$$;
grant execute on function public.admin_profiles() to authenticated;

create policy "baca pengaturan" on public.settings for select using (true);
create policy "admin ubah pengaturan" on public.settings for update using (public.is_admin());

create policy "baca kategori" on public.categories for select using (true);
create policy "admin kelola kategori" on public.categories for all using (public.is_admin()) with check (public.is_admin());

create policy "baca konten" on public.items for select using (true);
create policy "kreator upload" on public.items for insert to authenticated with check (owner = auth.uid());
create policy "pemilik atau admin ubah" on public.items for update to authenticated using (owner = auth.uid() or public.is_admin());
create policy "pemilik atau admin hapus" on public.items for delete to authenticated using (owner = auth.uid() or public.is_admin());

create policy "baca komentar" on public.comments for select using (true);
create policy "siapa saja berkomentar" on public.comments for insert with check (length(by_name) between 1 and 60 and length(text) between 1 and 2000);

create policy "baca balasan" on public.replies for select using (true);
create policy "siapa saja membalas" on public.replies for insert with check (length(by_name) between 1 and 60 and length(text) between 1 and 2000);

create policy "baca notifikasi" on public.notifications for select using (
  to_user = auth.uid() or to_role = 'reviewer' or (to_role = 'admin' and public.is_admin()));
create policy "tandai dibaca" on public.notifications for update to authenticated using (to_user = auth.uid());

-- ========== Penyimpanan file ==========
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do nothing;

create policy "upload file" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "hapus file sendiri atau admin" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ========== Realtime (komentar langsung muncul) ==========
alter publication supabase_realtime add table public.items, public.comments, public.replies, public.notifications, public.settings, public.categories;
