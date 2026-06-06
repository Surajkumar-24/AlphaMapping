/* ============================================================
   AlphaMapping — app.js
   Data pipeline: /api/serp (Vercel) → SerpAPI → Groq classify
   ============================================================ */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// Only Groq key goes here — SERP_KEY lives in Vercel env vars, never in this file
const GROQ_KEY = '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'; // ← replace with your key from console.groq.com

/* ─── State ─── */
let S = { user: null, paid: false, plan: 'starter', co: {}, map: null };

/* ================================================================
   UI HELPERS
================================================================ */
function showScreen(id, mode) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (mode) toggleMode(mode);
}

function toast(msg, type = 'ok') {
  const wrap = document.getElementById('toast-wrap');
  const el   = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = type === 'error'
    ? `<span style="color:#EF4444">✕</span> ${msg}`
    : `<span style="color:var(--teal)">✓</span> ${msg}`;
  if (type === 'error') el.style.borderLeftColor = '#EF4444';
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function toggleMode(m) {
  document.getElementById('mode-login').style.display  = m === 'login'  ? 'block' : 'none';
  document.getElementById('mode-signup').style.display = m === 'signup' ? 'block' : 'none';
}

function showView(v) {
  ['form', 'loading', 'results'].forEach(x =>
    document.getElementById('view-' + x).style.display = 'none'
  );
  document.getElementById('view-' + v).style.display = 'block';
}

function goBack(v) {
  showView(v);
  setStep(v === 'form' ? 1 : 2);
}

function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById('sd' + i);
    const lbl = document.getElementById('sl' + i);
    if (i < n)       { dot.className = 'asb-dot done';    dot.innerHTML = '✓'; lbl.className = 'asb-label'; }
    else if (i === n){ dot.className = 'asb-dot active';  dot.innerHTML = i;   lbl.className = 'asb-label active'; }
    else             { dot.className = 'asb-dot pending'; dot.innerHTML = i;   lbl.className = 'asb-label'; }
  }
}

/* Loading step animator */
let _stepIdx = 0;
let _stepTimer = null;

function startLoadSteps(labels) {
  _stepIdx = 0;
  if (_stepTimer) clearInterval(_stepTimer);

  function tick() {
    // mark previous done
    if (_stepIdx > 0) {
      const prev = document.getElementById('ls' + (_stepIdx - 1));
      const icon = document.getElementById('li' + (_stepIdx - 1));
      if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
      if (icon) icon.innerHTML = '✓';
    }
    // activate current
    const cur = document.getElementById('ls' + _stepIdx);
    if (cur) cur.classList.add('active');
    const sub = document.getElementById('ld-sub');
    if (sub && labels[_stepIdx]) sub.textContent = labels[_stepIdx];
    _stepIdx++;
  }

  tick(); // first step immediately
  _stepTimer = setInterval(() => {
    if (_stepIdx < labels.length) tick();
  }, 2500);
}

function doneLoadSteps(total) {
  if (_stepTimer) clearInterval(_stepTimer);
  for (let i = 0; i < total; i++) {
    const el = document.getElementById('ls' + i);
    const ic = document.getElementById('li' + i);
    if (el) { el.classList.remove('active'); el.classList.add('done'); }
    if (ic) ic.innerHTML = '✓';
  }
  document.getElementById('ld-bar').style.width = '100%';
}

function setProgress(pct) {
  document.getElementById('ld-bar').style.width = Math.min(pct, 95) + '%';
}

/* ================================================================
   AUTH
================================================================ */
function doAuth(mode) {
  let name, email;
  if (mode === 'login') {
    email = document.getElementById('li-email').value.trim();
    if (!email || !document.getElementById('li-pass').value) {
      toast('Please fill in all fields', 'error'); return;
    }
    name = email.split('@')[0];
  } else {
    name  = document.getElementById('su-name').value.trim();
    email = document.getElementById('su-email').value.trim();
    if (!name || !email || !document.getElementById('su-pass').value) {
      toast('Please fill in all fields', 'error'); return;
    }
  }
  S.user = { name, email };
  document.getElementById('topbar-right').innerHTML = `
    <div class="user-chip"><div class="user-chip-dot"></div>${name}</div>
    <button class="btn-signout" onclick="doLogout()">Sign out</button>`;
  document.getElementById('topbar-nav').style.display = 'none';
  toast('Welcome, ' + name + '!');
  showScreen('pay');
}

