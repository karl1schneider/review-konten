// Review Konten: aplikasi review konten KWaS (Supabase + halaman statis)
const CFG = window.REVIEW_CONFIG || {};
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const ROLES = { kreator: 'Kreator', reviewer: 'Reviewer', admin: 'Admin' };
const STATUS = { wait: ['Menunggu review', 's-wait'], rev: ['Perlu revisi', 's-rev'], ok: ['Disetujui', 's-ok'], arsip: ['Diarsip ke Drive', 's-arc'] };
const MAX_MB = 50;

const D = { settings: null, cats: [], items: [], comments: [], replies: [], notifs: [], profiles: [] };
let session = null, profile = null;
let reviewerName = ls('rk-reviewer') || '';
let tab = 'konten', view = { page: 'list', id: null, slide: 0, active: null, draft: null, filter: 'all', cat: 'all', auth: 'masuk' };
let pendingRender = false;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = t => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') };
const fdate = d => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const url = p => /^(https?:|blob:|data:)/.test(p) || !p.includes('/') ? p : sb.storage.from('media').getPublicUrl(p).data.publicUrl;
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) { return null } }
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2600) }
const role = () => profile ? profile.role : (reviewerName ? 'reviewer' : null);
const myName = () => profile ? profile.name : reviewerName;
const item = () => D.items.find(i => i.id === view.id);
const catOf = id => D.cats.find(c => c.id === id);
const catName = id => catOf(id)?.label || 'Tanpa kategori';
const commentsOf = it => D.comments.filter(c => c.item_id === it.id);
const repliesOf = c => D.replies.filter(r => r.comment_id === c.id);
const fail = (e, what) => { console.error(e); toast((what || 'Gagal') + ': ' + (e.message || e)); };

// ---------- data ----------
async function loadAll() {
  const q = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).single(),
    sb.from('categories').select('*').order('sort'),
    sb.from('items').select('*').order('created_at', { ascending: false }),
    sb.from('comments').select('*').order('id'),
    sb.from('replies').select('*').order('id'),
    sb.from('notifications').select('*').order('id', { ascending: false }).limit(60),
    profile?.role === 'admin' ? sb.rpc('admin_profiles') : Promise.resolve({ data: [] }),
  ]);
  const bad = q.find(r => r.error); if (bad) throw bad.error;
  [D.settings, D.cats, D.items, D.comments, D.replies, D.notifs, D.profiles] = q.map(r => r.data);
}
let reloadT;
function scheduleReload() {
  clearTimeout(reloadT);
  reloadT = setTimeout(async () => { try { await loadAll(); safeRender() } catch (e) { console.error(e) } }, 350);
}
function safeRender() {
  const a = document.activeElement;
  if (view.draft || (a && a.closest('#app,#modalRoot') && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { pendingRender = true; return }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !view.draft) { pendingRender = false; render() } }, 200));

async function loadProfile() {
  if (!session) { profile = null; return }
  const { data } = await sb.from('profiles').select('id,name,role,created_at').eq('id', session.user.id).single();
  profile = data;
}

// ---------- header ----------
function syncSite() {
  const st = D.settings || {}, rs = document.documentElement.style;
  rs.setProperty('--h1', st.h1 || '#006514'); rs.setProperty('--h2', st.h2 || '#00c6a6'); rs.setProperty('--h3', st.h3 || '#d6ec3a');
  $('#home').innerHTML = brandHTML(st);
  document.title = [st.name, st.accent].filter(Boolean).join(' ') || 'Review Konten';
  const r = role();
  $('#tabs').hidden = r !== 'admin'; $('#tabAtur').hidden = r !== 'admin';
  if (r !== 'admin' && tab === 'atur') tab = 'konten';
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab));
  $('#bell').hidden = !r;
  const n = myNotifs().filter(x => !isRead(x)).length; $('#bellN').textContent = n; $('#bellN').hidden = !n;
}
const brandHTML = st => (st.logo_url ? `<img src="${esc(url(st.logo_url))}" alt=""> ` : '') + esc(st.name || '') + (st.accent ? ` <i>${esc(st.accent)}</i>` : '') + (st.tagline ? ` <small>${esc(st.tagline)}</small>` : '');

// notifikasi: kreator = miliknya, reviewer = semua untuk reviewer, admin = untuk admin
function myNotifs() {
  const r = role();
  if (r === 'kreator') return D.notifs.filter(n => n.to_user === profile.id);
  if (r === 'admin') return D.notifs.filter(n => n.to_role === 'admin' || n.to_user === profile.id);
  if (r === 'reviewer') return D.notifs.filter(n => n.to_role === 'reviewer');
  return [];
}
const readSet = () => new Set(JSON.parse(ls('rk-read') || '[]'));
const isRead = n => n.to_user ? n.read : readSet().has(n.id);
async function markRead(n) {
  if (n.to_user) { n.read = true; await sb.from('notifications').update({ read: true }).eq('id', n.id) }
  else { const s = readSet(); s.add(n.id); ls('rk-read', JSON.stringify([...s].slice(-300))) }
}

// ---------- render ----------
function render() {
  syncSite();
  const app = $('#app'); app.onclick = app.oninput = app.onchange = null;
  const r = role();
  if (!r) { app.innerHTML = landingHTML(); wireLanding(); return }
  if (tab === 'atur') { app.innerHTML = setHTML(); wireSet(); return }
  if (view.page === 'detail' && item()) { app.innerHTML = detailHTML(); wireDetail(); return }
  view.page = 'list'; app.innerHTML = listHTML(); wireList();
}

