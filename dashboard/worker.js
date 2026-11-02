// ═══════════════════════════════════════════════════════════
// WASl AI — اللوحة الدائمة
// ───────────────────────────────────────────────────────────
// بتقرأ المحتوى من GitHub لحظتها ⇒ كل commit بيتحدّث من غير نشر.
// أي ملف بيتقرا من: raw.githubusercontent.com/ahmed3zz2020-source/wasl-ai/main
// ═══════════════════════════════════════════════════════════

const REPO = 'ahmed3zz2020-source/wasl-ai';
const BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const API = `https://api.github.com/repos/${REPO}`;

// ── Helpers ──────────────────────────────────────────────
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

// ⭐ contents API أولاً: أدق من raw.githubusercontent بعد force-push
// (raw بيرجع 404 مؤقتاً لملفات اتغيّرت بنيتها). raw = fallback.
async function raw(path) {
  const apiRes = await fetch(`${API}/contents/${path}`, {
    headers: { 'user-agent': 'wasl-hub', 'accept': 'application/vnd.github.raw' },
    cf: { cacheTtl: 0 },
  });
  if (apiRes.ok) return await apiRes.text();

  const rawRes = await fetch(`${RAW}/${path}`, {
    headers: { 'user-agent': 'wasl-hub' },
    cf: { cacheTtl: 0 },
  });
  if (rawRes.ok) return await rawRes.text();

  throw new Error(`fetch ${path} -> contents:${apiRes.status} raw:${rawRes.status}`);
}

async function rawJson(path) {
  return JSON.parse(await raw(path));
}

// ── Markdown → HTML (compact renderer for our own files) ──
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(«])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => {
      const href = u.startsWith('http') ? u : `https://github.com/${REPO}/blob/${BRANCH}/${u.replace(/^\.\//, '')}`;
      return `<a href="${href}" target="_blank" rel="noopener">${t}</a>`;
    });
}