function doLogout() {
  S = { user: null, paid: false, plan: 'starter', co: {}, map: null };
  document.getElementById('topbar-right').innerHTML = `
    <button class="btn-outline-nav" onclick="showScreen('auth','login')">Log In</button>
    <button class="btn-teal-nav" onclick="showScreen('auth','signup')">Sign Up &nbsp;›</button>`;
  document.getElementById('topbar-nav').style.display = '';
  showScreen('landing');
}

/* ================================================================
   PAYMENT
================================================================ */
function selPlan(p) {
  S.plan = p;
  document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('sel'));
  document.getElementById('plan-' + p).classList.add('sel');
}

function fmtCard(el) {
  let v = el.value.replace(/\D/g, '').substring(0, 16);
  el.value = v.replace(/(.{4})/g, '$1 ').trim();
}

function doPay() {
  const num = document.getElementById('c-num').value.trim();
  const exp = document.getElementById('c-exp').value.trim();
  const cvc = document.getElementById('c-cvc').value.trim();
  if (!num || !exp || !cvc) { toast('Please enter card details', 'error'); return; }
  const btn = document.getElementById('pay-btn');
  btn.textContent = 'Processing...'; btn.disabled = true;
  setTimeout(() => {
    S.paid = true;
    toast('Payment successful! AlphaMapping activated 🎉');
    showScreen('app'); setStep(1); showView('form');
    btn.textContent = 'Pay & Activate →'; btn.disabled = false;
  }, 1800);
}

/* ================================================================
   X-RAY SEARCH  →  /api/serp  (Vercel serverless, holds SERP_KEY)
================================================================ */

function buildXrayQueries(coName) {
  const q = `"${coName}"`;
  return [
    `site:linkedin.com/in ${q} "CEO" OR "Co-Founder" OR "Founder" OR "Chief Executive"`,
    `site:linkedin.com/in ${q} "CTO" OR "Chief Technology" OR "CPO" OR "Chief Product"`,
    `site:linkedin.com/in ${q} "CFO" OR "COO" OR "Chief Financial" OR "Chief Operating"`,
    `site:linkedin.com/in ${q} "VP" OR "Vice President" "Engineering" OR "Product" OR "Technology"`,
    `site:linkedin.com/in ${q} "VP" OR "Vice President" "Sales" OR "Marketing" OR "Revenue" OR "Growth"`,
    `site:linkedin.com/in ${q} "VP" OR "Vice President" "People" OR "HR" OR "Operations" OR "Finance"`,
    `site:linkedin.com/in ${q} "Director" "Engineering" OR "Product" OR "Design" OR "Technology"`,
    `site:linkedin.com/in ${q} "Director" "Sales" OR "Marketing" OR "Customer Success" OR "Finance"`,
    `site:linkedin.com/in ${q} "Engineering Manager" OR "Senior Manager" OR "Product Manager"`,
    `site:linkedin.com/in ${q} "Manager" "Sales" OR "Marketing" OR "Operations" OR "HR"`,
  ];
}