function landingHTML() {
  const m = view.auth;
  return `<div class="head"><div><h1>Selamat datang di <i>${esc(D.settings?.name || 'Review')} ${esc(D.settings?.accent || '')}</i></h1><p class="sub">Tempat kreator mengirim konten dan reviewer memberi catatan langsung di gambar atau video.</p></div></div>
  <div class="landing">
   <form class="box gf" id="revF"><p class="badge">Reviewer</p><h2>Saya mau mereview</h2>
    <p class="sub">Tidak perlu akun. Tulis nama supaya kreator tahu siapa yang memberi komentar.</p>
    <label>Nama<input type="text" id="rName" required maxlength="60" placeholder="Masukkan nama kamu" autocomplete="name"></label>
    <button class="btn" type="submit">Mulai review</button></form>
   <form class="box gf" id="authF"><p class="badge">Kreator &amp; admin</p><h2>${m === 'masuk' ? 'Masuk' : 'Daftar jadi kreator'}</h2>
    <div class="seg" role="group"><button type="button" data-auth="masuk" aria-pressed="${m === 'masuk'}">Masuk</button><button type="button" data-auth="daftar" aria-pressed="${m === 'daftar'}">Daftar</button></div>
    ${m === 'daftar' ? '<label>Nama lengkap<input type="text" id="gName" required maxlength="60" autocomplete="name"></label>' : ''}
    <label>Email<input type="email" id="gEmail" required autocomplete="email"></label>
    <label>Kata sandi<input type="password" id="gPass" required minlength="6" autocomplete="${m === 'masuk' ? 'current-password' : 'new-password'}"></label>
    <button class="btn" type="submit">${m === 'masuk' ? 'Masuk' : 'Buat akun kreator'}</button>
    <p class="err" id="gErr" hidden></p></form>
  </div>`;
}
function wireLanding() {
  $('#app').onclick = e => { const b = e.target.closest('[data-auth]'); if (b) { view.auth = b.dataset.auth; render() } };
  $('#revF').onsubmit = e => { e.preventDefault(); reviewerName = $('#rName').value.trim(); if (!reviewerName) return; ls('rk-reviewer', reviewerName); render(); toast('Halo, ' + reviewerName + '. Selamat mereview!') };
  $('#authF').onsubmit = async e => {
    e.preventDefault(); const err = $('#gErr'); err.hidden = true;
    const email = $('#gEmail').value.trim(), password = $('#gPass').value, btn = e.submitter; btn.disabled = true;
    try {
      if (view.auth === 'daftar') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name: $('#gName').value.trim() } } });
        if (error) throw error;
        if (!data.session) { err.textContent = 'Akun dibuat. Cek email kamu untuk konfirmasi, lalu masuk.'; err.hidden = false; view.auth = 'masuk'; return }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (x) { err.textContent = /Invalid login/i.test(x.message) ? 'Email atau kata sandi salah.' : /registered/i.test(x.message) ? 'Email ini sudah terdaftar. Pilih Masuk.' : x.message; err.hidden = false }
    finally { btn.disabled = false }
  };
}

function whoBar() {
  const r = role();
  return `<p class="who-me">Masuk sebagai <b>${esc(myName())}</b> (${ROLES[r]}) · <button type="button" class="linkb" id="logout">${r === 'reviewer' ? 'Ganti nama' : 'Keluar'}</button></p>`;
}
function visibleItems() { return role() === 'kreator' ? D.items.filter(i => i.owner === profile.id) : D.items }

