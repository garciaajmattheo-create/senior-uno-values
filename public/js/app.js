// =====================================================================
//  SENIOR UNO VALUES — the logged-in app (teachers, advisers, principal)
// =====================================================================
import { sb, configured, rpc, cleanError, CORE_VALUES, MARKS, MARK_NAMES, fmt } from './supa.js';
import { esc, icon, toast, modal, confirmBox, timeAgo, dateTime, initials, busy, download, csvCell } from './ui.js';
import { parsePasted, parseRows, parseSF1, readFileRows, TEMPLATE_CSV } from './importer.js';
import { registerSW, enablePush, disablePush, pushState, isIOS, isStandalone } from './push.js';

const view = document.getElementById('view');
let me = null;
let navToken = 0;
let cleanup = [];
const onLeave = (fn) => cleanup.push(fn);

// ---------- small render helpers ----------
const badge = (l, sm) => l
  ? `<span class="badge ${l}${sm ? ' sm' : ''}" title="${MARK_NAMES[l]}">${l}</span>`
  : `<span class="badge none${sm ? ' sm' : ''}" title="No marks yet">—</span>`;
const studentName = (s) => `${s.last_name}, ${s.first_name}${s.middle_name ? ' ' + s.middle_name.charAt(0) + '.' : ''}`;
const errorBox = (m) => `<div class="panel glass" style="max-width:640px;margin:40px auto;text-align:center;align-items:center">
  ${icon('info', 34, '#F2C230')}<h2>Something went wrong</h2><p class="muted">${esc(m)}</p>
  <a class="btn btn-ghost" href="#/sections">Go to My Sections</a></div>`;
const termLine = () => me.term ? `Term ${me.term.term_no} · S.Y. ${esc(me.year?.name || '')}` : 'No active term';

// =====================================================================
//  Start-up
// =====================================================================
async function boot() {
  if (!configured) {
    view.innerHTML = `<div class="panel glass" style="max-width:640px;margin:60px auto">
      <h2>Almost there</h2><p class="muted">This website is not connected to its database yet.
      Fill in <b>js/config.js</b> with your Supabase project URL and anon key (see README.md).</p></div>`;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace('login.html'); return; }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.replace('login.html'); });
  try { me = await rpc('whoami'); } catch (e) { view.innerHTML = errorBox(e.message); return; }
  if (!me) { view.innerHTML = errorBox('Your account profile was not found. Please sign up again or contact the principal.'); return; }
  setupShell();
  if (me.status !== 'approved') { renderPending(); return; }
  registerSW();
  listenNotifications();
  window.addEventListener('hashchange', route);
  route();
}

async function refreshMe() {
  try { me = await rpc('whoami'); updateShell(); } catch (e) { /* keep old */ }
}

function setupShell() {
  const icons = { sections: 'grid', advisory: 'school', admin: 'shield', notifications: 'bell', settings: 'user' };
  document.querySelectorAll('.icon-btn[data-nav]').forEach((a) => { a.innerHTML = icon(icons[a.dataset.nav]); });
  document.querySelectorAll('[data-logout]').forEach((b) => { b.innerHTML = icon('logout'); b.addEventListener('click', logout); });
  if (me.status === 'approved') {
    ['rail', 'topbar', 'bottombar'].forEach((id) => { document.getElementById(id).hidden = false; });
  }
  updateShell();
}

function updateShell() {
  document.getElementById('meName').textContent = me.full_name;
  document.getElementById('meRole').textContent = me.role === 'admin' ? 'Principal / Coordinator'
    : me.my_section ? 'Class Adviser · ' + me.my_section.name : 'Subject Teacher';
  document.getElementById('meInit').textContent = initials(me.full_name);
  document.querySelectorAll('[data-nav="admin"]').forEach((a) => { a.hidden = me.role !== 'admin'; });
  document.querySelectorAll('[data-nav="notifications"]').forEach((a) => {
    a.querySelector('.dot')?.remove();
    if (me.unread > 0) a.insertAdjacentHTML('beforeend', '<span class="dot" aria-hidden="true"></span>');
    a.setAttribute('aria-label', me.unread > 0 ? `Notifications (${me.unread} unread)` : 'Notifications');
  });
}

