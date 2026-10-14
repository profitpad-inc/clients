// ProfitPad Clients, shared helpers for every page.
// Load before the page script: <script src="../assets/common.js"></script>

const API_BASE = 'https://n8n.profitpad.com/webhook/n8n-tools-api';

// Months dropped from all API data entirely (not shown, not counted anywhere).
const IGNORED_MONTHS = new Set(['2026-08']);

// ---------- Formatting ----------

const fmt = n => Number(n || 0).toLocaleString('en-US');

function money(n, currency = 'USD') {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function monthLabel(ym, long) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: long ? 'long' : 'short', year: 'numeric' });
}

function titleCase(s) {
  return String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// The current calendar month as 'YYYY-MM' (local time).
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Client label as HTML, linked to its HubSpot deal when there is one.
function clientLink(c, cls = '') {
  const attr = cls ? ` class="${cls}"` : '';
  return c.dealLink
    ? `<a${attr} href="${esc(c.dealLink)}" target="_blank" rel="noopener" title="Open HubSpot deal">${esc(c.label)}</a>`
    : `<span${attr}>${esc(c.label)}</span>`;
}

// ---------- Data ----------

async function fetchApi(request) {
  const res = await fetch(`${API_BASE}?request=${encodeURIComponent(request)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Normalizes the request=tasks payload into:
// { clients: [{ name, label, caps, dealLink, workflows: [{ id, name, allTimeTasks, months: [...] }] }], months }
// Clients are sorted alphabetically, workflows by all-time tasks. Ignored months are dropped,
// along with workflows that only ran in them.
function normalizeTasks(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const monthSet = new Set();

  const clients = results.map(c => {
    const workflows = (c.workflows || []).map(w => {
      const months = (w.months || []).filter(m => !IGNORED_MONTHS.has(m.month)).map(m => {
        monthSet.add(m.month);
        return {
          month: m.month,
          executions: Number(m.count_executions) || 0,
          tasks: Number(m.sum_tasks_used) || 0,
          firstRun: m.first_run_at || null,
          lastRun: m.recent_run_at || null,
        };
      });
      return {
        id: w.workflow_id,
        name: w.workflow_name || w.workflow_id,
        months,
        allTimeTasks: months.reduce((s, m) => s + m.tasks, 0),
      };
    }).filter(w => w.months.length);

    workflows.sort((a, b) => b.allTimeTasks - a.allTimeTasks || a.name.localeCompare(b.name));

    // Monthly task caps as date ranges: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', max }].
    const caps = (Array.isArray(c.max_tasks) ? c.max_tasks : [])
      .map(r => ({ from: r.from || '0000-01-01', to: r.to || '9999-12-31', max: Number(r.max) }))
      .filter(r => r.max > 0);

    // HubSpot deal for the client; only http(s) URLs are kept.
    const dealLink = /^https?:\/\//i.test(c.deal_link || '') ? c.deal_link : null;

    return { name: c.client_name, label: titleCase(c.client_name), workflows, caps, dealLink };
  });

  clients.sort((a, b) => a.name.localeCompare(b.name));
  return { clients, months: [...monthSet].sort() };
}

// Normalizes the request=server_cost payload into a map of client name to
// [{ month: 'YYYY-MM', gross, credits, net, currency }], sorted by month.
function normalizeCosts(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const out = new Map();
  results.forEach(c => {
    const rows = (c.billing || []).map(b => {
      const raw = String(b.invoice_month || '');
      return {
        month: /^\d{6}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw,
        gross: Number(b.gross_cost) || 0,
        credits: Number(b.credits) || 0,
        net: Number(b.net_billed) || 0,
        currency: b.currency || 'USD',
      };
    }).filter(r => /^\d{4}-\d{2}$/.test(r.month) && !IGNORED_MONTHS.has(r.month));
    rows.sort((a, b) => a.month.localeCompare(b.month));
    out.set(c.client_name, rows);
  });
  return out;
}

// The client's monthly task max for 'YYYY-MM', or null if none applies. If several ranges
// overlap the month, the one that starts latest wins.
function monthMax(c, ym) {
  const hit = c.caps
    .filter(r => r.from <= `${ym}-31` && r.to >= `${ym}-01`)
    .sort((a, b) => a.from.localeCompare(b.from))
    .pop();
  return hit ? hit.max : null;
}