function listHTML() {
  const r = role(), f = view.filter, ct = view.cat, base = visibleItems();
  const items = base.filter(i => (f === 'all' || i.status === f) && (ct === 'all' || i.category_id === ct));
  const cnt = k => base.filter(i => k === 'all' || i.category_id === k).length;
  const open = i => commentsOf(i).filter(c => !c.done).length;
  const thumb = i => !i.media.length ? `<div class="ph">📁 Tersimpan di Google Drive</div>`
    : i.kind === 'video' ? `<video src="${esc(url(i.media[0]))}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${esc(url(i.media[0]))}" alt="" loading="lazy">`;
  return `${whoBar()}
  <div class="head"><div><h1>${r === 'kreator' ? 'Konten <i>saya</i>' : r === 'admin' ? 'Semua <i>konten</i>' : 'Antrean <i>review</i>'}</h1>
  <p class="sub">${r === 'kreator' ? 'Upload konten, lalu pantau komentar dari reviewer.' : r === 'admin' ? 'Kamu bisa mengedit, menghapus, dan mereview semua konten.' : 'Buka konten, lalu klik bagian gambar atau video yang perlu diedit.'}</p></div>
  ${r !== 'reviewer' ? '<button class="btn" id="upBtn" type="button">+ Upload konten</button>' : ''}</div>
  <div class="cats" role="group" aria-label="Kategori konten">
   <button type="button" data-c="all" aria-pressed="${ct === 'all'}">Semua <span>${cnt('all')}</span></button>
   ${D.cats.map(c => `<button type="button" data-c="${c.id}" aria-pressed="${ct === c.id}">${esc(c.emoji)} ${esc(c.label)} <span>${cnt(c.id)}</span></button>`).join('')}
  </div>
  <div class="filters" role="group" aria-label="Saring status">
   ${[['all', 'Semua'], ['wait', 'Menunggu review'], ['rev', 'Perlu revisi'], ['ok', 'Disetujui'], ['arsip', 'Diarsip']].map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}
  </div>
  <div class="grid">${items.map(i => `<button class="card" type="button" data-open="${i.id}">
    <div class="thumb">${thumb(i)}<span class="kind">${esc(catName(i.category_id))}${i.kind === 'carousel' && i.media.length ? ' · ' + i.media.length + ' slide' : ''}</span></div>
    <div class="meta"><div class="t">${esc(i.title)}</div>
    <div class="row"><span class="chip ${STATUS[i.status][1]}">${STATUS[i.status][0]}</span><span>💬 ${open(i)} terbuka</span></div>
    <div class="row">${esc(i.owner_name)} · ${fdate(i.created_at)}${i.version > 1 ? ' · v' + i.version : ''}</div></div></button>`).join('')
    || `<p class="empty">${base.length ? 'Belum ada konten dengan saringan ini.' : r === 'reviewer' ? 'Belum ada konten untuk direview.' : 'Belum ada konten. Klik "Upload konten" untuk mulai.'}</p>`}</div>`;
}
function wireList() {
  $('#app').onclick = e => {
    const t = e.target;
    const o = t.closest('[data-open]'); if (o) { view = { ...view, page: 'detail', id: o.dataset.open, slide: 0, active: null, draft: null }; render(); window.scrollTo(0, 0); return }
    const c = t.closest('[data-c]'); if (c) { view.cat = c.dataset.c; render(); return }
    const f = t.closest('[data-f]'); if (f) { view.filter = f.dataset.f; render(); return }
    if (t.closest('#upBtn')) openUpload();
    if (t.closest('#logout')) logout();
  };
  const a = document.querySelector('.cats [aria-pressed="true"]'); if (a) a.parentElement.scrollLeft = a.offsetLeft - a.parentElement.offsetLeft - 16;
}
async function logout() {
  if (profile) { await sb.auth.signOut(); } else { reviewerName = ''; ls('rk-reviewer', null); }
  tab = 'konten'; view.page = 'list'; render();
}