function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inCode = false, codeBuf = [], inList = false, inTable = false, tableBuf = [];

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closeTable = () => {
    if (inTable) {
      const rows = tableBuf.map(r => r.split('|').map(c => c.trim()));
      const head = rows[0] || [];
      const body = rows.slice(rows.length > 1 && /^[\s|:-]+$/.test(rows[1] || '') ? 2 : 1);
      out.push('<table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>');
      body.forEach(r => { out.push('<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'); });
      out.push('</tbody></table>');
      inTable = false; tableBuf = [];
    }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      if (inCode) { out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'); codeBuf = []; inCode = false; }
      else { closeList(); closeTable(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); closeTable(); continue; }

    // table row
    if (/^\s*\|.*\|\s*$/.test(line)) { closeList(); inTable = true; tableBuf.push(line.trim()); continue; }
    closeTable();

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lv = Math.min(h[1].length, 6);
      const id = h[2].replace(/[^\w؀-ۿ]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${lv} id="${id}">${inline(h[2])}</h${lv}>`);
      continue;
    }

    // hr
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
      continue;
    }

    // list item
    const li = line.match(/^\s*[-*+]\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();

    // paragraph
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeTable();
  if (inCode && codeBuf.length) out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
  return out.join('\n');
}

// ── Data loading ─────────────────────────────────────────
async function loadRepo() {
  // GitHub contents API — one call, full tree
  const res = await fetch(`${API}/git/trees/${BRANCH}?recursive=1`, {
    headers: { 'user-agent': 'wasl-hub', 'accept': 'application/vnd.github+json' },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) throw new Error(`tree -> ${res.status}`);
  const data = await res.json();
  return (data.tree || []).filter(t => t.type === 'blob').map(t => t.path);
}

// ── Pages ────────────────────────────────────────────────
const TITLES = {
  'STATUS.md': 'لوحة الحالة',
  'CHARTER.md': 'الميثاق',
  'PROTOCOL.md': 'بروتوكول الشغل',
  'ARCHITECTURE.md': 'المعمارية',
  'DECISIONS.md': 'سجل القرارات',
  'SESSION-NOTES.md': 'يوميات الشغل',
  'AGENTS.md': 'عقد الوكلاء',
  'research/MARKET.md': 'بحث السوق',
  'docs/CAPABILITY-MANIFEST.md': 'قائمة قدرات الوكيل',
  'README.md': 'الرئيسية',
};

async function renderPage(path) {
  const md = await raw(path);
  return mdToHtml(md);
}

function shell(title, body, extra = '') {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)} — WASl AI</title>
<meta name="theme-color" content="#0b1020">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🜄</text></svg>">
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">
    <span class="mark">و</span>
    <span class="brandtext"><b>WASl AI</b><small>لوحة المشروع الدائمة</small></span>
  </a>
  <nav class="nav">${NAV}</nav>
</header>
<main>${body}</main>
<footer class="foot">
  <span>WASl AI · المصدر الوحيد للحقيقة: <a href="https://github.com/${REPO}" target="_blank" rel="noopener">GitHub</a></span>
  <span class="live" id="live"></span>
</footer>
${extra}
</body></html>`;
}

const NAV = [
  ['/', 'الرئيسية'],
  ['/p/STATUS.md', 'الحالة'],
  ['/p/TIMELINE.md', 'الخط الزمني'],
  ['/p/CHARTER.md', 'الميثاق'],
  ['/p/CHATGPT-BRIDGE.md', 'جسر ChatGPT'],
  ['/p/PROTOCOL.md', 'البروتوكول'],
  ['/p/ARCHITECTURE.md', 'المعمارية'],
  ['/p/DECISIONS.md', 'القرارات'],
  ['/p/research/MARKET.md', 'السوق'],
  ['/p/SESSION-NOTES.md', 'اليوميات'],
  ['/files', 'كل الملفات'],
].map(([h, t]) => `<a href="${h}">${t}</a>`).join('');

// ── CSS ──────────────────────────────────────────────────
const CSS = `
:root{
  --bg:#0b1020; --bg2:#111830; --card:#151d38; --card2:#1b2444;
  --fg:#eaf0ff; --fg2:#a9b6d9; --fg3:#7586ad;
  --line:#26315a; --acc:#5b8cff; --acc2:#7ab8ff; --ok:#3ddc97; --warn:#ffc857; --bad:#ff6b81;
  --r:14px; --shadow:0 10px 30px rgba(0,0,0,.35);
}
@media (prefers-color-scheme: light){
  :root{
    --bg:#f6f8fd; --bg2:#eef2fb; --card:#ffffff; --card2:#f2f5fc;
    --fg:#141a30; --fg2:#4a5675; --fg3:#7b87a5;
    --line:#dde4f2; --acc:#2f6bff; --acc2:#0f7bc4; --ok:#0f9d63; --warn:#a06a00; --bad:#c62b45;
    --shadow:0 8px 24px rgba(20,30,60,.10);
  }
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--fg);
  font-family:"Cairo","Noto Kufi Arabic","Segoe UI",Tahoma,system-ui,sans-serif;
  line-height:1.85; -webkit-font-smoothing:antialiased;
  padding-bottom:env(safe-area-inset-bottom);
}
a{color:var(--acc2);text-decoration:none}
a:hover{text-decoration:underline}
.topbar{
  position:sticky;top:0;z-index:50;backdrop-filter:blur(14px);
  background:color-mix(in srgb,var(--bg) 88%,transparent);
  border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:18px;padding:10px 16px;flex-wrap:wrap;
}
.brand{display:flex;align-items:center;gap:10px;color:var(--fg);text-decoration:none}
.brand:hover{text-decoration:none}
.mark{
  width:38px;height:38px;border-radius:11px;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;font-weight:800;font-size:19px;
  box-shadow:var(--shadow);
}
.brandtext{display:flex;flex-direction:column;line-height:1.25}
.brandtext b{font-size:16px;letter-spacing:.3px}
.brandtext small{font-size:11px;color:var(--fg3)}
.nav{display:flex;gap:4px;flex-wrap:wrap;margin-inline-start:auto}
.nav a{
  padding:6px 11px;border-radius:9px;font-size:13px;color:var(--fg2);
  border:1px solid transparent;white-space:nowrap;
}
.nav a:hover{background:var(--card);color:var(--fg);text-decoration:none;border-color:var(--line)}
main{max-width:1080px;margin:0 auto;padding:22px 16px 60px}
h1,h2,h3,h4{line-height:1.4;margin:1.4em 0 .5em}
h1{font-size:26px;margin-top:.2em}
h2{font-size:20px;border-bottom:1px solid var(--line);padding-bottom:8px}
h3{font-size:17px;color:var(--acc2)}
p{margin:.7em 0}
ul{padding-inline-start:20px;margin:.6em 0}
li{margin:.3em 0}
code{
  background:var(--card2);padding:1px 6px;border-radius:6px;font-size:.88em;
  font-family:"JetBrains Mono",Consolas,monospace;direction:ltr;display:inline-block;
}
pre{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px;overflow:auto;direction:ltr;text-align:left}
pre code{background:none;padding:0;display:block}
blockquote{
  margin:1em 0;padding:10px 16px;border-inline-start:4px solid var(--acc);
  background:var(--card);border-radius:0 var(--r) var(--r) 0;color:var(--fg2);
}
table{width:100%;border-collapse:collapse;margin:1em 0;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:9px 11px;text-align:start;vertical-align:top}
th{background:var(--card2);font-weight:700;color:var(--fg)}
tbody tr:nth-child(even){background:color-mix(in srgb,var(--card) 55%,transparent)}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.foot{
  border-top:1px solid var(--line);padding:16px;display:flex;gap:12px;
  justify-content:space-between;flex-wrap:wrap;color:var(--fg3);font-size:12.5px;
}
.live{color:var(--ok)}
.live::before{content:"●";margin-inline-end:5px}

/* home */
.hero{
  background:linear-gradient(135deg,var(--card),var(--card2));
  border:1px solid var(--line);border-radius:20px;padding:26px 24px;margin-bottom:20px;
  box-shadow:var(--shadow);
}
.hero h1{margin:0 0 6px;font-size:27px}
.hero p{margin:.4em 0;color:var(--fg2)}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.badge{
  font-size:12px;padding:5px 11px;border-radius:999px;
  background:var(--bg2);border:1px solid var(--line);color:var(--fg2);
}
.badge.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.badge.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
.badge.acc{color:var(--acc2);border-color:color-mix(in srgb,var(--acc2) 40%,transparent)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.card{
  background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:16px;box-shadow:var(--shadow);
}
.card h3{margin:0 0 8px;font-size:15.5px;color:var(--fg)}
.card p{color:var(--fg2);font-size:14px;margin:.3em 0}
.card a{display:inline-block;margin-top:8px;font-size:13.5px}
.section{margin:28px 0}
.section>h2{margin-top:0}
.filelist{display:grid;gap:6px}
.filelist a{
  display:flex;justify-content:space-between;gap:12px;padding:9px 13px;
  background:var(--card);border:1px solid var(--line);border-radius:10px;
  color:var(--fg);font-size:13.5px;
}
.filelist a:hover{border-color:var(--acc);text-decoration:none;background:var(--card2)}
.filelist .path{color:var(--fg3);font-size:12px;direction:ltr}
.copybtn{
  display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:10px;
  background:linear-gradient(135deg,var(--acc),var(--acc2));color:#fff;border:0;
  font:inherit;font-weight:700;cursor:pointer;box-shadow:var(--shadow);
}
.copybtn:active{transform:translateY(1px)}
.toast{
  position:fixed;inset-inline:0;bottom:22px;margin:auto;width:max-content;max-width:90%;
  background:var(--ok);color:#04120b;padding:11px 20px;border-radius:12px;font-weight:700;
  box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:opacity .22s;z-index:99;
}
.toast.on{opacity:1}
.err{
  background:var(--card);border:1px solid var(--bad);border-radius:var(--r);
  padding:22px;color:var(--fg);
}
@media(max-width:640px){
  main{padding:16px 12px 48px}
  .hero{padding:20px 16px;border-radius:16px}
  .hero h1{font-size:22px}
  h1{font-size:22px}
  h2{font-size:18px}
  .nav{width:100%;margin-inline-start:0;overflow-x:auto;padding-bottom:4px}
  .nav a{font-size:12.5px;padding:5px 9px}
  th,td{padding:8px;font-size:13px}
  .foot{flex-direction:column;gap:6px}
}
`;

// ── Home page ────────────────────────────────────────────
async function home() {
  let tree = [];
  try { tree = await loadRepo(); } catch (e) { /* degrade gracefully */ }

  const mdFiles = tree.filter(p => p.endsWith('.md') && !p.startsWith('.'));
  const prompts = tree.filter(p => p.startsWith('PROMPTS/') && p.endsWith('.md'));
  const reviews = tree.filter(p => p.startsWith('REVIEWS/') && p.endsWith('.md'));

  const statusMd = await raw('STATUS.md');
  const phase = (statusMd.match(/##\s*المرحلة:\s*\*\*(.+?)\*\*/) || [])[1] || '—';

  // last commit
  let lastCommit = '';
  try {
    const c = await fetch(`${API}/commits?per_page=1`, {
      headers: { 'user-agent': 'wasl-hub', 'accept': 'application/vnd.github+json' },
    });
    const j = await c.json();
    if (Array.isArray(j) && j[0]) {
      const d = new Date(j[0].commit.author.date);
      lastCommit = j[0].commit.message.split('\n')[0].slice(0, 60) + ' · ' +
        d.toISOString().slice(0, 10);
    }
  } catch (e) { /* ignore */ }

  const cards = [
    ['لوحة الحالة', 'فين المشروع واقف بالظبط، إيه اللي اتعمل وإيه الجاي.', '/p/STATUS.md', 'acc'],
    ['الخط الزمني', '٦ مراحل من التأسيس للترسيخ — مع بوابات الخروج والمدة.', '/p/TIMELINE.md', 'acc'],
    ['جسر ChatGPT', 'حزمة السياق الكاملة — الرابط اللي ChatGPT بيقرأ منه.', '/p/CHATGPT-BRIDGE.md', 'acc'],
    ['الميثاق', 'المشروع إيه وليه، السوق، النموذج، ومبادئ مش قابلة للتفاوض.', '/p/CHARTER.md', ''],
    ['البروتوكول', 'دورة البروميت والمراجعة، وقواعد الموافقة وتدقيق الأدوات.', '/p/PROTOCOL.md', ''],
    ['المعمارية', 'البنية المقترحة — بتتبني من بروميتات ChatGPT.', '/p/ARCHITECTURE.md', 'warn'],
    ['سجل القرارات', 'كل قرار مع سببه والبديل اللي اترك.', '/p/DECISIONS.md', ''],
    ['بحث السوق', '١١ منافس + أرقام السوق بالمصادر.', '/p/research/MARKET.md', ''],
  ].map(([t, d, h, cls]) => `
    <div class="card">
      <h3>${t}</h3>
      <p>${d}</p>
      <a href="${h}">فتح ←</a>
      ${cls ? `<span class="badge ${cls}">${cls === 'warn' ? 'قيد التحديد' : 'محدّث'}</span>` : ''}
    </div>`).join('');

  const fileRows = mdFiles.map(p => `
    <a href="/p/${p}"><span>${TITLES[p] || p.replace(/\.md$/, '')}</span><span class="path">${p}</span></a>
  `).join('');

  const body = `
  <section class="hero">
    <h1>WASl AI</h1>
    <p>مشروع خدمة عملاء ذكي، عربي بالكامل، يخدم أي نشاط تجاري في العالم العربي — بجودة عالية وأسعار تنافسية.</p>
    <div class="badges">
      <span class="badge ok">المرحلة: ${escapeHtml(phase)}</span>
      <span class="badge acc">بروميتات: ${prompts.length}</span>
      <span class="badge acc">حزم مراجعة: ${reviews.length}</span>
      <span class="badge">${mdFiles.length} ملف معرفي</span>
    </div>
  </section>

  <section class="section">
    <h2>ابدأ من هنا</h2>
    <div class="grid">${cards}</div>
  </section>

  <section class="section">
    <h2>الدايرة مع ChatGPT</h2>
    <div class="grid">
      <div class="card">
        <h3>١ · ChatGPT يقرأ حالة المشروع</h3>
        <p>رابط واحد فيه حالة المشروع والمعمارية والقرارات والخط الزمني وآخر حزمة مراجعة. بيتحدّث تلقائياً مع كل commit.</p>
        <a href="/bridge" target="_blank" rel="noopener">افتح حزمة السياق ←</a>
        <div class="filelist" style="margin-top:10px">
          <a href="/bridge" target="_blank" rel="noopener"><span>حزمة السياق الكاملة</span><span class="path">/bridge</span></a>
        </div>
      </div>
      <div class="card">
        <h3>٢ · ChatGPT يراجع شغلنا</h3>
        <p>آخر حزمة مراجعة بصيغة جاهزة — انسخها والصقها، أو خلّي ChatGPT يقرأ الرابط لوحده.</p>
        <button class="copybtn" id="cp2">📋 انسخ آخر حزمة مراجعة</button>
        <div class="filelist" style="margin-top:10px">
          <a href="/review/latest" target="_blank" rel="noopener"><span>حزمة المراجعة (خام)</span><span class="path">/review/latest</span></a>
        </div>
      </div>
      <div class="card">
        <h3>٣ · ترتيب الأدوار</h3>
        <p>ChatGPT مهندس معماري · أنا منفّذ · أنت المالك. كل واحد في دوره، ومفيش تجاوز.</p>
        <a href="/p/CHATGPT-BRIDGE.md">الجسر كامل ←</a>
        <a href="/p/TIMELINE.md">الخط الزمني ←</a>
      </div>
    </div>
  </section>

  ${reviews.length ? `
  <section class="section">
    <h2>آخر حزمة مراجعة</h2>
    <div class="card">
      <h3>${escapeHtml(reviews[reviews.length - 1])}</h3>
      <p>اضغط «نسخ» والصقها في ChatGPT عشان يراجع الشغل ويعلّق.</p>
      <button class="copybtn" id="cp">📋 نسخ آخر حزمة مراجعة</button>
    </div>
  </section>` : `
  <section class="section">
    <h2>حزم المراجعة</h2>
    <div class="card"><p>لسه مفيش حزم مراجعة — بتنتظر أول بروميت من ChatGPT.</p></div>
  </section>`}

  <section class="section">
    <h2>كل الملفات</h2>
    <div class="filelist">${fileRows}</div>
  </section>

  <section class="section">
    <h2>ملفات خام</h2>
    <div class="filelist">
      <a href="/raw/STATUS.md"><span>STATUS.md (خام)</span><span class="path">/raw/STATUS.md</span></a>
      <a href="/api/state"><span>حالة المشروع (JSON)</span><span class="path">/api/state</span></a>
      <a href="https://github.com/${REPO}" target="_blank" rel="noopener"><span>المستودع على GitHub</span><span class="path">github.com/${REPO}</span></a>
    </div>
  </section>`;

  const script = `
<script>
(async()=>{
  const doCopy = async()=>{
    try{
      const r = await fetch('/review/latest');
      const t = await r.text();
      await navigator.clipboard.writeText(t);
      const el=document.createElement('div'); el.className='toast'; el.textContent='✅ اتنسخت — الصقها في ChatGPT';
      document.body.appendChild(el); requestAnimationFrame(()=>el.classList.add('on'));
      setTimeout(()=>{el.classList.remove('on');setTimeout(()=>el.remove(),300);},2200);
    }catch(e){ alert('انسخ يدوياً من: '+location.origin+'/review/latest'); }
  };
  ['cp','cp2'].forEach(id=>{
    const b=document.getElementById(id); if(b) b.addEventListener('click',doCopy);
  });
})();
</script>`;

  return shell('الرئيسية', body, script);
}

// ── API: state ───────────────────────────────────────────
async function apiState() {
  const tree = await loadRepo();
  const statusMd = await raw('STATUS.md');
  const phase = (statusMd.match(/##\s*المرحلة:\s*\*\*(.+?)\*\*/) || [])[1] || '';
  const prompts = tree.filter(p => p.startsWith('PROMPTS/') && p.endsWith('.md')).sort();
  const reviews = tree.filter(p => p.startsWith('REVIEWS/') && p.endsWith('.md')).sort();
  const commits = await (await fetch(`${API}/commits?per_page=10`, {
    headers: { 'user-agent': 'wasl-hub', 'accept': 'application/vnd.github+json' },
  })).json();
  return json({
    project: 'WASl AI',
    phase,
    files: tree.filter(p => !p.startsWith('.')).length,
    prompts, reviews,
    commits: (Array.isArray(commits) ? commits : []).map(c => ({
      sha: c.sha.slice(0, 8),
      date: c.commit.author.date,
      msg: c.commit.message.split('\n')[0],
    })),
    generated_at: new Date().toISOString(),
  });
}

// ── Router ───────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    try {
      if (p === '/' || p === '/index.html') return new Response(await home(), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
      });

      if (p === '/api/state') return await apiState();

      if (p === '/files') {
        const tree = await loadRepo();
        const rows = tree.filter(x => !x.startsWith('.')).map(x =>
          `<a href="/p/${x}"><span>${x.replace(/\.md$/, '')}</span><span class="path">${x}</span></a>`).join('');
        return new Response(shell('كل الملفات', `<section class="section"><h2>كل الملفات</h2><div class="filelist">${rows}</div></section>`), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
        });
      }

      // /review/latest → latest review package as plain text
      if (p === '/review/latest' || p === '/review/latest.txt') {
        const tree = await loadRepo();
        const reviews = tree.filter(x => x.startsWith('REVIEWS/') && x.endsWith('.md') && !x.includes('.short.') && !x.includes('TEMPLATE')).sort();
        if (!reviews.length) return new Response('لسه مفيش حزم مراجعة.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
        return new Response(await raw(reviews[reviews.length - 1]), {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' },
        });
      }

      // /bridge → الحزمة الكاملة لـ ChatGPT (سياق المشروع كله في رابط واحد)
      if (p === '/bridge' || p === '/bridge.txt' || p === '/bridge.md') {
        const tree = await loadRepo();
        const reviews = tree.filter(x => x.startsWith('REVIEWS/') && x.endsWith('.md') && !x.includes('.short.') && !x.includes('TEMPLATE')).sort();
        const parts = [];
        parts.push('# WASl AI — حزمة السياق لـ ChatGPT');
        parts.push('');
        parts.push(`> رابط حيّ · آخر تحديث: ${new Date().toISOString()}`);
        parts.push('> اقرأ ده كامل قبل أي مراجعة أو تصميم.');
        parts.push('');
        for (const f of ['CHATGPT-BRIDGE.md', 'STATUS.md', 'TIMELINE.md', 'ARCHITECTURE.md', 'DECISIONS.md']) {
          try {
            parts.push('');
            parts.push('\n---\n');
            parts.push(await raw(f));
          } catch (e) { /* skip missing */ }
        }
        if (reviews.length) {
          parts.push('\n---\n');
          parts.push(await raw(reviews[reviews.length - 1]));
        }
        return new Response(parts.join('\n'), {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' },
        });
      }

      // /raw/<path>
      if (p.startsWith('/raw/')) {
        const path = p.slice(5);
        return new Response(await raw(path), {
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' },
        });
      }

      // /p/<path> → rendered markdown
      if (p.startsWith('/p/')) {
        const path = decodeURIComponent(p.slice(3));
        try {
          const body = await renderPage(path);
          return new Response(shell(TITLES[path] || path, body), {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
          });
        } catch (e) {
          return new Response(shell('مش موجود', `<div class="err"><h1>٤٠٤</h1><p>الملف <code>${escapeHtml(path)}</code> مش موجود في المستودع.</p><p><a href="/files">شوف كل الملفات</a> · <a href="/">رجوع للرئيسية</a></p></div>`), {
            status: 404, headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
      }

      return new Response(shell('مش موجود', '<div class="err"><h1>٤٠٤</h1><p>الصفحة دي مش موجودة. ارجع للـ<a href="/">الرئيسية</a>.</p></div>'), {
        status: 404, headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    } catch (e) {
      return new Response(shell('خطأ', `<div class="err"><h1>خطأ</h1><p>${escapeHtml(String(e && e.message || e))}</p><p><a href="/">رجوع</a></p></div>`), {
        status: 500, headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
  },
};