function setActive(page) {
  const map = { rate: 'sections', tiebreak: 'sections' };
  const key = map[page] || page;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === key;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function logout() {
  await sb.auth.signOut();
  location.replace('login.html');
}

function listenNotifications() {
  const ch = sb.channel('notif-' + me.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.id}` }, (p) => {
      me.unread = (me.unread || 0) + 1;
      updateShell();
      toast(p.new.title + (p.new.body ? ' — ' + p.new.body : ''), 'info', 6000);
    })
    .subscribe();
  window.addEventListener('beforeunload', () => sb.removeChannel(ch));
}

// =====================================================================
//  Router
// =====================================================================
async function route() {
  cleanup.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  cleanup = [];
  const token = ++navToken;
  const ctx = { alive: () => token === navToken };
  const [page, arg] = (location.hash.replace(/^#\/?/, '') || 'sections').split('/');
  setActive(page);
  view.innerHTML = '<div class="spinner" role="status" aria-label="Loading"></div>';
  window.scrollTo(0, 0);
  try {
    if (page === 'sections') await viewSections(ctx);
    else if (page === 'rate' && arg) await viewRate(ctx, arg);
    else if (page === 'tiebreak' && arg) await viewTiebreak(ctx, arg);
    else if (page === 'advisory') await viewAdvisory(ctx, arg);
    else if (page === 'admin' && me.role === 'admin') await viewAdmin(ctx);
    else if (page === 'notifications') await viewNotifications(ctx);
    else if (page === 'settings') await viewSettings(ctx);
    else location.hash = '#/sections';
    if (ctx.alive()) countUp(view);
  } catch (e) {
    if (ctx.alive()) view.innerHTML = errorBox(e.message);
  }
}

// Big numbers count up from 0 when a screen opens.
function countUp(root) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('.stat .v').forEach((el) => {
    const node = el.firstChild;
    if (!node || node.nodeType !== 3) return;
    const target = parseInt(node.textContent, 10);
    if (!Number.isFinite(target) || target <= 0) return;
    const t0 = performance.now(), dur = 900;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      node.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(tick);
    };
    node.textContent = '0';
    requestAnimationFrame(tick);
  });
}

// =====================================================================
//  Waiting for approval
// =====================================================================
function renderPending() {
  const declined = me.status === 'declined';
  view.innerHTML = `<div class="panel glass" style="max-width:560px;margin:8vh auto;text-align:center;align-items:center;gap:16px">
    <img src="assets/logo.png" alt="" style="width:88px;height:88px;object-fit:contain">
    <h1 style="font-size:32px">${declined ? 'Account not approved' : 'Waiting for approval'}</h1>
    <p class="muted">${declined
      ? 'The principal did not approve this account. If you think this is a mistake, please talk to the principal or coordinator.'
      : `Hi ${esc(me.full_name)}! Your account was created. The principal or coordinator needs to approve it before you can rate sections. You'll get an email once it's approved.`}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <button class="btn btn-primary" type="button" id="recheck">Check again</button>
      <button class="btn btn-ghost" type="button" id="lo">Log out</button></div></div>`;
  document.getElementById('lo').onclick = logout;
  document.getElementById('recheck').onclick = () => location.reload();
}

// =====================================================================
//  MY SECTIONS (teacher home)
// =====================================================================
async function viewSections(ctx) {
  const [secs, notesRes] = await Promise.all([
    me.term ? rpc('my_sections') : Promise.resolve([]),
    sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(4),
  ]);
  if (!ctx.alive()) return;
  const notes = notesRes.data || [];
  const open = secs.filter((s) => s.voting_open && !s.needs_code).length;
  const rated = secs.reduce((a, s) => a + (s.needs_code ? 0 : s.rated), 0);
  const total = secs.reduce((a, s) => a + (s.needs_code ? 0 : s.total), 0);

  const card = (s) => {
    let pill, cta, href, style = 'btn-light';
    if (s.needs_code) { pill = '<span class="pill warn">Code changed</span>'; cta = 'Enter new code'; href = '#code'; }
    else if (s.tiebreak && !s.tiebreak.voted) { pill = '<span class="pill gold">Tie-break vote</span>'; cta = 'Cast tie-break vote'; href = `#/tiebreak/${s.section_id}`; style = 'btn-gold'; }
    else if (s.voting_open) { pill = '<span class="pill open">Voting open</span>'; cta = s.rated ? 'Continue rating' : 'Start rating'; href = `#/rate/${s.section_term_id}`; }
    else { pill = '<span class="pill closed">Closed</span>'; cta = 'View results'; href = `#/rate/${s.section_term_id}`; style = 'btn-ghost'; }
    const pct = s.total ? Math.round((s.rated / s.total) * 100) : 0;
    return `<article class="sec-card glass">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="min-width:0"><h3 style="font-size:22px">${esc(s.name)}</h3>
          <p class="small muted" style="margin-top:4px">${s.is_adviser ? 'Your advisory class' : 'Adviser: ' + esc(s.adviser_name)}</p></div>
        ${pill}</div>
      <div><div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-2);margin-bottom:8px">
        <span>${s.rated} of ${s.total} rated${s.submitted ? ' · submitted ✓' : ''}</span><span>${pct}%</span></div>
        <div class="progress ${pct === 100 ? 'full' : ''}"><span style="width:${pct}%"></span></div></div>
      ${s.voting_open && s.closes_at && !s.needs_code ? `<p class="small muted">Closes ${esc(dateTime(s.closes_at))}</p>` : ''}
      <a class="btn ${style}" href="${href}" ${href === '#code' ? 'data-focus-code' : ''}>${cta}</a></article>`;
  };

  view.innerHTML = `
    <section class="page-head">
      <div><p class="eyebrow">${termLine()}</p><h1>My Sections</h1></div>
      <div class="stats">
        <div class="stat"><div class="k">Sections linked</div><div class="v">${secs.length}</div></div>
        <div class="stat"><div class="k">Voting open</div><div class="v" style="color:var(--lime)">${open}</div></div>
        <div class="stat"><div class="k">Students rated</div><div class="v">${rated}<small>/${total}</small></div></div>
      </div>
    </section>
    <div class="row">
      <section class="panel glass" style="flex:2 1 440px" aria-labelledby="addh">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="width:44px;height:44px;border-radius:14px;background:rgba(242,194,48,.18);display:flex;align-items:center;justify-content:center">${icon('key', 22, '#F2C230')}</span>
          <div><h2 id="addh">Add a section by code</h2><p class="small muted">Ask the class adviser for this term's access code.</p></div>
        </div>
        ${me.term ? `<form id="codeForm" style="display:flex;flex-wrap:wrap;gap:10px">
          <label style="flex:1 1 220px"><span class="sr-only">Access code</span>
            <input class="field code" id="codeInput" name="code" placeholder="XXX-XXX" maxlength="8" autocomplete="off" autocapitalize="characters" required></label>
          <button class="btn btn-primary" type="submit">Link section</button></form>
          <div id="codeMsg" role="status"></div>`
        : '<p class="note">The principal has not started a term yet. You can link sections once a term is active.</p>'}
      </section>
      <section class="panel glass" style="flex:1 1 300px" aria-labelledby="noth">
        <div class="panel-head"><h2 id="noth">Notifications</h2><a class="small" href="#/notifications">See all</a></div>
        ${notes.length ? notes.map(noteItem).join('') : '<p class="small muted">No notifications yet.</p>'}
      </section>
    </div>
    ${!me.my_section && me.role !== 'admin' ? `<div class="note" style="align-items:center">${icon('school', 20, '#F2C230')}
      <span style="flex:1">Are you a class adviser? Set up your advisory section and upload your class list.</span>
      <a class="btn btn-gold btn-sm" href="#/advisory">Set up advisory</a></div>` : ''}
    ${secs.length ? `<div class="cards">${secs.map(card).join('')}</div>`
      : `<div class="panel glass empty">${icon('grid', 34, '#A9C2B0')}<p>No sections yet. Enter an access code above to add the sections you handle this term.</p></div>`}`;

  view.querySelectorAll('[data-focus-code]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); const i = document.getElementById('codeInput'); i?.focus(); i?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  bindNoteClicks(view);
  const f = document.getElementById('codeForm');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); const msg = document.getElementById('codeMsg');
    busy(btn, true, 'Linking…'); msg.innerHTML = '';
    try {
      const r = await rpc('link_section', { p_code: f.code.value });
      toast(`Linked: ${r.name}`);
      route();
    } catch (err) {
      msg.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
      busy(btn, false);
    }
  });
}

function noteItem(n) {
  return `<a class="notif ${n.is_read ? 'read' : ''}" href="${esc(n.link || '#/notifications')}" data-note="${n.id}">
    <span class="d"></span><span class="small"><b>${esc(n.title)}</b>${n.body ? ' ' + esc(n.body) : ''}<br><span class="when">${esc(timeAgo(n.created_at))}</span></span></a>`;
}
function bindNoteClicks(root) {
  root.querySelectorAll('[data-note]').forEach((a) => a.addEventListener('click', async () => {
    if (a.classList.contains('read')) return;
    await sb.from('notifications').update({ is_read: true }).eq('id', a.dataset.note);
    me.unread = Math.max(0, (me.unread || 1) - 1); updateShell();
  }));
}