function detailHTML() {
  const it = item(), r = role(), isVid = it.kind === 'video', canPin = r !== 'kreator' && it.status !== 'arsip';
  const cs = commentsOf(it), mine = r === 'admin' || (profile && it.owner === profile.id);
  if (it.kind === 'carousel') view.slide = Math.min(view.slide, Math.max(0, it.media.length - 1));
  const media = !it.media.length ? `<div class="ph" style="aspect-ratio:4/5">📁 File sudah dipindah ke Google Drive</div>`
    : isVid ? `<video id="vid" src="${esc(url(it.media[0]))}" playsinline preload="metadata"></video>`
    : `<img src="${esc(url(it.media[it.kind === 'carousel' ? view.slide : 0]))}" alt="Slide ${view.slide + 1}">`;
  return `<button class="back" id="back" type="button">← Kembali ke daftar</button>
  <div class="head"><div><h1>${esc(it.title)}</h1><p class="sub">${esc(catName(it.category_id))} · ${esc(it.owner_name)} · ${fdate(it.created_at)}${it.version > 1 ? ' · versi ' + it.version : ''} · <span class="chip ${STATUS[it.status][1]}">${STATUS[it.status][0]}</span></p></div></div>
  <div class="detail">
   <div class="stage">
    ${it.status === 'arsip' ? `<p class="arcnote">📁 File sudah dipindah ke Google Drive dan dihapus dari website.${it.drive_link && r !== 'reviewer' ? ` <a href="${esc(it.drive_link)}" target="_blank" rel="noopener">Buka folder Drive</a>` : ''}</p>` : ''}
    ${it.media.length ? `<p class="hint">${canPin ? (isVid ? '<b>Jeda video</b> di detik yang mau dikomentari, lalu klik bagian videonya.' : '<b>Klik bagian gambar</b> yang perlu diedit untuk menaruh komentar.') : 'Pin kuning = komentar reviewer. Klik pin untuk membaca dan membalas.'}</p>` : ''}
    <div class="mediabox ${isVid ? 'video' : ''} ${canPin && it.media.length ? 'can-pin' : ''}" id="mbox">${media}<div id="pins"></div></div>
    ${isVid && it.media.length ? `<div class="ctrl"><button type="button" id="play" aria-label="Putar">▶</button><div class="bar" id="bar"><div class="fill" id="fill"></div>${cs.map(c => `<span class="tick" data-tick="${c.id}" style="left:0"></span>`).join('')}</div><span class="tc" id="tc">0:00 / 0:00</span></div>` : ''}
    ${it.kind === 'carousel' && it.media.length ? `<div class="slides">${it.media.map((m, k) => { const n = cs.filter(c => c.slide === k && !c.done).length; return `<button type="button" data-slide="${k}" aria-current="${k === view.slide}" aria-label="Slide ${k + 1}"><img src="${esc(url(m))}" alt="" loading="lazy">${n ? `<b>${n}</b>` : ''}</button>` }).join('')}</div>` : ''}
   </div>
   <aside class="panel">
    ${r === 'admin' ? `<div class="adm"><h3><span class="badge">Admin</span> Edit konten</h3>
     <label class="lbl">Judul<input id="aTitle" value="${esc(it.title)}" maxlength="120"></label>
     <label class="lbl">Kategori<select id="aCat">${D.cats.map(c => `<option value="${c.id}"${c.id === it.category_id ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
     <label class="lbl">Status<select id="aStatus">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === it.status ? ' selected' : ''}>${v[0]}</option>`).join('')}</select></label>
     <label class="lbl">Caption<textarea id="aCap" rows="3">${esc(it.caption)}</textarea></label>
     <div class="decide"><button class="btn" type="button" id="aSave">Simpan</button><button class="btn warn" type="button" id="aDel">Hapus konten</button></div>
     <p class="sub" id="aConfirm" hidden>Yakin hapus konten dan filenya? <button class="mini" type="button" id="aDelYes">Ya, hapus</button> <button class="mini" type="button" id="aDelNo">Batal</button></p>
    </div>` : ''}
    ${r !== 'kreator' && (it.status === 'wait' || it.status === 'rev' || it.status === 'ok') ? `<div class="decide"><button class="btn" type="button" data-status="ok">✓ Setujui</button><button class="btn warn" type="button" data-status="rev">Minta revisi</button></div>` : ''}
    ${r === 'kreator' && it.status === 'rev' ? `<div class="decide"><button class="btn" type="button" id="reup">Upload versi revisi</button></div>` : ''}
    ${it.status === 'ok' && mine ? `<div class="adm"><h3>Sudah diposting di Instagram?</h3><p class="sub" style="margin:0">File akan dipindah ke Google Drive sebagai backup, lalu dihapus dari website. Komentar tetap tersimpan.</p><div class="decide"><button class="btn" type="button" id="arc">Sudah diposting, arsipkan</button></div></div>` : ''}
    <h2>Komentar (${cs.filter(c => !c.done).length} terbuka)</h2>
    <div class="cmts">${cs.length ? cs.map(c => cmtHTML(it, c)).join('') : `<p class="empty">${canPin ? 'Belum ada komentar. Klik bagian konten untuk menambahkan.' : 'Belum ada komentar dari reviewer.'}</p>`}</div>
    <div><h3 style="font-size:16px;margin-bottom:6px">Caption</h3><div class="capt">${esc(it.caption || '–')}</div></div>
   </aside>
  </div>`;
}
function cmtHTML(it, c) {
  const where = c.slide != null ? `Slide ${c.slide + 1}` : c.t != null ? `Detik ${fmt(c.t)}` : 'Gambar';
  const r = role(), canDel = r === 'admin' || (r === 'reviewer' && c.by_name === reviewerName);
  const num = commentsOf(it).indexOf(c) + 1;
  return `<div class="cmt ${c.done ? 'done' : ''} ${view.active === c.id ? 'active' : ''}" data-cmt="${c.id}">
   <div class="who"><span class="num">${num}</span><b>${esc(c.by_name)}</b> · ${where}${c.done ? ' · ✓ selesai' : ''}</div>
   <p>${esc(c.text)}</p>
   ${repliesOf(c).map(x => `<div class="reply"><div class="who"><b>${esc(x.by_name)}</b></div>${esc(x.text)}</div>`).join('')}
   ${view.active === c.id ? `<div class="replybox"><input id="rep" placeholder="Tulis balasan…" aria-label="Balasan" maxlength="2000"><button class="mini" type="button" data-send="${c.id}">Kirim</button></div>
   <div class="acts"><button class="mini" type="button" data-done="${c.id}">${c.done ? 'Buka lagi' : '✓ Tandai selesai'}</button>${canDel ? `<button class="mini" type="button" data-del="${c.id}">Hapus</button>` : ''}</div>` : ''}
  </div>`;
}

