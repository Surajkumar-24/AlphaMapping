/* ============================================================
   AlphaMapping — app.js  v3
   Fixes:
   1. Department mode → deep-drill that dept only (all levels)
   2. Full map mode  → leadership only (C-suite → Managers)
   3. LinkedIn links on unverified profiles
   4. Large company cap (500+ employees) with user notice
   ============================================================ */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY = 'YOUR_GROQ_API_KEY'; // ← your key from console.groq.com

/* ── Limits ── */
const MAX_QUERIES_FULL_MAP  = 8;   // leadership-only mode  → ~8 searches
const MAX_QUERIES_DEPT_MAP  = 6;   // department-focus mode → ~6 searches
const LARGE_COMPANY_SIZES   = ['Large (1000+)', 'Enterprise (5000+)'];
const PROFILE_CAP           = 80;  // max profiles sent to Groq in one call

/* ─── State ─── */
let S = { user: null, paid: false, freeTrial: false, freeUsed: 0, plan: 'starter', co: {}, map: null };

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
  if (type === 'warn')  el.style.borderLeftColor = '#F59E0B';
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 5000);
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

function goBack(v) { showView(v); setStep(v === 'form' ? 1 : 2); }

function setStep(n, markDone) {
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById('sd' + i);
    const lbl = document.getElementById('sl' + i);
    if (i < n || (i === n && markDone)) {
      dot.className = 'asb-dot done';    dot.innerHTML = '✓'; lbl.className = 'asb-label';
    } else if (i === n) {
      dot.className = 'asb-dot active';  dot.innerHTML = i;   lbl.className = 'asb-label active';
    } else {
      dot.className = 'asb-dot pending'; dot.innerHTML = i;   lbl.className = 'asb-label';
    }
  }
}

function setProgress(pct) {
  document.getElementById('ld-bar').style.width = Math.min(pct, 95) + '%';
}

let _stepIdx = 0, _stepTimer = null;