// =====================================================================
//  RATING SCREEN
// =====================================================================
async function viewRate(ctx, stId) {
  let data = await rpc('rating_sheet', { p_st: stId });
  if (!ctx.alive()) return;
  const st = data.section_term;
  const students = data.students;
  const open = st.voting_open;

  const isDone = (s) => [1, 2, 3, 4].every((k) => s.mine && s.mine[k]);
  const rowHtml = (s, i) => `
    <div class="rate-row ${isDone(s) || !open ? '' : 'todo'}" data-sid="${s.id}">
      <div class="stu"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="nm" title="${esc(studentName(s))}">${esc(studentName(s))}</span></div>
      ${CORE_VALUES.map((cv, j) => `<div class="cv"><span class="cv-label">${cv}</span>
        <div class="segm" role="radiogroup" aria-label="${esc(cv)}, ${esc(studentName(s))}">
          ${MARKS.map((m) => `<button type="button" role="radio" class="${m}" aria-checked="${(s.mine && s.mine[j + 1]) === m}"
             data-cv="${j + 1}" data-m="${m}" title="${MARK_NAMES[m]}" ${open ? '' : 'disabled'}>${m}</button>`).join('')}
        </div></div>`).join('')}
      <div class="live" title="Live average of all teachers"><span class="num">${fmt(s.overall)}</span>${badge(s.letter)}</div>
    </div>`;

  view.innerHTML = `
    <section class="page-head">
      <div style="display:flex;align-items:center;gap:14px">
        <a class="icon-btn glass" href="#/sections" aria-label="Back to My Sections">${icon('back', 20)}</a>
        <div><p class="eyebrow">Term ${st.term_no} · ${open ? 'Voting open' + (st.closes_at ? ' until ' + esc(dateTime(st.closes_at)) : '') : 'Voting closed'}</p>
          <h1 style="font-size:clamp(28px,3.4vw,44px)">${esc(st.name)}</h1></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
        <span class="pill closed glass" id="saveState" style="padding:10px 16px">${icon('check', 16, '#9BE04A', 2.4)} Saved automatically</span>
        ${open ? `<button class="btn btn-gold" type="button" id="submitBtn">${st.submitted ? 'Submitted ✓ Update' : 'Submit ratings'}</button>` : ''}
      </div>
    </section>
    ${!open ? '<div class="note">Voting for this section is closed. You can still see the live averages.</div>' : ''}
    ${st.is_adviser ? '<div class="note">You are the class adviser. Your marks count for 30% of each student\'s average.</div>' : ''}
    <div class="row">
      <section class="panel glass" style="flex:1 1 240px">
        <span class="small muted">Your progress</span>
        <span class="stat"><span class="v" id="progNum">0</span></span>
        <div class="progress"><span id="progBar" style="width:0%"></span></div>
      </section>
      <section class="panel glass" style="flex:2 1 520px" aria-labelledby="leadh">
        <div class="panel-head"><h2 id="leadh">Live leaderboard</h2><span class="small muted">All teachers · adviser counts 30%</span></div>
        <div class="lead-grid" id="leaders"></div>
      </section>
    </div>
    <section class="panel glass" style="padding:8px" aria-labelledby="rh">
      <div class="panel-head" style="padding:14px 16px 6px">
        <h2 id="rh">Rate each student</h2>
        <div class="legend"><span><b class="t-AO">AO</b> Always</span><span><b class="t-SO">SO</b> Sometimes</span><span><b class="t-RO">RO</b> Rarely</span><span><b class="t-NO">NO</b> Not Observed</span></div>
      </div>
      ${students.length ? `<div class="rate-head"><span>Student</span>${CORE_VALUES.map((c) => `<span>${c}</span>`).join('')}<span style="text-align:right">Live average</span></div>
        <div id="rows">${students.map(rowHtml).join('')}</div>`
      : '<p class="empty">The adviser has not added students to this section yet.</p>'}
    </section>`;

  const byId = Object.fromEntries(students.map((s) => [s.id, s]));
  function paintSummary() {
    const done = students.filter(isDone).length;
    document.getElementById('progNum').innerHTML = `${done}<small>/${students.length} students</small>`;
    document.getElementById('progBar').style.width = (students.length ? Math.round((done / students.length) * 100) : 0) + '%';
    const top = students.filter((s) => s.overall != null).sort((a, b) => b.overall - a.overall).slice(0, 3);
    document.getElementById('leaders').innerHTML = top.length ? top.map((s, i) => `
      <div class="lead ${i === 0 ? 'first' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-family:var(--font-display);color:var(--muted)">#${i + 1}</b>${badge(s.letter, true)}</div>
        <span style="font-weight:700;margin-top:8px">${esc(studentName(s))}</span>
        <span class="sc">${fmt(s.overall)}</span>
        ${i === 0 ? '<span class="small" style="font-weight:700;color:var(--gold);letter-spacing:.06em;text-transform:uppercase">Leading for Conduct Award</span>' : ''}
      </div>`).join('') : '<p class="small muted">No marks yet.</p>';
  }
  function paintLive() {
    view.querySelectorAll('.rate-row').forEach((row) => {
      const s = byId[row.dataset.sid];
      const live = row.querySelector('.live');
      const before = live.textContent;
      live.innerHTML = `<span class="num">${fmt(s.overall)}</span>${badge(s.letter)}`;
      if (before !== live.textContent) live.querySelector('.badge')?.classList.add('bump');
      row.classList.toggle('todo', open && !isDone(s));
    });
    paintSummary();
  }
  paintSummary();

  // Refresh live averages (debounced) — from realtime events, saves and a timer.
  let t = null;
  const refreshSoon = (ms = 700) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const d = await rpc('rating_sheet', { p_st: stId });
        if (!ctx.alive()) return;
        d.students.forEach((n) => { const s = byId[n.id]; if (s) { s.overall = n.overall; s.letter = n.letter; } });
        paintLive();
      } catch (e) { /* ignore temporary errors */ }
    }, ms);
  };
  const ch = sb.channel('st-' + stId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'section_term_activity', filter: `section_term_id=eq.${stId}` }, () => refreshSoon(300))
    .subscribe();
  const iv = setInterval(() => refreshSoon(0), 30000);
  onLeave(() => { sb.removeChannel(ch); clearInterval(iv); clearTimeout(t); });

  // Clicking a mark saves it right away. Clicking the selected mark again clears it.
  const chains = {};
  let pending = 0;
  const saveState = document.getElementById('saveState');
  const setSaving = () => { saveState.innerHTML = pending ? 'Saving…' : `${icon('check', 16, '#9BE04A', 2.4)} Saved automatically`; };
  const rows = document.getElementById('rows');
  if (rows && open) rows.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    const row = b.closest('.rate-row'); const s = byId[row.dataset.sid];
    const cv = Number(b.dataset.cv); const m = b.dataset.m;
    s.mine = s.mine || {};
    const prev = s.mine[cv] || null;
    const next = prev === m ? null : m;
    if (next) s.mine[cv] = next; else delete s.mine[cv];
    b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.m === next)));
    row.classList.toggle('todo', !isDone(s));
    paintSummary();
    const key = s.id + ':' + cv;
    pending++; setSaving();
    chains[key] = (chains[key] || Promise.resolve()).then(() =>
      rpc('save_rating', { p_st: stId, p_student: s.id, p_core: cv, p_mark: next })
    ).then(() => refreshSoon()).catch((err) => {
      toast(err.message, 'error');
      if (prev) s.mine[cv] = prev; else delete s.mine[cv];
      b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.m === prev)));
      row.classList.toggle('todo', !isDone(s)); paintSummary();
    }).finally(() => { pending--; setSaving(); });
  });

  const sub = document.getElementById('submitBtn');
  if (sub) sub.addEventListener('click', async () => {
    busy(sub, true, 'Submitting…');
    try {
      await Promise.all(Object.values(chains));
      await rpc('submit_ratings', { p_st: stId });
      toast('Ratings submitted. Thank you!');
      sub.dataset.label = 'Submitted ✓ Update';
    } catch (err) { toast(err.message, 'error'); }
    busy(sub, false);
  });
}