function drawPins() {
  const it = item(), box = $('#pins'); if (!box || !it) return;
  const vid = $('#vid'), t = vid ? vid.currentTime : 0, cs = commentsOf(it);
  const show = cs.filter(c => it.kind === 'carousel' ? c.slide === view.slide : it.kind === 'video' ? (Math.abs(c.t - t) < 1.5) : true);
  let h = show.map(c => `<button type="button" class="pin ${c.done ? 'done' : ''} ${view.active === c.id ? 'active' : ''}" style="left:${c.x}%;top:${c.y}%" data-pin="${c.id}" aria-label="Komentar ${cs.indexOf(c) + 1}"><span>${cs.indexOf(c) + 1}</span></button>`).join('');
  if (view.draft) {
    const d = view.draft;
    h += `<span class="pin" style="left:${d.x}%;top:${d.y}%"><span>+</span></span>
    <div class="pop" style="left:clamp(4px,calc(${d.x}% - 130px),calc(100% - min(260px,90%) - 4px));top:${d.y > 60 ? `calc(${d.y}% - 170px)` : `calc(${d.y}% + 8px)`}">
     <textarea id="draftTxt" placeholder="Apa yang perlu diedit di sini?" aria-label="Komentar" maxlength="2000"></textarea>
     <div class="acts"><button class="btn ghost" type="button" id="dCancel">Batal</button><button class="btn" type="button" id="dSave">Kirim</button></div></div>`;
  }
  const keep = $('#draftTxt')?.value;
  box.innerHTML = h;
  if (view.draft) { const ta = $('#draftTxt'); if (keep) ta.value = keep; ta.focus(); ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#dSave').click() }) }
}

function wireDetail() {
  const it = item(), mbox = $('#mbox'), vid = $('#vid'), r = role();
  drawPins();
  mbox.addEventListener('click', e => {
    if (e.target.closest('.pop')) return;
    const p = e.target.closest('[data-pin]');
    if (p) { view.active = +p.dataset.pin; view.draft = null; render(); return }
    if (r === 'kreator' || it.status === 'arsip' || !it.media.length) return;
    if (vid && !vid.paused) vid.pause();
    const rc = mbox.getBoundingClientRect();
    view.draft = { x: +((e.clientX - rc.left) / rc.width * 100).toFixed(1), y: +((e.clientY - rc.top) / rc.height * 100).toFixed(1) };
    drawPins();
  });
  $('#pins').addEventListener('click', async e => {
    if (e.target.id === 'dCancel') { view.draft = null; drawPins(); if (pendingRender) { pendingRender = false; render() } }
    if (e.target.id === 'dSave') {
      const txt = $('#draftTxt').value.trim(); if (!txt) { toast('Tulis komentarnya dulu'); return }
      e.target.disabled = true;
      const row = { item_id: it.id, x: view.draft.x, y: view.draft.y, by_name: myName(), text: txt };
      if (it.kind === 'carousel') row.slide = view.slide; if (vid) row.t = +vid.currentTime.toFixed(1);
      const { data, error } = await sb.from('comments').insert(row).select().single();
      if (error) { e.target.disabled = false; return fail(error, 'Komentar gagal dikirim') }
      D.comments.push(data); view.draft = null; view.active = data.id; render(); toast('Komentar terkirim ke kreator');
    }
  });
  if (vid) {
    const play = $('#play'), fill = $('#fill'), tc = $('#tc'), bar = $('#bar');
    const upd = () => {
      const d = vid.duration || 1; fill.style.width = (vid.currentTime / d * 100) + '%'; tc.textContent = fmt(vid.currentTime) + ' / ' + fmt(vid.duration); play.textContent = vid.paused ? '▶' : '❚❚';
      document.querySelectorAll('[data-tick]').forEach(tk => { const c = D.comments.find(x => x.id == tk.dataset.tick); if (c) tk.style.left = (c.t / d * 100) + '%' });
      if (!view.draft) drawPins();
    };
    ['timeupdate', 'loadedmetadata', 'play', 'pause'].forEach(ev => vid.addEventListener(ev, upd));
    play.onclick = () => { view.draft = null; vid.paused ? vid.play() : vid.pause() };
    bar.onclick = e => { const rc = bar.getBoundingClientRect(); vid.currentTime = (e.clientX - rc.left) / rc.width * (vid.duration || 0) };
    const c = D.comments.find(x => x.id === view.active);
    if (c && c.t != null) { if (vid.readyState > 0) vid.currentTime = c.t; else vid.addEventListener('loadedmetadata', () => { vid.currentTime = c.t }, { once: true }) }
  }
  $('#app').onclick = async e => {
    const t = e.target;
    if (t.closest('#back')) { view = { ...view, page: 'list', active: null, draft: null }; render(); return }
    const sl = t.closest('[data-slide]'); if (sl) { view.slide = +sl.dataset.slide; view.draft = null; render(); return }
    if (t.closest('#aSave')) {
      const patch = { title: $('#aTitle').value.trim() || it.title, category_id: $('#aCat').value, status: $('#aStatus').value, caption: $('#aCap').value };
      const { error } = await sb.from('items').update(patch).eq('id', it.id); if (error) return fail(error, 'Gagal menyimpan');
      Object.assign(it, patch); render(); toast('Perubahan disimpan'); return
    }
    if (t.closest('#aDel')) { $('#aConfirm').hidden = false; return }
    if (t.closest('#aDelNo')) { $('#aConfirm').hidden = true; return }
    if (t.closest('#aDelYes')) {
      if (it.media.length) await sb.storage.from('media').remove(it.media);
      const { error } = await sb.from('items').delete().eq('id', it.id); if (error) return fail(error, 'Gagal menghapus');
      D.items = D.items.filter(x => x !== it); view = { ...view, page: 'list', id: null }; render(); toast('Konten dihapus'); return
    }
    if (t.closest('#arc')) {
      const b = t.closest('#arc'); b.disabled = true; b.textContent = 'Memindahkan ke Drive…';
      const { data, error } = await sb.functions.invoke('archive', { body: { item_id: it.id } });
      if (error || data?.error) { b.disabled = false; b.textContent = 'Sudah diposting, arsipkan'; let m = data?.error; if (!m && error?.context) { try { m = (await error.context.json()).error } catch (x) { } } return fail(new Error(m || error.message), 'Arsip gagal') }
      await loadAll(); render(); toast('Diarsipkan ke Google Drive'); return
    }
    if (t.closest('.adm')) return;
    const st = t.closest('[data-status]'); if (st) {
      const { error } = await sb.rpc('set_status', { p_item: it.id, p_status: st.dataset.status, p_by: myName() });
      if (error) return fail(error); it.status = st.dataset.status; render(); toast(it.status === 'ok' ? 'Konten disetujui' : 'Kreator diberi tahu untuk revisi'); return
    }
    if (t.closest('#reup')) { openUpload(it); return }
    const sd = t.closest('[data-send]'); if (sd) {
      const v = $('#rep').value.trim(); if (!v) return;
      const { data, error } = await sb.from('replies').insert({ comment_id: +sd.dataset.send, by_name: myName(), by_role: r, text: v }).select().single();
      if (error) return fail(error, 'Balasan gagal dikirim'); D.replies.push(data); render(); return
    }
    const dn = t.closest('[data-done]'); if (dn) {
      const c = D.comments.find(x => x.id == dn.dataset.done);
      const { error } = await sb.rpc('set_comment_done', { p_comment: c.id, p_done: !c.done }); if (error) return fail(error);
      c.done = !c.done; render(); return
    }
    const dl = t.closest('[data-del]'); if (dl) {
      const { error } = await sb.rpc('delete_comment', { p_comment: +dl.dataset.del, p_by: myName() }); if (error) return fail(error);
      D.comments = D.comments.filter(x => x.id != dl.dataset.del); view.active = null; render(); return
    }
    if (t.closest('input,.replybox')) return;
    const cm = t.closest('[data-cmt]'); if (cm) {
      const c = D.comments.find(x => x.id == cm.dataset.cmt); view.active = c.id; if (c.slide != null) view.slide = c.slide; view.draft = null; render();
      if (window.innerWidth < 860) $('#mbox').scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  };
}

// ---------- upload ----------
function openUpload(rev) {
  const defCat = rev ? rev.category_id : (view.cat !== 'all' ? view.cat : D.cats[0]?.id);
  $('#modalRoot').innerHTML = `<div class="modal"><form class="sheet" id="upf">
   <h2>${rev ? 'Upload versi revisi' : 'Upload konten'}</h2>
   ${rev ? `<p class="sub">${esc(rev.title)} · versi ${rev.version + 1}. File lama akan diganti, komentar tetap ada.</p>` : `
   <label>Judul<input id="uTitle" required maxlength="120" placeholder="mis. Poster Hari Pahlawan 2026"></label>
   <label>Kategori<select id="uCat">${D.cats.map(c => `<option value="${c.id}"${c.id === defCat ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>`}
   <label class="drop">Pilih file dari HP atau laptop (gambar, beberapa gambar untuk carousel, atau satu video; maks ${MAX_MB} MB per file)<input id="uFile" type="file" accept="image/*,video/*" multiple required></label>
   ${rev ? '' : '<label>Caption<textarea id="uCap" rows="3"></textarea></label>'}
   <div class="prog" id="uProg" hidden><div></div></div>
   <p class="err" id="uErr" hidden></p>
   <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" type="button" id="uX">Batal</button><button class="btn" type="submit" id="uGo">Kirim untuk review</button></div>
  </form></div>`;
  $('#uX').onclick = () => $('#modalRoot').innerHTML = '';
  $('#upf').onsubmit = async e => {
    e.preventDefault();
    const files = [...$('#uFile').files], err = $('#uErr'), show = m => { err.textContent = m; err.hidden = false };
    if (!profile) return show('Sesi kamu habis. Muat ulang halaman, lalu coba lagi.');
    if (!files.length) return show('Pilih file dulu.');
    const vids = files.filter(f => f.type.startsWith('video'));
    if (vids.length && files.length > 1) return show('Video harus diupload sendiri, satu file saja.');
    const big = files.find(f => f.size > MAX_MB * 1048576); if (big) return show(`${big.name} lebih dari ${MAX_MB} MB. Kompres dulu, misalnya dengan CapCut atau HandBrake.`);
    const kind = vids.length ? 'video' : files.length > 1 ? 'carousel' : 'image';
    const id = rev ? rev.id : crypto.randomUUID(), ver = rev ? rev.version + 1 : 1;
    const go = $('#uGo'), bar = $('#uProg'); go.disabled = true; bar.hidden = false; err.hidden = true;
    const paths = [];
    try {
      for (const [i, f] of files.entries()) {
        const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${profile.id}/${id}/v${ver}-${String(i + 1).padStart(2, '0')}.${ext}`;
        const { error } = await sb.storage.from('media').upload(path, f, { contentType: f.type });
        if (error) throw error;
        paths.push(path); bar.firstElementChild.style.width = ((i + 1) / files.length * 100) + '%';
      }
      if (rev) {
        const old = rev.media;
        const { error } = await sb.from('items').update({ media: paths, kind, version: ver, status: 'wait' }).eq('id', rev.id); if (error) throw error;
        if (old.length) await sb.storage.from('media').remove(old);
      } else {
        const { error } = await sb.from('items').insert({ id, title: $('#uTitle').value.trim(), category_id: $('#uCat').value, kind, caption: $('#uCap').value, media: paths, owner: profile.id, owner_name: profile.name });
        if (error) throw error;
      }
      $('#modalRoot').innerHTML = ''; await loadAll(); view = { ...view, page: 'detail', id, slide: 0, active: null }; render();
      toast(rev ? 'Revisi terkirim, reviewer diberi tahu' : 'Terkirim, reviewer diberi tahu');
    } catch (x) {
      if (paths.length && !rev) await sb.storage.from('media').remove(paths);
      go.disabled = false; bar.hidden = true; show('Upload gagal: ' + x.message);
    }
  };
}