/* Call /api/serp — our Vercel serverless function */
async function serpSearch(query) {
  const res = await fetch('/api/serp', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Proxy error ${res.status}`);
  }

  const data = await res.json();
  if (data.error) throw new Error('SerpAPI: ' + data.error);
  return data.organic_results || [];
}

/* Parse a Google result into a profile object */
function parseResult(result, coName) {
  const url     = result.link    || '';
  const title   = result.title   || '';
  const snippet = result.snippet || '';

  // Must be a real /in/ profile URL
  if (!url.includes('linkedin.com/in/')) return null;

  // Name is before the first " - " or " | " in the title
  const nameMatch = title.match(/^([^|\-–]+?)(?:\s*[-–]|\s*\|)/);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();
  if (!name || name.length < 3) return null;

  // Role: "Name - ROLE at Company | LinkedIn"
  let role = '';
  const roleMatch = title.match(/[-–]\s*(.+?)\s+at\s+/i);
  if (roleMatch) role = roleMatch[1].trim();

  // Fallback: grab role from snippet
  if (!role) {
    const snipMatch = snippet.match(/\b(CEO|CTO|CFO|COO|CPO|VP|Vice President|Director|Manager|Head of|Lead|Founder|Engineer)[^.,$]{0,60}/i);
    if (snipMatch) role = snipMatch[0].trim();
  }

  if (!role) role = 'Employee';

  // Company name must appear somewhere in title or snippet
  const combined = (title + ' ' + snippet).toLowerCase();
  if (!combined.includes(coName.toLowerCase())) return null;

  // Clean LinkedIn URL
  const linkedinUrl = url.split('?')[0].replace(/\/$/, '');
  const linkedinPath = linkedinUrl.replace('https://www.', '').replace('https://', '');

  return {
    name,
    role,
    linkedin: linkedinPath,
    context:  snippet.substring(0, 150),
  };
}

/* Run all queries, deduplicate by LinkedIn URL */
async function collectProfiles(coName) {
  const queries  = buildXrayQueries(coName);
  const seen     = new Set();
  const profiles = [];

  for (let i = 0; i < queries.length; i++) {
    setProgress(5 + (i / queries.length) * 55);

    try {
      const results = await serpSearch(queries[i]);
      for (const r of results) {
        const p = parseResult(r, coName);
        if (!p || seen.has(p.linkedin)) continue;
        seen.add(p.linkedin);
        profiles.push(p);
      }
    } catch (e) {
      console.warn(`Query ${i + 1} failed:`, e.message);
      // keep going — don't fail the whole map for one bad query
    }

    // small pause between requests
    await new Promise(r => setTimeout(r, 400));
  }

  return profiles;
}

/* ================================================================
   GROQ — classify real scraped profiles into org levels
================================================================ */
async function classifyWithGroq(profiles, coName, coInd) {
  if (!profiles.length) throw new Error('No profiles found for this company. Try a more well-known company name.');

  const list = profiles
    .map((p, i) => `${i + 1}. Name: "${p.name}" | Role: "${p.role}" | LinkedIn: ${p.linkedin} | Context: ${p.context}`)
    .join('\n');

  const prompt = `You are a talent analyst. These are REAL LinkedIn profiles scraped from Google for employees at "${coName}" (${coInd} industry).

Classify each profile into the correct org level and return clean structured JSON.

PROFILES:
${list}

CLASSIFICATION RULES:
- cSuite → CEO, CTO, CFO, COO, CPO, CMO, CRO, CISO, Founder, Co-Founder, Managing Director
- vpLevel → VP, Vice President, SVP, EVP, Head of (senior/global scope)
- directors → Director, Senior Director, Associate Director
- managers → Manager, Senior Manager, Engineering Manager, Product Manager, Team Lead, Lead
- unverified → unclear title, not enough context, or you are less than 60% sure they currently work at ${coName}

For each profile output:
- name: clean full name
- title: their exact role/title
- department: one of Engineering / Product / Sales / Marketing / HR / Finance / Design / Customer Success / Legal / Operations / Other
- linkedin: exact URL as provided
- confidence: integer 0-100 (how sure you are this is a current ${coName} employee at that level)

Profiles with confidence below 60 → put in unverified with a brief note field.

Return ONLY raw JSON, no markdown, no explanation:
{
  "cSuite":    [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "vpLevel":   [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "directors": [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "managers":  [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "unverified":[{"name":"","title":"","confidence":0,"note":""}]
}`;

  const res = await fetch(GROQ_API, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + GROQ_KEY,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  3000,
      temperature: 0.1,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error('Groq error: ' + data.error.message);

  let raw = data.choices?.[0]?.message?.content || '{}';
  raw = raw.replace(/```json|```/g, '').trim();

  return JSON.parse(raw);
}

/* ================================================================
   MAIN FLOW
================================================================ */
async function startMapping() {
  const name = document.getElementById('co-name').value.trim();
  const ind  = document.getElementById('co-ind').value;
  const desc = document.getElementById('co-desc').value.trim();
  if (!name || !ind || !desc) { toast('Please fill in required fields', 'error'); return; }

  S.co = {
    name, ind,
    size: document.getElementById('co-size').value,
    hq:   document.getElementById('co-hq').value.trim(),
    desc,
    dept: document.getElementById('co-dept').value.trim(),
  };

  showView('loading');
  setStep(2);
  document.getElementById('ld-title').textContent = 'Mapping ' + name + '...';

  startLoadSteps([
    'Building X-ray search queries',
    'Running Google X-ray searches via SerpAPI',
    'Collecting LinkedIn profiles from results',
    'Deduplicating and cleaning data',
    'AI classifying org hierarchy',
    'Rendering talent map',
  ]);

  try {
    // ── Phase 1: Real X-ray search ──────────────────────────
    const rawProfiles = await collectProfiles(name);
    setProgress(65);

    if (!rawProfiles.length) {
      throw new Error(`No LinkedIn profiles found for "${name}". Make sure the company name is spelled exactly as it appears on LinkedIn.`);
    }

    // ── Phase 2: Groq classification ────────────────────────
    setProgress(75);
    const structured = await classifyWithGroq(rawProfiles, name, ind);
    setProgress(95);

    doneLoadSteps(6);
    S.map = structured;
    setTimeout(() => renderResults(), 400);

  } catch (err) {
    if (_stepTimer) clearInterval(_stepTimer);
    console.error(err);
    document.getElementById('ld-title').textContent   = 'Something went wrong';
    document.getElementById('ld-sub').textContent     = err.message;
    document.getElementById('ld-bar').style.background = '#EF4444';
    toast(err.message, 'error');
  }
}

/* ================================================================
   RENDER
================================================================ */
const LEVELS = {
  cSuite:    { label: 'C-Suite & Executive Leadership', cls: 'lv-c', avcls: 'pc-av-c' },
  vpLevel:   { label: 'Vice Presidents',                cls: 'lv-v', avcls: 'pc-av-v' },
  directors: { label: 'Directors',                      cls: 'lv-d', avcls: 'pc-av-d' },
  managers:  { label: 'Managers & Team Leads',          cls: 'lv-m', avcls: 'pc-av-m' },
};

function renderResults() {
  const m  = S.map;
  const co = S.co;

  document.getElementById('r-name').textContent = co.name;
  document.getElementById('r-meta').textContent = [co.ind, co.size, co.hq].filter(Boolean).join(' · ');

  let confirmed = 0;
  Object.keys(LEVELS).forEach(k => confirmed += (m[k] || []).length);
  document.getElementById('r-conf').textContent = confirmed;
  document.getElementById('r-unv').textContent  = (m.unverified || []).length;

  // Org tree
  const orgOut = document.getElementById('org-output');
  orgOut.innerHTML = '';
  Object.entries(LEVELS).forEach(([level, meta]) => {
    const people = m[level] || [];
    if (!people.length) return;
    const sec = document.createElement('div');
    sec.className = 'org-section';
    sec.innerHTML = `
      <div class="org-section-header">
        <div class="osh-title">${meta.label}</div>
        <div class="osh-count">${people.length} profiles</div>
        <div class="osh-line"></div>
      </div>
      <div class="profile-grid">
        ${people.map(p => profileCard(p, meta)).join('')}
      </div>`;
    orgOut.appendChild(sec);
  });

  // Unverified
  const uvOut = document.getElementById('uv-output');
  const uv    = m.unverified || [];
  uvOut.innerHTML = uv.length ? `
    <div class="uv-card">
      <div class="uv-header">
        <div class="uv-icon">⚠️</div>
        <div class="uv-title">Unverified Profiles</div>
        <div class="uv-sub">${uv.length} entries · Needs manual review</div>
      </div>
      <table class="uv-table">
        <thead><tr><th>Name</th><th>Possible Role</th><th>Confidence</th><th>Note</th></tr></thead>
        <tbody>
          ${uv.map(p => `
            <tr>
              <td><div class="uv-pname">${p.name}</div></td>
              <td><div class="uv-role">${p.title || '—'}</div></td>
              <td><span class="conf-pill">${p.confidence}%</span></td>
              <td><div class="uv-note">${p.note || '—'}</div></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  showView('results');
  setStep(3);
  toast(`Talent map ready — ${confirmed} real profiles found`);
}

function profileCard(p, meta) {
  const init   = p.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const liHref = p.linkedin.startsWith('http') ? p.linkedin : 'https://' + p.linkedin;
  return `
    <div class="profile-card ${meta.cls}">
      <div class="pc-top">
        <div class="pc-av ${meta.avcls}">${init}</div>
        <div>
          <div class="pc-name">${p.name}</div>
          <div class="pc-title">${p.title}</div>
        </div>
      </div>
      <div class="pc-footer">
        <span class="pc-dept">${p.department || '—'}</span>
        <a class="pc-link" href="${liHref}" target="_blank" rel="noopener">in →</a>
      </div>
    </div>`;
}

/* ================================================================
   EXPORT
================================================================ */
function dlCSV() {
  const m  = S.map;
  const co = S.co;
  const rows = ['Level,Name,Title,Department,LinkedIn,Confidence'];
  const add  = (lv, arr) => (arr || []).forEach(p =>
    rows.push(`"${lv}","${p.name}","${p.title}","${p.department || ''}","${p.linkedin || ''}","${p.confidence}%"`)
  );
  add('C-Suite',    m.cSuite);
  add('VP',         m.vpLevel);
  add('Director',   m.directors);
  add('Manager',    m.managers);
  (m.unverified || []).forEach(p =>
    rows.push(`"Unverified","${p.name}","${p.title || ''}","","","${p.confidence}%"`)
  );
  dl(rows.join('\n'), co.name.replace(/\s+/g, '_') + '_talent_map.csv', 'text/csv');
  toast('CSV downloaded');
}

function dlJSON() {
  dl(
    JSON.stringify({ company: S.co, generatedAt: new Date().toISOString(), map: S.map }, null, 2),
    S.co.name.replace(/\s+/g, '_') + '_talent_map.json',
    'application/json'
  );
  toast('JSON downloaded');
}

function dlExcel() {
  const m   = S.map;
  const co  = S.co;
  const all = [
    ...(m.cSuite    || []).map(p => ({ ...p, level: 'C-Suite'    })),
    ...(m.vpLevel   || []).map(p => ({ ...p, level: 'VP'         })),
    ...(m.directors || []).map(p => ({ ...p, level: 'Director'   })),
    ...(m.managers  || []).map(p => ({ ...p, level: 'Manager'    })),
    ...(m.unverified|| []).map(p => ({ ...p, level: 'Unverified', department: '—', linkedin: '—' })),
  ];
  const rows = all.map(p =>
    `<tr><td>${p.level}</td><td>${p.name}</td><td>${p.title || ''}</td><td>${p.department || '—'}</td><td>${p.linkedin || '—'}</td><td>${p.confidence}%</td></tr>`
  ).join('');
  const html = `<html><head><meta charset="UTF-8"></head><body>
    <h2>Talent Map: ${co.name}</h2>
    <p>Industry: ${co.ind} | Size: ${co.size} | HQ: ${co.hq || '—'} | Generated: ${new Date().toLocaleDateString()}</p>
    <table border="1">
      <thead><tr><th>Level</th><th>Name</th><th>Title</th><th>Department</th><th>LinkedIn</th><th>Confidence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:gray;font-size:11px">Generated by AlphaMapping · alphanom.in</p>
  </body></html>`;
  dl(html, co.name.replace(/\s+/g, '_') + '_talent_map.xls', 'application/vnd.ms-excel');
  toast('Excel file downloaded');
}

function dl(content, filename, mime) {
  const a = document.createElement('a');
  a.href  = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}