// =====================================================================
//  TIE-BREAK VOTE
// =====================================================================
async function viewTiebreak(ctx, sectionId) {
  const info = await rpc('tiebreak_info', { p_section: sectionId });
  if (!ctx.alive()) return;
  if (!info) { view.innerHTML = errorBox('There is no tie-break vote for this section.'); return; }
  const open = info.status === 'open';
  let choice = info.my_vote;
  const winner = info.candidates.find((c) => c.id === info.winner_id);

  view.innerHTML = `
    <section class="page-head"><div style="display:flex;align-items:center;gap:14px">
      <a class="icon-btn glass" href="#/sections" aria-label="Back">${icon('back', 20)}</a>
      <div><p class="eyebrow">Conduct Award · Tie-break</p><h1 style="font-size:clamp(28px,3.4vw,44px)">${esc(info.section_name)}</h1></div></div></section>
    ${winner ? `<div class="tie-banner"><span class="ico">${icon('trophy', 28, '#06110A')}</span>
      <div style="flex:1 1 300px"><p class="eyebrow" style="color:var(--gold)">Conduct Awardee</p>
      <h2 style="font-size:30px">${esc(winner.name)}</h2>
      <p class="small" style="color:#EADFB8">${info.decided_by_adviser ? 'The tie-break vote was also tied, so the adviser decided.' : 'Chosen by the teachers\' tie-break vote.'}</p></div></div>` : ''}
    <section class="panel glass" style="max-width:760px">
      <h2>${open ? 'Who should receive the Conduct Award?' : 'Tie-break results'}</h2>
      <p class="small muted">These students have the same final mark. ${open ? 'Pick one. You can change your vote until the adviser closes it.' : ''}</p>
      <div role="radiogroup" aria-label="Candidates" style="display:flex;flex-direction:column;gap:10px" id="cands">
        ${info.candidates.map((c) => `<button type="button" class="cand" role="radio" aria-checked="${c.id === choice}" data-id="${c.id}" ${open ? '' : 'disabled'}>
          <span><b style="font-size:17px">${esc(c.name)}</b><br><span class="small muted">Final mark ${fmt(c.final)}</span></span>
          <span style="display:flex;align-items:center;gap:10px">${c.votes != null ? `<span class="small">${c.votes} vote${c.votes === 1 ? '' : 's'}</span>` : ''}${c.id === info.winner_id ? icon('trophy', 22, '#F2C230') : ''}</span>
        </button>`).join('')}
      </div>
      ${open ? `<button class="btn btn-gold" type="button" id="voteBtn" ${choice ? '' : 'disabled'}>${info.my_vote ? 'Update my vote' : 'Cast my vote'}</button>` : ''}
      ${info.is_adviser && open ? `<div style="height:1px;background:rgba(255,255,255,.12)"></div>
        <p class="small muted">${info.total_votes} vote(s) so far. As adviser, close the vote when everyone has voted.</p>
        <button class="btn btn-warn" type="button" id="closeTb">Close tie-break vote</button><div id="decide"></div>` : ''}
    </section>`;

  const cands = document.getElementById('cands');
  if (open) cands.addEventListener('click', (e) => {
    const b = e.target.closest('.cand'); if (!b) return;
    choice = b.dataset.id;
    cands.querySelectorAll('.cand').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    document.getElementById('voteBtn').disabled = false;
  });
  document.getElementById('voteBtn')?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await rpc('vote_tiebreak', { p_tiebreak: info.id, p_student: choice }); toast('Your vote was saved.'); route(); }
    catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  });
  document.getElementById('closeTb')?.addEventListener('click', async (e) => {
    if (!(await confirmBox('Close the tie-break?', 'Teachers will no longer be able to vote.', 'Close vote', true))) return;
    try {
      const r = await rpc('close_tiebreak', { p_tiebreak: info.id });
      if (r.result === 'winner') { toast('The Conduct Awardee has been decided.'); route(); return; }
      const tied = info.candidates.filter((c) => r.tied_ids.includes(c.id));
      document.getElementById('decide').innerHTML = `<div class="note" style="flex-direction:column">
        <b>The vote is still tied.</b><span>As the class adviser, choose the Conduct Awardee:</span>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${tied.map((c) => `<button type="button" class="btn btn-gold btn-sm" data-decide="${c.id}">${esc(c.name)}</button>`).join('')}</div></div>`;
      document.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmBox('Confirm awardee', `Choose ${b.textContent} as the Conduct Awardee?`, 'Confirm'))) return;
        try { await rpc('close_tiebreak', { p_tiebreak: info.id, p_decide: b.dataset.decide }); toast('The Conduct Awardee has been decided.'); route(); }
        catch (err) { toast(err.message, 'error'); }
      }));
    } catch (err) { toast(err.message, 'error'); }
  });
}