// ---------- notifikasi ----------
function openNotif() {
  const ns = myNotifs();
  $('#modalRoot').innerHTML = `<div class="modal"><div class="sheet"><h2>Notifikasi</h2>
   <div class="notif">${ns.length ? ns.map(n => `<button type="button" data-n="${n.id}">${isRead(n) ? '' : '● '}${esc(n.text)}<br><small class="ver">${fdate(n.created_at)}</small></button>`).join('') : '<p class="empty">Belum ada notifikasi.</p>'}</div>
   <button class="btn ghost" type="button" id="nX">Tutup</button></div></div>`;
  $('#nX').onclick = () => $('#modalRoot').innerHTML = '';
  document.querySelectorAll('[data-n]').forEach(b => b.onclick = async () => {
    const n = D.notifs.find(x => x.id == b.dataset.n); await markRead(n); $('#modalRoot').innerHTML = '';
    tab = 'konten'; if (n.item_id && D.items.some(i => i.id === n.item_id)) view = { ...view, page: 'detail', id: n.item_id, slide: 0, active: null, draft: null };
    render();
  });
}

// ---------- pengaturan (admin) ----------
function setHTML() {
  const st = D.settings;
  return `<div class="set">
 <div class="head"><div><h1>Pengaturan <i>website</i></h1><p class="sub">Hanya admin yang melihat halaman ini. Perubahan tersimpan otomatis dan langsung terlihat oleh semua pengguna.</p></div></div>
 <section class="box"><h2>Identitas</h2>
  <div class="preview" id="sPrev">${brandHTML(st)}</div>
  <div class="fields">
   <label>Nama website<input type="text" id="sName" value="${esc(st.name)}" maxlength="40"></label>
   <label>Kata berwarna<input type="text" id="sAccent" value="${esc(st.accent)}" maxlength="40"></label>
   <label>Tagline<input type="text" id="sTag" value="${esc(st.tagline)}" maxlength="60"></label>
  </div>
  <div class="fields">
   <label>Logo (PNG transparan, warna putih paling cocok)<input type="file" id="sLogo" accept="image/*"></label>
   <div class="lbl">&nbsp;<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="mini" type="button" id="sLogoDef">Pakai logo KWaS</button><button class="mini" type="button" id="sLogoNone">Tanpa logo</button></div></div>
  </div>
  <div class="colors">
   <label><input type="color" id="sH1" value="${st.h1}"> Gradasi awal</label>
   <label><input type="color" id="sH2" value="${st.h2}"> Gradasi akhir</label>
   <label><input type="color" id="sH3" value="${st.h3}"> Aksen</label>
  </div>
 </section>
 <section class="box"><h2>Kategori konten</h2><p class="sub">Ubah emoji dan nama langsung di kotaknya. Konten di kategori yang dihapus menjadi "Tanpa kategori".</p>
  <div>${D.cats.map((c, k) => `<div class="lrow"><input class="emo" type="text" data-s-emo="${c.id}" value="${esc(c.emoji)}" aria-label="Emoji" maxlength="4"><input type="text" data-s-cat="${c.id}" value="${esc(c.label)}" aria-label="Nama kategori" maxlength="40">
   <div class="ibtns"><span class="n">${D.items.filter(i => i.category_id === c.id).length} konten</span><button class="ibtn" type="button" data-s-up="${k}" ${k ? '' : 'disabled'} aria-label="Naik">↑</button><button class="ibtn" type="button" data-s-down="${k}" ${k < D.cats.length - 1 ? '' : 'disabled'} aria-label="Turun">↓</button><button class="ibtn rm" type="button" data-s-rmcat="${c.id}" aria-label="Hapus">✕</button></div></div>`).join('')}</div>
  <div><button class="btn ghost" type="button" id="sAddCat">+ Tambah kategori</button></div>
 </section>
 <section class="box"><h2>Kreator &amp; admin</h2><p class="sub">Orang yang mendaftar otomatis menjadi kreator. Ubah perannya di sini.</p>
  <div>${D.profiles.map(u => `<div class="lrow user"><input type="text" data-s-un="${u.id}" value="${esc(u.name)}" aria-label="Nama" maxlength="60"><span class="ver" style="overflow-wrap:anywhere">${esc(u.email)}</span>
   <select data-s-ur="${u.id}" aria-label="Peran" ${u.id === profile.id ? 'disabled' : ''}><option value="kreator"${u.role === 'kreator' ? ' selected' : ''}>Kreator</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option></select>
   <button class="ibtn rm" type="button" data-s-rmu="${u.id}" ${u.id === profile.id ? 'disabled' : ''} aria-label="Hapus pengguna">✕</button></div>`).join('')}</div>
 </section>
 <section class="box"><h2>Reviewer</h2><p class="sub">Reviewer tidak punya akun. Ini daftar nama yang pernah memberi komentar.</p>
  <p>${[...new Set(D.comments.map(c => c.by_name))].map(n => `<span class="chip s-wait">${esc(n)}</span>`).join(' ') || '<span class="sub">Belum ada.</span>'}</p>
 </section></div>`;
}
function wireSet() {
  const st = D.settings, app = $('#app');
  const prev = () => { $('#sPrev').innerHTML = brandHTML(st); syncSite() };
  let saveT; const saveSet = patch => { Object.assign(st, patch); prev(); clearTimeout(saveT); saveT = setTimeout(async () => { const { error } = await sb.from('settings').update(patch).eq('id', 1); if (error) fail(error, 'Gagal menyimpan') }, 500) };
  const pend = {}; const later = (key, fn) => { clearTimeout(pend[key]); pend[key] = setTimeout(fn, 600) };
  app.oninput = e => {
    const t = e.target, d = t.dataset;
    const map = { sName: 'name', sAccent: 'accent', sTag: 'tagline', sH1: 'h1', sH2: 'h2', sH3: 'h3' };
    if (map[t.id]) return saveSet({ [map[t.id]]: t.value });
    if (d.sEmo) { const c = catOf(d.sEmo); c.emoji = t.value; later('e' + c.id, () => sb.from('categories').update({ emoji: c.emoji }).eq('id', c.id).then(r => r.error && fail(r.error))) }
    if (d.sCat) { const c = catOf(d.sCat); c.label = t.value; later('c' + c.id, () => sb.from('categories').update({ label: c.label }).eq('id', c.id).then(r => r.error && fail(r.error))) }
    if (d.sUn) { const u = D.profiles.find(x => x.id === d.sUn); u.name = t.value; later('u' + u.id, () => sb.from('profiles').update({ name: u.name }).eq('id', u.id).then(r => r.error && fail(r.error))) }
  };
  app.onchange = async e => {
    const t = e.target;
    if (t.dataset.sUr) { const { error } = await sb.from('profiles').update({ role: t.value }).eq('id', t.dataset.sUr); if (error) return fail(error); D.profiles.find(x => x.id === t.dataset.sUr).role = t.value; toast('Peran diperbarui') }
    if (t.id === 'sLogo' && t.files[0]) {
      const path = `${profile.id}/site/logo-${Date.now()}.${(t.files[0].name.split('.').pop() || 'png').toLowerCase()}`;
      const { error } = await sb.storage.from('media').upload(path, t.files[0], { contentType: t.files[0].type });
      if (error) return fail(error, 'Logo gagal diupload'); saveSet({ logo_url: path }); toast('Logo diganti');
    }
  };
  app.onclick = async e => {
    const t = e.target.closest('button'); if (!t || t.disabled) return; const d = t.dataset;
    if (t.id === 'sLogoDef') return saveSet({ logo_url: 'logo.png' });
    if (t.id === 'sLogoNone') return saveSet({ logo_url: '' });
    if (d.sUp || d.sDown) {
      const k = +(d.sUp ?? d.sDown), j = d.sUp ? k - 1 : k + 1;[D.cats[k], D.cats[j]] = [D.cats[j], D.cats[k]];
      await Promise.all(D.cats.map((c, i) => (c.sort = i + 1, sb.from('categories').update({ sort: i + 1 }).eq('id', c.id)))); render(); return
    }
    if (d.sRmcat) { const { error } = await sb.from('categories').delete().eq('id', d.sRmcat); if (error) return fail(error); D.cats = D.cats.filter(c => c.id !== d.sRmcat); D.items.forEach(i => { if (i.category_id === d.sRmcat) i.category_id = null }); render(); toast('Kategori dihapus'); return }
    if (t.id === 'sAddCat') { const { data, error } = await sb.from('categories').insert({ label: 'Kategori baru', emoji: '📌', sort: D.cats.length + 1 }).select().single(); if (error) return fail(error); D.cats.push(data); render(); const el = document.querySelector(`[data-s-cat="${data.id}"]`); el.focus(); el.select(); return }
    if (d.sRmu) {
      if (t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = '?'; toast('Klik sekali lagi untuk menghapus pengguna ini'); return }
      const { error } = await sb.from('profiles').delete().eq('id', d.sRmu); if (error) return fail(error); D.profiles = D.profiles.filter(u => u.id !== d.sRmu); render(); toast('Pengguna dihapus'); return
    }
  };
}

