// Edge Function "archive": memindahkan file konten yang sudah diposting ke Google Drive,
// lalu menghapusnya dari Supabase Storage.
// Secrets yang dibutuhkan: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY sudah tersedia otomatis.)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ROOT_FOLDER = "Review Konten";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function googleToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Login Google gagal: " + (data.error_description || data.error));
  return data.access_token;
}

async function folder(token: string, name: string, parent?: string): Promise<string> {
  const q = [`name = '${name.replace(/'/g, "\\'")}'`, "mimeType = 'application/vnd.google-apps.folder'", "trashed = false"];
  if (parent) q.push(`'${parent}' in parents`);
  const found = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=files(id)&q=" + encodeURIComponent(q.join(" and ")),
    { headers: { Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());
  if (found.files?.length) return found.files[0].id;
  const made = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parent ? [parent] : undefined }),
  }).then((r) => r.json());
  if (!made.id) throw new Error("Gagal membuat folder Drive " + name);
  return made.id;
}

async function upload(token: string, parent: string, name: string, blob: Blob) {
  const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": blob.type || "application/octet-stream",
      "X-Upload-Content-Length": String(blob.size),
    },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  const url = start.headers.get("Location");
  if (!url) throw new Error("Drive menolak upload " + name + ": " + (await start.text()));
  const put = await fetch(url, { method: "PUT", body: blob });
  if (!put.ok) throw new Error("Upload ke Drive gagal untuk " + name + ": " + (await put.text()));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { item_id } = await req.json();
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Silakan masuk dulu." }, 401);
    const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
    const { data: item } = await admin.from("items").select("*, categories(label)").eq("id", item_id).single();
    if (!item) return json({ error: "Konten tidak ditemukan." }, 404);
    if (item.owner !== user.id && me?.role !== "admin") return json({ error: "Kamu tidak boleh mengarsipkan konten ini." }, 403);
    if (item.status !== "ok") return json({ error: "Hanya konten yang sudah disetujui yang bisa diarsipkan." }, 400);

    const token = await googleToken();
    const root = await folder(token, ROOT_FOLDER);
    const cat = await folder(token, item.categories?.label ?? "Lainnya", root);
    const date = new Date(item.created_at).toISOString().slice(0, 10);
    const target = await folder(token, `${date} ${item.title}`.slice(0, 120), cat);

    for (const [i, path] of (item.media as string[]).entries()) {
      const { data: blob, error } = await admin.storage.from("media").download(path);
      if (error || !blob) throw new Error("Gagal mengambil file " + path);
      const ext = path.split(".").pop();
      const name = item.media.length > 1 ? `${String(i + 1).padStart(2, "0")}.${ext}` : `${item.title}.${ext}`;
      await upload(token, target, name, blob);
    }

    // Semua sudah aman di Drive, baru hapus dari Supabase
    if (item.media.length) await admin.storage.from("media").remove(item.media);
    const drive_link = `https://drive.google.com/drive/folders/${target}`;
    await admin.from("items").update({ status: "arsip", media: [], drive_link }).eq("id", item.id);
    await admin.from("notifications").insert({ to_role: "admin", text: `${item.title} diarsipkan ke Google Drive`, item_id: item.id });
    return json({ ok: true, drive_link });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