// =====================================================================
//  MY ADVISORY (adviser dashboard; the principal can open any section)
// =====================================================================
async function viewAdvisory(ctx, argId) {
  const sid = argId || me.my_section?.id;
  if (!sid) return renderCreateSection(ctx);
  const [ov, standings] = await Promise.all([rpc('advisory_overview', { p_section: sid }), rpc('standings', { p_section: sid })]);
  let tbInfo = ov.tiebreak ? await rpc('tiebreak_info', { p_section: sid }) : null;
  if (!ctx.alive()) return;
  const sec = ov.section; const st = ov.section_term;
  const teachers = ov.teachers || [];
  const finished = teachers.filter((t) => t.submitted).length;
  let tab = me.term ? 't' + me.term.term_no : 'final';

  view.innerHTML = `
    <section class="page-head">
      <div><p class="eyebrow">${argId && me.role === 'admin' ? 'Section view' : 'My Advisory'} · ${termLine()}</p>
        <h1>${esc(sec.name)}</h1>${argId ? `<p class="small muted" style="margin-top:6px">Adviser: ${esc(sec.adviser_name)}</p>` : ''}</div>
      <div class="tabs glass" role="tablist" aria-label="Term" id="termTabs" style="display:flex">
        ${['t1', 't2', 't3', 'final'].map((k) => `<button type="button" role="tab" data-tab="${k}" class="btn btn-sm" style="background:transparent;color:#DDE9E0">${k === 'final' ? 'Final' : 'Term ' + k[1]}</button>`).join('')}
      </div>
    </section>
    ${st ? `<div class="row">
      <section class="panel glass" style="flex:1 1 320px" aria-labelledby="codeh">
        <div class="panel-head"><h2 id="codeh">Section access code</h2><span class="small muted">Term ${st.term_no}</span></div>
        <div class="code-box"><span id="codeText">${esc(st.access_code)}</span></div>
        <div style="display:flex;gap:10px"><button class="btn btn-ghost" style="flex:1" type="button" id="copyCode">${icon('copy', 18)} Copy</button>
          <button class="btn btn-gold" style="flex:1" type="button" id="regen">${icon('refresh', 18)} Regenerate</button></div>
        <p class="small muted">Share this code only with the subject teachers of this section. Regenerating stops the old code at once; teachers re-enter the new one and their saved ratings stay.</p>
      </section>
      <section class="panel glass" style="flex:1 1 340px" aria-labelledby="voteh">
        <div class="panel-head"><h2 id="voteh">Voting · Term ${st.term_no}</h2>${st.voting_open ? '<span class="pill open">Open</span>' : '<span class="pill closed">Closed</span>'}</div>
        <div class="stats" style="gap:28px">
          <div class="stat"><div class="k">Teachers linked</div><div class="v" style="font-size:44px">${teachers.filter((t) => t.active).length}</div></div>
          <div class="stat"><div class="k">Finished rating</div><div class="v" style="font-size:44px;color:var(--lime)">${finished}<small>/${teachers.length}</small></div></div>
        </div>
        <div class="chips">${teachers.map((t) => `<span class="chip ${t.submitted ? 'ok' : !t.active ? 'off' : ''}">${esc(t.name)}${t.is_adviser ? ' (Adviser)' : ''} · ${t.submitted ? 'done ✓' : !t.active ? 'needs new code' : t.rated + '/' + ov.student_count}</span>`).join('') || '<span class="small muted">No teachers have linked yet. Share the access code.</span>'}</div>
        ${st.voting_open
          ? `${st.closes_at ? `<p class="small muted">Closes ${esc(dateTime(st.closes_at))}</p>` : ''}<button class="btn btn-warn" type="button" id="closeVote">Close voting for Term ${st.term_no}</button>`
          : `<label class="label">Deadline (optional)<input class="field" type="datetime-local" id="closesAt"></label>
             <button class="btn btn-primary" type="button" id="openVote">${teachers.some((t) => t.rated) ? 'Reopen voting' : 'Open voting'}</button>`}
      </section>
      <section class="panel glass" style="flex:1 1 320px" aria-labelledby="listh">
        <div class="panel-head"><h2 id="listh">Class list</h2><span class="small muted">${ov.student_count} students</span></div>
        <button class="opt" type="button" data-import="paste">${icon('paste', 20, '#9BE04A')} Paste names from a spreadsheet</button>
        <button class="opt" type="button" data-import="file">${icon('upload', 20, '#9BE04A')} Upload Excel / CSV file</button>
        <button class="opt" type="button" data-import="sf1">${icon('file', 20, '#9BE04A')} Import School Form 1 (SF1)</button>
        <button class="opt" type="button" data-import="one">${icon('plus', 20, '#9BE04A')} Add a student</button>
        <button class="btn btn-ghost btn-sm" type="button" id="viewList">${icon('list', 18)} View / edit class list</button>
      </section>
    </div>` : '<div class="note">The principal has not started a term yet. The access code and voting controls appear once a term is active.</div>'}
    <div id="awardArea"></div>
    <section class="panel glass" style="padding:8px" aria-labelledby="resh">
      <div class="panel-head" style="padding:16px 16px 4px">
        <div><h2 id="resh">Standings</h2><p class="small muted">Final mark = average of Terms 1–3. The adviser counts 30% each term.</p></div>
        <button class="btn btn-ghost btn-sm" type="button" id="exportBtn">${icon('download', 18)} Export CSV</button>
      </div>
      <div class="table-wrap" id="standings"></div>
    </section>`;

  // ----- standings table -----
  const col = { t1: 't1', t2: 't2', t3: 't3', final: 'final' };
  function paintStandings() {
    view.querySelectorAll('#termTabs [data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.style.background = on ? 'var(--gold)' : 'transparent'; b.style.color = on ? '#06110A' : '#DDE9E0';
    });
    const k = col[tab];
    const rows = standings.slice().sort((a, b) => (b[k] ?? -1) - (a[k] ?? -1) || a.name.localeCompare(b.name));
    const topVal = rows.length && rows[0][k] != null ? Number(rows[0][k]).toFixed(2) : null;
    let rank = 0, prev = null;
    document.getElementById('standings').innerHTML = rows.length ? `<table class="tbl"><thead><tr>
        <th>Rank</th><th>Student</th><th>Term 1</th><th>Term 2</th><th>Term 3</th><th>Final</th><th style="text-align:right">Mark (${tab === 'final' ? 'Final' : 'Term ' + tab[1]})</th></tr></thead><tbody>
      ${rows.map((r, i) => {
        const v = r[k] != null ? Number(r[k]).toFixed(2) : null;
        if (v !== prev) { rank = i + 1; prev = v; }
        const top = v != null && v === topVal;
        const l = tab === 'final' ? r.letter : r['l' + tab[1]];
        return `<tr class="${top ? 'top' : ''}"><td><b style="font-family:var(--font-display);font-size:18px;color:${top ? 'var(--gold)' : 'var(--muted)'}">${v == null ? '—' : '#' + rank}</b></td>
          <td><b>${esc(r.name)}</b></td><td class="num">${fmt(r.t1)}</td><td class="num">${fmt(r.t2)}</td><td class="num">${fmt(r.t3)}</td>
          <td class="num" style="font-weight:700">${fmt(r.final)}</td><td style="text-align:right">${badge(l)}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="empty">Add your class list to see standings.</p>';
  }
  view.querySelectorAll('#termTabs [data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paintStandings(); }));
  paintStandings();
  document.getElementById('exportBtn').addEventListener('click', () => {
    const lines = [['Student', 'Term 1', 'Term 2', 'Term 3', 'Final', 'Final mark'].join(',')]
      .concat(standings.map((r) => [r.name, fmt(r.t1), fmt(r.t2), fmt(r.t3), fmt(r.final), r.letter || ''].map(csvCell).join(',')));
    download(`${sec.name} - standings.csv`, lines.join('\n'));
  });

  // ----- award / tie-break banner -----
  const withFinal = standings.filter((r) => r.final != null);
  const topFinal = withFinal.length ? Number(withFinal[0].final).toFixed(2) : null;
  const tied = withFinal.filter((r) => Number(r.final).toFixed(2) === topFinal);
  const finalStage = me.term && me.term.term_no === 3 && st && !st.voting_open;
  const award = document.getElementById('awardArea');
  const isAdv = sec.adviser_id === me.id || me.role === 'admin';
  if (tbInfo && tbInfo.status === 'closed' && tbInfo.winner_id) {
    const w = tbInfo.candidates.find((c) => c.id === tbInfo.winner_id);
    award.innerHTML = `<div class="tie-banner"><span class="ico">${icon('trophy', 28, '#06110A')}</span><div style="flex:1 1 300px">
      <p class="eyebrow" style="color:var(--gold)">Conduct Awardee</p><h2 style="font-size:28px">${esc(w ? w.name : '')}</h2>
      <p class="small" style="color:#EADFB8">Decided by tie-break${tbInfo.decided_by_adviser ? ' (adviser\'s decision)' : ' vote'}.</p></div>
      <a class="btn btn-ghost" href="#/tiebreak/${sid}">View vote</a></div>`;
  } else if (tbInfo && tbInfo.status === 'open') {
    award.innerHTML = `<div class="tie-banner"><span class="ico">${icon('trophy', 28, '#06110A')}</span><div style="flex:1 1 300px">
      <h2 style="font-size:22px">Tie-break vote in progress</h2><p class="small" style="color:#EADFB8">${tbInfo.total_votes} vote(s) so far.</p></div>
      <a class="btn btn-gold" href="#/tiebreak/${sid}">Open tie-break</a></div>`;
  } else if (tied.length >= 2) {
    award.innerHTML = `<div class="tie-banner"><span class="ico">${icon('trophy', 28, '#06110A')}</span><div style="flex:1 1 360px">
      <h2 style="font-size:22px">Tie at the top: ${tied.map((r) => esc(r.name)).join(' and ')} (Final ${topFinal})</h2>
      <p class="small" style="color:#EADFB8">${finalStage ? 'Start a tie-break vote. Every teacher from Terms 1–3 picks one student. If it is still tied, you decide.'
        : 'If they are still tied after Term 3 voting closes, you can start a tie-break vote.'}</p></div>
      ${finalStage && isAdv ? '<button class="btn btn-gold" type="button" id="startTb">Start tie-break vote</button>' : ''}</div>`;
    document.getElementById('startTb')?.addEventListener('click', async (e) => {
      if (!(await confirmBox('Start tie-break vote?', 'All teachers who handled this section in Terms 1–3 will be notified to vote.', 'Start vote'))) return;
      busy(e.currentTarget, true);
      try { await rpc('start_tiebreak', { p_section: sid }); toast('Tie-break vote started.'); route(); }
      catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
    });
  } else if (tied.length === 1) {
    award.innerHTML = `<div class="tie-banner"><span class="ico">${icon('trophy', 28, '#06110A')}</span><div style="flex:1 1 300px">
      <p class="eyebrow" style="color:var(--gold)">${finalStage ? 'Conduct Awardee' : 'Leading for the Conduct Award'}</p>
      <h2 style="font-size:28px">${esc(tied[0].name)}</h2><p class="small" style="color:#EADFB8">Final mark ${topFinal} · ${tied[0].letter}</p></div></div>`;
  }

  if (!st) return;
  // ----- code -----
  document.getElementById('copyCode').addEventListener('click', async () => {
    const code = document.getElementById('codeText').textContent;
    try { await navigator.clipboard.writeText(code); toast('Code copied: ' + code); } catch (e) { toast('Code: ' + code); }
  });
  document.getElementById('regen').addEventListener('click', async (e) => {
    if (!(await confirmBox('Regenerate the access code?', 'The current code will stop working right away. Teachers will need the new code to continue rating (their saved ratings are kept).', 'Regenerate', true))) return;
    busy(e.currentTarget, true, 'Generating…');
    try { const code = await rpc('regenerate_code', { p_section: sid }); toast('New code: ' + code); route(); }
    catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  });
  // ----- voting -----
  document.getElementById('openVote')?.addEventListener('click', async (e) => {
    const v = document.getElementById('closesAt').value;
    busy(e.currentTarget, true);
    try { await rpc('set_voting', { p_section: sid, p_open: true, p_closes_at: v ? new Date(v).toISOString() : null }); toast('Voting is open. Linked teachers were notified.'); route(); }
    catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  });
  document.getElementById('closeVote')?.addEventListener('click', async (e) => {
    if (!(await confirmBox(`Close voting for Term ${st.term_no}?`, 'Teachers will no longer be able to change their marks. You can reopen it later.', 'Close voting', true))) return;
    busy(e.currentTarget, true);
    try { await rpc('set_voting', { p_section: sid, p_open: false }); toast('Voting closed.'); route(); }
    catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  });
  // ----- class list -----
  view.querySelectorAll('[data-import]').forEach((b) => b.addEventListener('click', () => openImporter(sid, b.dataset.import)));
  document.getElementById('viewList').addEventListener('click', () => openClassList(sid));
}