// ---------- start ----------
document.querySelector('.top').addEventListener('click', e => {
  const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; render(); return }
  if (e.target.closest('#home')) { tab = 'konten'; view = { ...view, page: 'list', active: null, draft: null }; render(); return }
  if (e.target.closest('#bell')) openNotif();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modalRoot').innerHTML = ''; if (view.draft) { view.draft = null; drawPins() } } });

(async function start() {
  if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('ISI-')) { $('#app').innerHTML = '<p class="empty">Website belum disambungkan ke Supabase. Isi file <b>config.js</b> sesuai PANDUAN.md.</p>'; return }
  try {
    session = (await sb.auth.getSession()).data.session;
    await loadProfile(); await loadAll(); render();
  } catch (e) { $('#app').innerHTML = `<p class="empty">Gagal memuat data: ${esc(e.message)}</p>`; return }
  sb.auth.onAuthStateChange((ev, s) => {
    // Supabase juga mengirim SIGNED_IN saat tab kembali aktif (misalnya setelah memilih file); abaikan kalau orangnya sama
    const same = s?.user?.id && s.user.id === session?.user?.id && profile;
    if (ev === 'TOKEN_REFRESHED' || ev === 'INITIAL_SESSION' || ev === 'USER_UPDATED' || (ev === 'SIGNED_IN' && same)) { session = s; return }
    session = s;
    // query Supabase di dalam callback ini bisa macet, jadi ditunda sebentar
    setTimeout(async () => {
      await loadProfile(); await loadAll(); tab = 'konten'; view.page = 'list'; render();
      if (ev === 'SIGNED_IN' && profile) toast('Halo, ' + profile.name);
    }, 0);
  });
  sb.channel('semua').on('postgres_changes', { event: '*', schema: 'public' }, scheduleReload).subscribe();
})();