function startLoadSteps(labels) {
  _stepIdx = 0;
  if (_stepTimer) clearInterval(_stepTimer);
  function tick() {
    if (_stepIdx > 0) {
      const prev = document.getElementById('ls' + (_stepIdx - 1));
      const icon = document.getElementById('li' + (_stepIdx - 1));
      if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
      if (icon) icon.innerHTML = '✓';
    }
    const cur = document.getElementById('ls' + _stepIdx);
    if (cur) cur.classList.add('active');
    const sub = document.getElementById('ld-sub');
    if (sub && labels[_stepIdx]) sub.textContent = labels[_stepIdx];
    _stepIdx++;
  }
  tick();
  _stepTimer = setInterval(() => { if (_stepIdx < labels.length) tick(); }, 2800);
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

/* ================================================================
   AUTH
================================================================ */
function doAuth(mode) {
  let name, email;
  if (mode === 'login') {
    email = document.getElementById('li-email').value.trim();
    if (!email || !document.getElementById('li-pass').value) { toast('Please fill in all fields', 'error'); return; }
    name = email.split('@')[0];
  } else {
    name  = document.getElementById('su-name').value.trim();
    email = document.getElementById('su-email').value.trim();
    if (!name || !email || !document.getElementById('su-pass').value) { toast('Please fill in all fields', 'error'); return; }
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
   FREE TRIAL — 1 search, no payment needed
================================================================ */
function doFreeTrial() {
  S.freeTrial = true;
  S.paid = false;
  toast('Free trial activated — you have 1 free search 🎉');
  showScreen('app'); setStep(1); showView('form');
}

/* ================================================================
   X-RAY QUERY BUILDER
   Two modes:
   A) Department mode  — drill deep into one dept (all seniority levels)
   B) Full map mode    — leadership only across all depts (no junior staff)
================================================================ */

function buildDeptQueries(coName, dept) {
  /* Deep drill into a specific department — all levels from head to IC */
  const q = `"${coName}"`;
  const d = `"${dept}"`;
  return [
    // Top of dept
    `site:linkedin.com/in ${q} ${d} ("Head of" OR "VP" OR "Vice President" OR "Director")`,
    // Senior ICs and managers in dept
    `site:linkedin.com/in ${q} ${d} ("Senior Manager" OR "Manager" OR "Lead" OR "Principal")`,
    // Mid-level in dept
    `site:linkedin.com/in ${q} ${d} ("Senior" OR "Staff" OR "Engineer" OR "Specialist" OR "Analyst")`,
    // All roles in dept — catch remaining
    `site:linkedin.com/in ${q} ${d}`,
    // Common dept aliases
    `site:linkedin.com/in ${q} "${dept} Manager" OR "${dept} Lead" OR "${dept} Director"`,
    // Extra catch with company name only + dept keyword without quotes
    `site:linkedin.com/in ${q} ${dept} "currently" OR "present"`,
  ].slice(0, MAX_QUERIES_DEPT_MAP);
}

function buildFullMapQueries(coName) {
  /* Leadership-only map — no junior/IC roles to keep it manageable */
  const q = `"${coName}"`;
  return [
    // C-Suite
    `site:linkedin.com/in ${q} ("CEO" OR "Chief Executive" OR "Co-Founder" OR "Founder" OR "Managing Director")`,
    `site:linkedin.com/in ${q} ("CTO" OR "Chief Technology" OR "CPO" OR "Chief Product" OR "CISO" OR "CMO")`,
    `site:linkedin.com/in ${q} ("CFO" OR "COO" OR "Chief Financial" OR "Chief Operating" OR "Chief Revenue")`,
    // VP Level
    `site:linkedin.com/in ${q} ("VP" OR "Vice President") ("Engineering" OR "Product" OR "Technology" OR "Design")`,
    `site:linkedin.com/in ${q} ("VP" OR "Vice President") ("Sales" OR "Marketing" OR "Revenue" OR "Growth" OR "Business")`,
    `site:linkedin.com/in ${q} ("VP" OR "Vice President") ("People" OR "HR" OR "Operations" OR "Finance" OR "Legal")`,
    // Directors
    `site:linkedin.com/in ${q} ("Director of" OR "Senior Director") ("Engineering" OR "Product" OR "Sales" OR "Marketing")`,
    // Managers
    `site:linkedin.com/in ${q} ("Engineering Manager" OR "Product Manager" OR "Sales Manager" OR "Senior Manager")`,
  ].slice(0, MAX_QUERIES_FULL_MAP);
}

/* ================================================================
   SERP CALL  →  /api/serp
================================================================ */
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

/* ================================================================
   RESULT PARSER
================================================================ */
function parseResult(result, coName) {
  const url     = result.link    || '';
  const title   = result.title   || '';
  const snippet = result.snippet || '';

  if (!url.includes('linkedin.com/in/')) return null;

  // Name: everything before first " - " or " | "
  const nameMatch = title.match(/^([^|\-–]+?)(?:\s*[-–]|\s*\|)/);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();
  if (!name || name.length < 3 || name.toLowerCase() === 'linkedin') return null;

  // Role from title: "Name - ROLE at Company | LinkedIn"
  let role = '';
  const roleAtMatch = title.match(/[-–]\s*(.+?)\s+at\s+/i);
  if (roleAtMatch) role = roleAtMatch[1].trim();

  // Fallback: role from snippet
  if (!role) {
    const snipMatch = snippet.match(/\b(CEO|CTO|CFO|COO|CPO|CMO|CRO|VP|Vice President|SVP|EVP|Director|Senior Director|Manager|Senior Manager|Engineering Manager|Product Manager|Head of|Lead|Principal|Founder|Co-Founder|Partner)[^.,$\n]{0,80}/i);
    if (snipMatch) role = snipMatch[0].trim();
  }

  if (!role) role = 'Employee';

  // Company must appear in title or snippet
  const combined = (title + ' ' + snippet).toLowerCase();
  if (!combined.includes(coName.toLowerCase())) return null;

  // Clean URL — keep full linkedin path, strip query params
  const cleanUrl    = url.split('?')[0].replace(/\/$/, '');
  const linkedinPath = cleanUrl.replace('https://www.', '').replace('https://', '');

  return { name, role, linkedin: linkedinPath, context: snippet.substring(0, 160) };
}

/* ================================================================
   COLLECT PROFILES — run queries, deduplicate
================================================================ */
async function collectProfiles(coName, queries) {
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
    }
    await new Promise(r => setTimeout(r, 350));
  }

  return profiles;
}

/* ================================================================
   GROQ CLASSIFICATION
   Two prompt modes — dept drill vs leadership map
================================================================ */
async function classifyWithGroq(profiles, coName, coInd, deptMode) {
  if (!profiles.length) {
    throw new Error(`No LinkedIn profiles found for "${coName}". Check the company name matches LinkedIn exactly.`);
  }

  // Cap to avoid token overflow
  const capped   = profiles.slice(0, PROFILE_CAP);
  const wasCapped = profiles.length > PROFILE_CAP;

  const list = capped
    .map((p, i) => `${i + 1}. Name: "${p.name}" | Role: "${p.role}" | LinkedIn: ${p.linkedin} | Context: ${p.context}`)
    .join('\n');

  let prompt;

  if (deptMode) {
    /* ── Department drill mode ─────────────────────────────────
       Return ALL levels within that department — from head to IC.
       Structure by seniority within the dept, not by company level. */
    prompt = `You are a talent analyst. These are REAL LinkedIn profiles for people at "${coName}" in or related to the "${deptMode}" department.

Your job: classify ALL of them into a department hierarchy and return structured JSON.

PROFILES:
${list}

CLASSIFICATION RULES for department "${deptMode}":
- deptHead    → Most senior person in this dept: VP, Head of, Director (most senior), SVP, EVP
- seniorLevel → Senior Manager, Principal, Senior Director, Staff-level, Senior IC
- midLevel    → Manager, Team Lead, Lead, Mid-level IC, Engineer/Analyst/Specialist (no "Senior" prefix)
- juniorLevel → Junior, Associate, Intern, Entry-level, Coordinator, Fresher
- unverified  → You are less than 60% sure they work at "${coName}" in "${deptMode}"

For EVERY profile output these fields:
- name: clean full name
- title: their exact role/title
- department: "${deptMode}" (or closest sub-department)
- linkedin: EXACT URL as provided — do NOT omit this
- confidence: integer 0-100

Unverified entries must also include:
- note: brief reason why uncertain
- linkedin: EXACT URL as provided — always include even for unverified

Return ONLY raw JSON, no markdown:
{
  "mode": "department",
  "department": "${deptMode}",
  "deptHead":    [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "seniorLevel": [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "midLevel":    [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "juniorLevel": [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "unverified":  [{"name":"","title":"","department":"","linkedin":"","confidence":0,"note":""}]
}`;

  } else {
    /* ── Full leadership map mode ──────────────────────────────
       Return only leadership (C-suite → Managers). No junior/IC staff. */
    prompt = `You are a talent analyst. These are REAL LinkedIn profiles for leaders at "${coName}" (${coInd} industry).

Classify each into the correct leadership level. DO NOT include junior or individual contributor profiles.

PROFILES:
${list}

CLASSIFICATION RULES:
- cSuite    → CEO, CTO, CFO, COO, CPO, CMO, CRO, CISO, Founder, Co-Founder, Managing Director, President
- vpLevel   → VP, Vice President, SVP, EVP, Head of (with global/company-wide scope)
- directors → Director, Senior Director, Associate Director
- managers  → Manager, Senior Manager, Engineering Manager, Product Manager, Team Lead
- unverified → unclear title, insufficient context, or confidence below 60%

For EVERY profile output:
- name: clean full name
- title: their exact role/title
- department: one of Engineering / Product / Sales / Marketing / HR / Finance / Design / Customer Success / Legal / Operations / Other
- linkedin: EXACT URL as provided — do NOT omit or change
- confidence: integer 0-100

Unverified entries must also include:
- note: brief reason
- linkedin: EXACT URL as provided — always include

Return ONLY raw JSON, no markdown:
{
  "mode": "full",
  "cSuite":    [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "vpLevel":   [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "directors": [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "managers":  [{"name":"","title":"","department":"","linkedin":"","confidence":0}],
  "unverified":[{"name":"","title":"","department":"","linkedin":"","confidence":0,"note":""}]
}`;
  }

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  3500,
      temperature: 0.1,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error('Groq error: ' + data.error.message);

  let raw = data.choices?.[0]?.message?.content || '{}';
  raw = raw.replace(/```json|```/g, '').trim();
  const result = JSON.parse(raw);
  result._wasCapped = wasCapped;
  result._totalFound = profiles.length;
  return result;
}

/* ================================================================
   MAIN FLOW
================================================================ */
async function startMapping() {
  const name = document.getElementById('co-name').value.trim();
  const ind  = document.getElementById('co-ind').value;
  const desc = document.getElementById('co-desc').value.trim();
  if (!name || !ind || !desc) { toast('Please fill in required fields', 'error'); return; }

  const size = document.getElementById('co-size').value;
  const dept = document.getElementById('co-dept').value.trim();

  S.co = { name, ind, size, hq: document.getElementById('co-hq').value.trim(), desc, dept };

  // ── Large company warning ──────────────────────────────────
  if (LARGE_COMPANY_SIZES.includes(size) && !dept) {
    toast(
      `⚠️ ${name} is a large organisation. Without a department filter, results are limited to leadership (C-Suite → Managers) to keep this fast and accurate. Add a department for deeper mapping.`,
      'warn'
    );
  }

  // ── Free trial gate ─────────────────────────────────────
  if (!S.paid && S.freeTrial && S.freeUsed >= 1) {
    toast('Your free search has been used. Please subscribe to continue.', 'error');
    showScreen('pay');
    return;
  }
  if (!S.paid && !S.freeTrial) {
    toast('Please sign up or activate your free trial first.', 'error');
    showScreen('pay');
    return;
  }

  showView('loading');
  setStep(2);
  document.getElementById('ld-title').textContent = dept
    ? `Mapping ${dept} team at ${name}...`
    : `Mapping leadership at ${name}...`;

  startLoadSteps([
    'Building targeted X-ray search queries',
    'Running Google X-ray searches via SerpAPI',
    'Collecting real LinkedIn profiles',
    'Deduplicating and cleaning results',
    'AI classifying org hierarchy',
    'Rendering talent map',
  ]);

  try {
    // ── Build queries based on mode ──────────────────────────
    const queries = dept
      ? buildDeptQueries(name, dept)
      : buildFullMapQueries(name);

    // ── Run X-ray searches ───────────────────────────────────
    const rawProfiles = await collectProfiles(name, queries);
    setProgress(65);

    if (!rawProfiles.length) {
      throw new Error(`No LinkedIn profiles found for "${name}". Make sure the company name matches LinkedIn exactly (e.g. "Razorpay" not "Razorpay Inc").`);
    }

    // ── Classify with Groq ───────────────────────────────────
    setProgress(78);
    const structured = await classifyWithGroq(rawProfiles, name, ind, dept || null);
    setProgress(95);

    doneLoadSteps(6);
    S.map = structured;
    if (S.freeTrial) S.freeUsed++;

    // Notify if results were capped
    if (structured._wasCapped) {
      toast(
        `Large company detected — results capped at ${PROFILE_CAP} profiles for speed. Use the department filter for a more focused map.`,
        'warn'
      );
    }

    setTimeout(() => renderResults(), 400);

  } catch (err) {
    if (_stepTimer) clearInterval(_stepTimer);
    console.error(err);
    document.getElementById('ld-title').textContent    = 'Something went wrong';
    document.getElementById('ld-sub').textContent      = err.message;
    document.getElementById('ld-bar').style.background = '#EF4444';
    toast(err.message, 'error');
  }
}

/* ================================================================
   RENDER
================================================================ */

/* Leadership map levels */
const FULL_LEVELS = {
  cSuite:    { label: 'C-Suite & Executive Leadership', cls: 'lv-c', avcls: 'pc-av-c' },
  vpLevel:   { label: 'Vice Presidents',                cls: 'lv-v', avcls: 'pc-av-v' },
  directors: { label: 'Directors',                      cls: 'lv-d', avcls: 'pc-av-d' },
  managers:  { label: 'Managers & Team Leads',          cls: 'lv-m', avcls: 'pc-av-m' },
};

/* Department drill levels */
const DEPT_LEVELS = {
  deptHead:    { label: 'Department Head',   cls: 'lv-c', avcls: 'pc-av-c' },
  seniorLevel: { label: 'Senior Level',      cls: 'lv-v', avcls: 'pc-av-v' },
  midLevel:    { label: 'Mid Level',         cls: 'lv-d', avcls: 'pc-av-d' },
  juniorLevel: { label: 'Junior / Associate',cls: 'lv-m', avcls: 'pc-av-m' },
};

function renderResults() {
  const m  = S.map;
  const co = S.co;
  const isDept = m.mode === 'department';
  const levels = isDept ? DEPT_LEVELS : FULL_LEVELS;

  // Header
  document.getElementById('r-name').textContent = co.name;
  document.getElementById('r-meta').textContent = isDept
    ? `${co.ind} · ${co.dept} Department · ${co.size}${co.hq ? ' · ' + co.hq : ''}`
    : `${co.ind} · Leadership Map · ${co.size}${co.hq ? ' · ' + co.hq : ''}`;

  let confirmed = 0;
  Object.keys(levels).forEach(k => confirmed += (m[k] || []).length);
  document.getElementById('r-conf').textContent = confirmed;
  document.getElementById('r-unv').textContent  = (m.unverified || []).length;
  document.getElementById('r-levels').textContent = Object.keys(levels).length;

  // Mode badge
  const modeBadge = isDept
    ? `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:10px;background:rgba(0,180,166,0.12);color:var(--teal);font-size:11px;font-weight:700;margin-top:4px">🎯 Department Focus: ${co.dept}</span>`
    : `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:10px;background:rgba(13,33,55,0.1);color:var(--navy);font-size:11px;font-weight:700;margin-top:4px">🏢 Leadership Map</span>`;
  document.getElementById('r-meta').insertAdjacentHTML('afterend', modeBadge);

  // Org tree
  const orgOut = document.getElementById('org-output');
  orgOut.innerHTML = '';
  Object.entries(levels).forEach(([level, meta]) => {
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

  // Unverified — now with LinkedIn links
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
        <thead>
          <tr>
            <th>Name</th>
            <th>Possible Role</th>
            <th>Confidence</th>
            <th>LinkedIn</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${uv.map(p => {
            const liHref = p.linkedin
              ? (p.linkedin.startsWith('http') ? p.linkedin : 'https://' + p.linkedin)
              : null;
            return `<tr>
              <td><div class="uv-pname">${p.name}</div></td>
              <td><div class="uv-role">${p.title || '—'}</div></td>
              <td><span class="conf-pill">${p.confidence}%</span></td>
              <td>${liHref ? `<a class="pc-link" href="${liHref}" target="_blank" rel="noopener" style="font-size:11px">in →</a>` : '<span style="color:var(--text3);font-size:12px">—</span>'}</td>
              <td><div class="uv-note">${p.note || '—'}</div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';

  showView('results');
  setStep(3, true);  // true = mark step 3 green done
  setTimeout(() => drawOrgChart(), 50);

  const modeLabel = isDept ? `${co.dept} department` : 'leadership';
  toast(`Talent map ready — ${confirmed} real profiles found in ${modeLabel}`);
}

function profileCard(p, meta) {
  const init   = p.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const liHref = p.linkedin
    ? (p.linkedin.startsWith('http') ? p.linkedin : 'https://' + p.linkedin)
    : null;
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
        ${liHref
          ? `<a class="pc-link" href="${liHref}" target="_blank" rel="noopener">in →</a>`
          : `<span class="pc-link" style="opacity:0.35;cursor:default">in</span>`}
      </div>
    </div>`;
}

/* ================================================================
   EXPORT
================================================================ */
function getAllProfiles() {
  const m   = S.map;
  const all = [];
  const isDept = m.mode === 'department';
  const levels  = isDept
    ? ['deptHead','seniorLevel','midLevel','juniorLevel']
    : ['cSuite','vpLevel','directors','managers'];
  const labels  = isDept
    ? ['Dept Head','Senior','Mid','Junior']
    : ['C-Suite','VP','Director','Manager'];

  levels.forEach((k, i) =>
    (m[k] || []).forEach(p => all.push({ ...p, level: labels[i] }))
  );
  (m.unverified || []).forEach(p => all.push({ ...p, level: 'Unverified' }));
  return all;
}

function dlCSV() {
  const co   = S.co;
  const rows = ['Level,Name,Title,Department,LinkedIn,Confidence'];
  getAllProfiles().forEach(p =>
    rows.push(`"${p.level}","${p.name}","${p.title||''}","${p.department||''}","${p.linkedin||''}","${p.confidence}%"`)
  );
  dl(rows.join('\n'), co.name.replace(/\s+/g,'_') + '_talent_map.csv', 'text/csv');
  toast('CSV downloaded');
}

function dlJSON() {
  dl(
    JSON.stringify({ company: S.co, generatedAt: new Date().toISOString(), map: S.map }, null, 2),
    S.co.name.replace(/\s+/g,'_') + '_talent_map.json',
    'application/json'
  );
  toast('JSON downloaded');
}

function dlExcel() {
  const co  = S.co;
  const rows = getAllProfiles().map(p =>
    `<tr><td>${p.level}</td><td>${p.name}</td><td>${p.title||''}</td><td>${p.department||'—'}</td><td>${p.linkedin||'—'}</td><td>${p.confidence}%</td></tr>`
  ).join('');
  const html = `<html><head><meta charset="UTF-8"></head><body>
    <h2>Talent Map: ${co.name}${co.dept ? ' — ' + co.dept + ' Dept' : ' — Leadership'}</h2>
    <p>Industry: ${co.ind} | Size: ${co.size} | HQ: ${co.hq||'—'} | Generated: ${new Date().toLocaleDateString()}</p>
    <table border="1">
      <thead><tr><th>Level</th><th>Name</th><th>Title</th><th>Department</th><th>LinkedIn</th><th>Confidence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:gray;font-size:11px">Generated by AlphaMapping · alphanom.in</p>
  </body></html>`;
  dl(html, co.name.replace(/\s+/g,'_') + '_talent_map.xls', 'application/vnd.ms-excel');
  toast('Excel file downloaded');
}


/* ================================================================
   VISUAL ORG CHART — drawn on <canvas>
================================================================ */

const CHART_COLORS = {
  lv0: { bg: '#00B4A6', text: '#fff', border: '#009688' }, // teal  — top level
  lv1: { bg: '#0D2137', text: '#fff', border: '#1A3550' }, // navy  — second
  lv2: { bg: '#4A6F90', text: '#fff', border: '#3A5A78' }, // mid   — third
  lv3: { bg: '#8FA5BA', text: '#fff', border: '#7A92A8' }, // light — fourth
  uv:  { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' }, // amber — unverified
};

function buildChartData() {
  const m      = S.map;
  const isDept = m.mode === 'department';
  const keys   = isDept
    ? ['deptHead','seniorLevel','midLevel','juniorLevel']
    : ['cSuite','vpLevel','directors','managers'];
  const labels = isDept
    ? ['Department Head','Senior Level','Mid Level','Junior / Associate']
    : ['C-Suite','Vice Presidents','Directors','Managers'];

  const rows = [];
  keys.forEach((k, i) => {
    const people = m[k] || [];
    if (people.length) rows.push({ label: labels[i], people, colorKey: 'lv' + i });
  });
  const uv = m.unverified || [];
  if (uv.length) rows.push({ label: 'Unverified', people: uv, colorKey: 'uv' });
  return rows;
}

function drawOrgChart() {
  const canvas = document.getElementById('org-chart-canvas');
  if (!canvas) return;

  const rows     = buildChartData();
  const co       = S.co;
  const CARD_W   = 160;
  const CARD_H   = 56;
  const H_GAP    = 16;  // horizontal gap between cards
  const V_GAP    = 48;  // vertical gap between rows
  const PAD_X    = 40;
  const PAD_Y    = 60;
  const TITLE_H  = 50;

  // Calculate canvas dimensions
  const maxPerRow = Math.max(...rows.map(r => r.people.length));
  const canvasW   = Math.max(700, maxPerRow * (CARD_W + H_GAP) + PAD_X * 2);
  const canvasH   = PAD_Y + TITLE_H + rows.length * (CARD_H + V_GAP) + PAD_Y;

  canvas.width  = canvasW;
  canvas.height = canvasH;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Background
  ctx.fillStyle = '#F0F4F8';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Title
  ctx.fillStyle = '#0D2137';
  ctx.font      = 'bold 16px DM Sans, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(co.name + (co.dept ? ' — ' + co.dept : ' — Leadership Map'), canvasW / 2, PAD_Y - 10);
  ctx.font      = '12px DM Sans, sans-serif';
  ctx.fillStyle = '#8FA5BA';
  ctx.fillText('Generated by AlphaMapping · alphanom.in', canvasW / 2, PAD_Y + 10);

  let currentY = PAD_Y + TITLE_H;

  rows.forEach((row, rowIdx) => {
    const color   = CHART_COLORS[row.colorKey] || CHART_COLORS.lv3;
    const count   = row.people.length;
    const rowW    = count * CARD_W + (count - 1) * H_GAP;
    const startX  = (canvasW - rowW) / 2;

    // Row label
    ctx.fillStyle = '#8FA5BA';
    ctx.font      = 'bold 10px DM Sans, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(row.label.toUpperCase(), PAD_X, currentY - 8);

    // Connector line from previous row (skip first)
    if (rowIdx > 0) {
      ctx.strokeStyle = '#D5E1EC';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(canvasW / 2, currentY - V_GAP + CARD_H);
      ctx.lineTo(canvasW / 2, currentY - 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    row.people.forEach((person, i) => {
      const x = startX + i * (CARD_W + H_GAP);
      const y = currentY;

      // Card shadow
      ctx.shadowColor   = 'rgba(13,33,55,0.10)';
      ctx.shadowBlur    = 6;
      ctx.shadowOffsetY = 2;

      // Card background
      ctx.fillStyle = color.bg;
      roundRect(ctx, x, y, CARD_W, CARD_H, 8);
      ctx.fill();

      // Card border
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = color.border;
      ctx.lineWidth   = 1.5;
      roundRect(ctx, x, y, CARD_W, CARD_H, 8);
      ctx.stroke();

      // Avatar circle
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(x + 26, y + CARD_H / 2, 16, 0, Math.PI * 2);
      ctx.fill();

      const initials = person.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      ctx.fillStyle = color.text;
      ctx.font      = 'bold 11px DM Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(initials, x + 26, y + CARD_H / 2 + 4);

      // Name
      ctx.fillStyle = color.text;
      ctx.font      = 'bold 11px DM Sans, sans-serif';
      ctx.textAlign = 'left';
      const maxNameW = CARD_W - 50;
      const name     = truncateText(ctx, person.name, maxNameW);
      ctx.fillText(name, x + 48, y + 20);

      // Title
      ctx.font      = '10px DM Sans, sans-serif';
      ctx.fillStyle = color.text;
      ctx.globalAlpha = 0.75;
      const title   = truncateText(ctx, person.title || '', maxNameW);
      ctx.fillText(title, x + 48, y + 35);
      ctx.globalAlpha = 1;
    });

    currentY += CARD_H + V_GAP;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncateText(ctx, text, maxW) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (ctx.measureText(t + '…').width > maxW && t.length > 0) t = t.slice(0, -1);
  return t + '…';
}

function dlChartPNG() {
  const canvas = document.getElementById('org-chart-canvas');
  if (!canvas) return;
  const a = document.createElement('a');
  a.href     = canvas.toDataURL('image/png');
  a.download = S.co.name.replace(/\s+/g, '_') + '_org_chart.png';
  a.click();
  toast('Chart PNG downloaded');
}

function dlChartJPEG() {
  const canvas = document.getElementById('org-chart-canvas');
  if (!canvas) return;
  // JPEG needs white bg (transparent becomes black)
  const offscreen = document.createElement('canvas');
  offscreen.width  = canvas.width;
  offscreen.height = canvas.height;
  const ctx2 = offscreen.getContext('2d');
  ctx2.fillStyle = '#F0F4F8';
  ctx2.fillRect(0, 0, offscreen.width, offscreen.height);
  ctx2.drawImage(canvas, 0, 0);
  const a = document.createElement('a');
  a.href     = offscreen.toDataURL('image/jpeg', 0.92);
  a.download = S.co.name.replace(/\s+/g, '_') + '_org_chart.jpg';
  a.click();
  toast('Chart JPEG downloaded');
}

function dl(content, filename, mime) {
  const a = document.createElement('a');
  a.href  = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}
