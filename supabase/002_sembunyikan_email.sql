-- Perbaikan 31 Okt 2026: email kreator tidak boleh terbaca publik.
-- Jalankan sekali di Supabase > SQL Editor > New query.
revoke select on public.profiles from anon, authenticated;
grant select (id, name, role, created_at) on public.profiles to anon, authenticated;

-- Admin tetap bisa melihat email lewat fungsi ini
create or replace function public.admin_profiles()
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where public.is_admin() order by created_at;
$$;
grant execute on function public.admin_profiles() to authenticated;