function renderCreateSection() {
  view.innerHTML = `
    <section class="page-head"><div><p class="eyebrow">${termLine()}</p><h1>My Advisory</h1></div></section>
    <section class="panel glass" style="max-width:640px">
      <h2>Set up your advisory section</h2>
      <p class="small muted">Only class advisers need to do this. You'll then upload your class list and get the section's access code.</p>
      ${!me.year ? '<div class="note">The principal has not started a school year yet.</div>' : ''}
      <form id="secForm" style="display:flex;flex-direction:column;gap:14px">
        <label class="label">Section name<input class="field" name="name" required placeholder="e.g. STEM 12 – Newton"></label>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <label class="label" style="flex:1 1 140px">Grade level<select class="field" name="grade"><option>11</option><option selected>12</option></select></label>
          <label class="label" style="flex:2 1 220px">Strand / track<input class="field" name="strand" placeholder="e.g. STEM, ABM, HUMSS, TVL"></label>
        </div>
        <div class="form-error" hidden></div>
        <button class="btn btn-primary" type="submit" ${me.year ? '' : 'disabled'}>Create section</button>
      </form></section>`;
  const f = document.getElementById('secForm');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); const err = f.querySelector('.form-error');
    busy(btn, true); err.hidden = true;
    try {
      await rpc('create_my_section', { p_name: f.name.value, p_grade: f.grade.value, p_strand: f.strand.value });
      await refreshMe(); toast('Section created! Now upload your class list.'); route();
    } catch (x) { err.textContent = x.message; err.hidden = false; busy(btn, false); }
  });
}

// ----- Class list importer -----
function openImporter(sid, mode) {
  const titles = { paste: 'Paste class list', file: 'Upload Excel / CSV', sf1: 'Import School Form 1', one: 'Add a student' };
  const bodies = {
    paste: `<p class="small muted">Copy the names from Excel, Google Sheets or a document and paste them below, one student per line.
      Accepted: <b>Last, First Middle</b> · or columns <b>LRN, Last, First, Middle, Sex</b> copied from a spreadsheet.</p>
      <label class="label"><span class="sr-only">Names</span><textarea class="field" id="pasteBox" placeholder="Dela Cruz, Juan Santos&#10;Reyes, Maria Lopez&#10;…"></textarea></label>`,
    file: `<p class="small muted">Upload a .xlsx, .xls or .csv file with columns <b>LRN, Last Name, First Name, Middle Name, Sex</b>.
      <a href="#" id="tmpl">Download the template</a>.</p>
      <label class="label">File<input class="field" type="file" id="fileIn" accept=".xlsx,.xls,.csv" style="padding-top:12px"></label>`,
    sf1: `<p class="small muted">Upload the School Form 1 (SF1) Excel file downloaded from LIS. Every row with a 12-digit LRN is added.
      Check the preview before saving.</p>
      <label class="label">SF1 file<input class="field" type="file" id="fileIn" accept=".xlsx,.xls,.csv" style="padding-top:12px"></label>`,
    one: `<form id="oneForm" style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="label" style="flex:1 1 180px">Last name<input class="field" name="last_name" required></label>
        <label class="label" style="flex:1 1 180px">First name<input class="field" name="first_name" required></label></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="label" style="flex:1 1 160px">Middle name<input class="field" name="middle_name"></label>
        <label class="label" style="flex:1 1 160px">LRN (optional)<input class="field" name="lrn" inputmode="numeric" maxlength="12"></label>
        <label class="label" style="flex:0 1 110px">Sex<select class="field" name="sex"><option value="">—</option><option>M</option><option>F</option></select></label></div>
      <button class="btn btn-primary" type="submit">Add student</button></form>`,
  };
  const m = modal(titles[mode], `${bodies[mode]}<div id="preview"></div>`, { wide: mode !== 'one' });
  let parsed = [];
  const prev = m.el.querySelector('#preview');

  async function existing() {
    const { data } = await sb.from('students').select('lrn,last_name,first_name').eq('section_id', sid);
    return data || [];
  }
  function showPreview() {
    if (!parsed.length) { prev.innerHTML = '<p class="small muted">No students found yet.</p>'; return; }
    prev.innerHTML = `<p class="small"><b>${parsed.length}</b> student(s) found. Please check the names.</p>
      <div style="max-height:300px;overflow:auto;border-radius:16px;background:rgba(4,14,8,.4)"><table class="list-table">
      <thead><tr><th>#</th><th>Last name</th><th>First name</th><th>Middle</th><th>LRN</th><th>Sex</th></tr></thead>
      <tbody>${parsed.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.last_name)}</td><td>${esc(s.first_name)}</td><td>${esc(s.middle_name || '')}</td><td>${esc(s.lrn || '')}</td><td>${esc(s.sex || '')}</td></tr>`).join('')}</tbody></table></div>
      <button class="btn btn-primary" type="button" id="saveList">Add ${parsed.length} student(s)</button>`;
    m.el.querySelector('#saveList').addEventListener('click', (e) => save(parsed, e.currentTarget));
  }
  async function save(list, btn) {
    busy(btn, true, 'Saving…');
    try {
      const ex = await existing();
      const key = (s) => s.lrn || (s.last_name + '|' + s.first_name).toLowerCase();
      const have = new Set(ex.map(key));
      const fresh = list.filter((s) => !have.has(key(s)));
      if (fresh.length) {
        const { error } = await sb.from('students').insert(fresh.map((s) => ({ ...s, section_id: sid })));
        if (error) throw new Error(cleanError(error));
      }
      const skipped = list.length - fresh.length;
      toast(`${fresh.length} student(s) added${skipped ? `, ${skipped} already on the list` : ''}.`);
      m.close(); route();
    } catch (err) { toast(err.message, 'error'); busy(btn, false); }
  }

  if (mode === 'paste') {
    const box = m.el.querySelector('#pasteBox');
    box.addEventListener('input', () => { parsed = parsePasted(box.value); showPreview(); });
  }
  if (mode === 'file' || mode === 'sf1') {
    m.el.querySelector('#tmpl')?.addEventListener('click', (e) => { e.preventDefault(); download('class-list-template.csv', TEMPLATE_CSV); });
    m.el.querySelector('#fileIn').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      prev.innerHTML = '<p class="small muted">Reading file…</p>';
      try {
        const rows = await readFileRows(file, mode === 'sf1');
        parsed = mode === 'sf1' ? parseSF1(rows) : parseRows(rows);
        showPreview();
      } catch (err) { prev.innerHTML = `<p class="form-error">Could not read this file: ${esc(err.message)}</p>`; }
    });
  }
  if (mode === 'one') {
    const f = m.el.querySelector('#oneForm');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const s = { last_name: f.last_name.value.trim(), first_name: f.first_name.value.trim(), middle_name: f.middle_name.value.trim() || null,
        lrn: f.lrn.value.trim() || null, sex: f.sex.value || null };
      save([s], f.querySelector('button'));
    });
  }
}

async function openClassList(sid) {
  const m = modal('Class list', '<div class="spinner"></div>', { wide: true });
  async function load() {
    const { data, error } = await sb.from('students').select('*').eq('section_id', sid).order('last_name').order('first_name');
    if (error) { m.el.querySelector('.modal-body').innerHTML = `<p class="form-error">${esc(error.message)}</p>`; return; }
    m.el.querySelector('.modal-body').innerHTML = data.length ? `<p class="small muted">${data.length} students. Removing a student also removes their ratings.</p>
      <div style="max-height:60vh;overflow:auto"><table class="list-table"><thead><tr><th>#</th><th>Name</th><th>LRN</th><th>Sex</th><th></th></tr></thead><tbody>
      ${data.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(studentName(s))}</td><td>${esc(s.lrn || '')}</td><td>${esc(s.sex || '')}</td>
        <td style="text-align:right;white-space:nowrap"><button class="icon-btn" type="button" data-edit="${s.id}" aria-label="Edit ${esc(studentName(s))}">${icon('edit', 18)}</button>
        <button class="icon-btn" type="button" data-del="${s.id}" aria-label="Remove ${esc(studentName(s))}">${icon('trash', 18, '#F48A8A')}</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">No students yet.</p>';
    m.el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const s = data.find((x) => x.id === b.dataset.del);
      if (!(await confirmBox('Remove student?', `Remove ${studentName(s)} and all of their ratings?`, 'Remove', true))) return;
      const { error: er } = await sb.from('students').delete().eq('id', s.id);
      if (er) toast(er.message, 'error'); else { toast('Student removed.'); load(); }
    }));
    m.el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const s = data.find((x) => x.id === b.dataset.edit);
      const e2 = modal('Edit student', `<form id="ef" style="display:flex;flex-direction:column;gap:12px">
        <label class="label">Last name<input class="field" name="last_name" required value="${esc(s.last_name)}"></label>
        <label class="label">First name<input class="field" name="first_name" required value="${esc(s.first_name)}"></label>
        <label class="label">Middle name<input class="field" name="middle_name" value="${esc(s.middle_name || '')}"></label>
        <div style="display:flex;gap:10px"><label class="label" style="flex:1">LRN<input class="field" name="lrn" value="${esc(s.lrn || '')}"></label>
        <label class="label" style="width:110px">Sex<select class="field" name="sex"><option value="">—</option><option ${s.sex === 'M' ? 'selected' : ''}>M</option><option ${s.sex === 'F' ? 'selected' : ''}>F</option></select></label></div>
        <button class="btn btn-primary" type="submit">Save</button></form>`);
      const f = e2.el.querySelector('#ef');
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const { error: er } = await sb.from('students').update({ last_name: f.last_name.value.trim(), first_name: f.first_name.value.trim(),
          middle_name: f.middle_name.value.trim() || null, lrn: f.lrn.value.trim() || null, sex: f.sex.value || null }).eq('id', s.id);
        if (er) toast(er.message, 'error'); else { toast('Saved.'); e2.close(); load(); }
      });
    }));
  }
  load();
}

// =====================================================================
//  PRINCIPAL / COORDINATOR
// =====================================================================
async function viewAdmin(ctx) {
  const ov = await rpc('admin_overview');
  if (!ctx.alive()) return;
  const secs = ov.sections; const pending = ov.pending; const years = ov.years;
  const open = secs.filter((s) => s.voting_open).length;

  view.innerHTML = `
    <section class="page-head">
      <div><p class="eyebrow">${termLine()}</p><h1>School overview</h1></div>
      <div class="stats">
        <div class="stat"><div class="k">Sections</div><div class="v">${secs.length}</div></div>
        <div class="stat"><div class="k">Voting open</div><div class="v" style="color:var(--lime)">${open}</div></div>
        <div class="stat"><div class="k">Closed</div><div class="v">${secs.length - open}</div></div>
        <div class="stat"><div class="k">Pending approvals</div><div class="v" style="color:var(--gold)">${pending.length}</div></div>
      </div>
    </section>
    <div class="row" style="align-items:flex-start">
      <section class="panel glass" style="flex:999 1 620px;padding:8px" aria-labelledby="sh">
        <div class="panel-head" style="padding:16px 16px 4px"><h2 id="sh">All sections</h2>
          <label><span class="sr-only">Search sections</span><input class="field" id="secSearch" type="search" placeholder="Search section or adviser" style="height:44px;border-radius:999px;width:260px;max-width:100%"></label></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Section</th><th>Teachers done</th><th>Leading student</th><th>Mark</th><th>Status</th><th></th></tr></thead>
          <tbody id="secRows"></tbody></table></div>
      </section>
      <div style="flex:1 1 320px;display:flex;flex-direction:column;gap:20px;min-width:0">
        <section class="panel glass" aria-labelledby="ah">
          <div class="panel-head"><h2 id="ah">Teacher approvals</h2><span class="pill gold">${pending.length} waiting</span></div>
          ${pending.length ? pending.map((p) => `<div style="display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:20px;background:rgba(255,255,255,.06)">
            <div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="width:38px;height:38px;font-size:13px">${esc(initials(p.full_name))}</span>
              <span style="min-width:0"><b>${esc(p.full_name)}</b><br><span class="small muted">${esc(p.email)}</span></span></div>
            <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" style="flex:1" type="button" data-approve="${p.id}">Approve</button>
              <button class="btn btn-ghost btn-sm" style="flex:1" type="button" data-decline="${p.id}">Decline</button></div></div>`).join('')
            : '<p class="small muted">No one is waiting.</p>'}
          <button class="btn btn-ghost btn-sm" type="button" id="people">${icon('user', 18)} Manage all accounts</button>
        </section>
        <section class="panel glass" aria-labelledby="yh">
          <h2 id="yh">School year &amp; terms</h2>
          ${years.map((y) => `<div style="padding:14px;border-radius:20px;background:rgba(255,255,255,.06);display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between;align-items:center"><b>S.Y. ${esc(y.name)}</b>${y.is_active ? '<span class="pill open">Active</span>' : ''}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">${(y.terms || []).map((t) => t.is_active
              ? `<span class="pill gold">Term ${t.term_no} · active</span>`
              : `<button class="btn btn-ghost btn-sm" type="button" data-term="${t.id}" data-label="S.Y. ${esc(y.name)} Term ${t.term_no}">Start Term ${t.term_no}</button>`).join('')}</div></div>`).join('')
            || '<p class="small muted">No school year yet. Create one to begin.</p>'}
          <form id="yearForm" style="display:flex;gap:8px;flex-wrap:wrap">
            <label style="flex:1 1 160px"><span class="sr-only">School year</span><input class="field" name="name" placeholder="e.g. 2026–2027" required style="height:46px"></label>
            <button class="btn btn-gold btn-sm" type="submit">Add school year</button></form>
        </section>
      </div>
    </div>`;

  const tbody = document.getElementById('secRows');
  const paint = (q = '') => {
    const ql = q.toLowerCase();
    const list = secs.filter((s) => !ql || s.name.toLowerCase().includes(ql) || (s.adviser_name || '').toLowerCase().includes(ql));
    tbody.innerHTML = list.length ? list.map((s) => {
      const status = s.tiebreak_open ? '<span class="pill gold">Tie-break</span>' : s.voting_open ? '<span class="pill open">Open</span>' : '<span class="pill closed">Closed</span>';
      const pct = s.teachers ? Math.round((s.submitted / s.teachers) * 100) : 0;
      return `<tr><td><b>${esc(s.name)}</b><br><span class="small muted">${esc(s.adviser_name)} · ${s.students} students</span></td>
        <td style="min-width:140px"><span class="small">${s.submitted} of ${s.teachers}</span><div class="progress" style="height:6px;margin-top:6px"><span style="width:${pct}%"></span></div></td>
        <td>${s.tiebreak_winner ? `${icon('trophy', 16, '#F2C230')} ${esc(s.tiebreak_winner)}` : esc(s.leader || '—')}</td>
        <td>${badge(s.leader_letter, true)}</td><td>${status}</td>
        <td><a class="btn btn-ghost btn-sm" href="#/advisory/${s.id}">Open</a></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="muted">No sections yet. Advisers create their sections from "My Advisory".</td></tr>';
  };
  paint();
  document.getElementById('secSearch').addEventListener('input', (e) => paint(e.target.value));

  view.querySelectorAll('[data-approve],[data-decline]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.approve || b.dataset.decline;
    busy(b, true, '…');
    try { await rpc('admin_set_status', { p_user: id, p_status: b.dataset.approve ? 'approved' : 'declined' }); toast(b.dataset.approve ? 'Teacher approved.' : 'Sign-up declined.'); route(); }
    catch (err) { toast(err.message, 'error'); busy(b, false); }
  }));
  view.querySelectorAll('[data-term]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox(`Start ${b.dataset.label}?`, 'This becomes the active term for the whole school. Voting in other terms is closed, every teacher is notified, and teachers must enter new section codes for this term.', 'Start term'))) return;
    try { await rpc('admin_activate_term', { p_term: b.dataset.term }); await refreshMe(); toast('Term started.'); route(); }
    catch (err) { toast(err.message, 'error'); }
  }));
  document.getElementById('yearForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await rpc('admin_create_year', { p_name: e.target.name.value }); toast('School year added. Start Term 1 when ready.'); route(); }
    catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('people').addEventListener('click', openPeople);
}

async function openPeople() {
  const m = modal('All accounts', '<div class="spinner"></div>', { wide: true });
  const load = async () => {
    const people = await rpc('admin_people');
    m.el.querySelector('.modal-body').innerHTML = `<div style="max-height:65vh;overflow:auto"><table class="list-table">
      <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Role</th></tr></thead><tbody>
      ${people.map((p) => `<tr><td>${esc(p.full_name)}</td><td class="small">${esc(p.email)}</td>
        <td><select class="field" style="height:40px;width:130px" data-status="${p.id}" aria-label="Status of ${esc(p.full_name)}">
          ${['pending', 'approved', 'declined'].map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><select class="field" style="height:40px;width:170px" data-role="${p.id}" aria-label="Role of ${esc(p.full_name)}">
          <option value="teacher" ${p.role === 'teacher' ? 'selected' : ''}>Teacher</option>
          <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Principal / Coordinator</option></select></td></tr>`).join('')}
      </tbody></table></div>`;
    m.el.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', async () => {
      try { await rpc('admin_set_status', { p_user: s.dataset.status, p_status: s.value }); toast('Status updated.'); } catch (err) { toast(err.message, 'error'); load(); }
    }));
    m.el.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => {
      try { await rpc('admin_set_role', { p_user: s.dataset.role, p_role: s.value }); toast('Role updated.'); } catch (err) { toast(err.message, 'error'); load(); }
    }));
  };
  try { await load(); } catch (err) { m.el.querySelector('.modal-body').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
}

// =====================================================================
//  NOTIFICATIONS
// =====================================================================
async function viewNotifications(ctx) {
  const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  if (!ctx.alive()) return;
  view.innerHTML = `
    <section class="page-head"><div><p class="eyebrow">Inbox</p><h1>Notifications</h1></div>
      ${data.some((n) => !n.is_read) ? '<button class="btn btn-ghost" type="button" id="readAll">Mark all as read</button>' : ''}</section>
    <section class="panel glass" style="max-width:820px">
      ${data.length ? data.map(noteItem).join('') : '<p class="empty">You have no notifications.</p>'}</section>`;
  bindNoteClicks(view);
  document.getElementById('readAll')?.addEventListener('click', async () => {
    await sb.from('notifications').update({ is_read: true }).eq('user_id', me.id).eq('is_read', false);
    me.unread = 0; updateShell(); route();
  });
}

// =====================================================================
//  SETTINGS
// =====================================================================
async function viewSettings(ctx) {
  const ps = await pushState();
  if (!ctx.alive()) return;
  const iosNeedsInstall = isIOS && !isStandalone;
  view.innerHTML = `
    <section class="page-head"><div><p class="eyebrow">Account</p><h1>Settings</h1></div></section>
    <div class="row" style="align-items:flex-start">
      <section class="panel glass" style="flex:1 1 360px">
        <h2>Profile</h2>
        <form id="profForm" style="display:flex;flex-direction:column;gap:14px">
          <label class="label">Full name<input class="field" name="full_name" value="${esc(me.full_name)}" required></label>
          <label class="label">Email<input class="field" value="${esc(me.email)}" disabled></label>
          <label style="display:flex;align-items:center;gap:10px;font-size:14px"><input type="checkbox" name="email_n" ${me.email_notifications ? 'checked' : ''} style="width:20px;height:20px;accent-color:#3FBF5F"> Send me email notifications</label>
          <button class="btn btn-primary" type="submit">Save</button>
        </form>
      </section>
      <section class="panel glass" style="flex:1 1 360px">
        <h2>Phone notifications</h2>
        <p class="small muted">Get a notification on this device when voting opens, a code changes or a tie-break starts.</p>
        ${ps === 'on' ? '<p class="form-ok">Notifications are on for this device.</p><button class="btn btn-ghost" type="button" id="pushOff">Turn off on this device</button>'
          : ps === 'blocked' ? '<p class="form-error">Notifications are blocked in this browser\'s settings.</p>'
          : iosNeedsInstall ? `<div class="note" style="flex-direction:column"><b>On iPhone or iPad:</b><span>1. Tap the Share button in Safari.<br>2. Choose <b>Add to Home Screen</b>.<br>3. Open Senior UNO Values from your home screen, then come back here.</span></div>`
          : ps === 'unavailable' ? '<p class="small muted">Push notifications are not available on this browser (or not set up yet). In-app and email notifications still work.</p>'
          : '<button class="btn btn-gold" type="button" id="pushOn">Turn on notifications</button>'}
        <div style="height:1px;background:rgba(255,255,255,.12)"></div>
        <h2>Install the app</h2>
        <p class="small muted">${isIOS ? 'Safari → Share → Add to Home Screen.' : 'In Chrome, open the menu (⋮) and choose "Install app" or "Add to Home screen".'}</p>
      </section>
    </div>
    <button class="btn btn-warn" type="button" id="loBtn" style="align-self:flex-start">${icon('logout', 18)} Log out</button>`;
  const f = document.getElementById('profForm');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = f.querySelector('button'); busy(b, true);
    try { await rpc('update_my_profile', { p_full_name: f.full_name.value, p_email_notifications: f.email_n.checked }); await refreshMe(); toast('Saved.'); }
    catch (err) { toast(err.message, 'error'); }
    busy(b, false);
  });
  document.getElementById('pushOn')?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true);
    try { await enablePush(me.id); toast('Notifications turned on.'); route(); } catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  });
  document.getElementById('pushOff')?.addEventListener('click', async () => { await disablePush(); toast('Turned off.'); route(); });
  document.getElementById('loBtn').addEventListener('click', logout);
}

boot();
