// ProfitPad Clients, Task Usage dashboard.
// Fetches per-client / per-workflow / per-month task usage from n8n and renders
// KPI tiles, a stacked bar (tasks per client by workflow), a monthly trend and a detail table.

const API_URL = 'https://n8n.profitpad.com/webhook/n8n-tools-api?request=tasks';

// Categorical slots in fixed order. A client's workflows are ranked by all-time tasks;
// ranks 1..MAX_NAMED get their own slot, the rest fold into "Other".
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#b4bac6';
const MAX_SLOTS = SERIES.length;

const state = {
  clients: [],     // normalized data, see normalize()
  months: [],      // sorted list of 'YYYY-MM'
  month: 'all',    // active month filter
  sortKey: 'tasks',
  sortDir: -1,
  search: '',
  loadedAt: null,
};

const charts = {};

// ---------- Helpers ----------

const fmt = n => Number(n || 0).toLocaleString('en-US');

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

function inMonth(m) {
  return state.month === 'all' || m.month === state.month;
}

// ---------- Data ----------

// Turns the API payload into:
// [{ name, label, workflows: [{ id, name, slot, months: [...] }] }]
// Slot assignment uses all-time totals so colors never shift when the month filter changes.
function normalize(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const monthSet = new Set();

  const clients = results.map(c => {
    const workflows = (c.workflows || []).map(w => {
      const months = (w.months || []).map(m => {
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
    });

    workflows.sort((a, b) => b.allTimeTasks - a.allTimeTasks || a.name.localeCompare(b.name));
    // If everything fits in the palette, every workflow gets a slot; otherwise keep MAX_SLOTS-1 named + Other.
    const named = workflows.length <= MAX_SLOTS ? MAX_SLOTS : MAX_SLOTS - 1;
    workflows.forEach((w, i) => { w.slot = i < named ? i : 'other'; });

    return { name: c.client_name, label: titleCase(c.client_name), workflows };
  });

  clients.sort((a, b) => a.name.localeCompare(b.name));
  // Client color for the trend chart follows the client (alphabetical), never its rank.
  clients.forEach((c, i) => { c.color = SERIES[i % SERIES.length]; });

  return { clients, months: [...monthSet].sort() };
}

// Aggregates one workflow across the active month filter.
function workflowTotals(w) {
  const ms = w.months.filter(inMonth);
  return {
    tasks: ms.reduce((s, m) => s + m.tasks, 0),
    executions: ms.reduce((s, m) => s + m.executions, 0),
    lastRun: ms.map(m => m.lastRun).filter(Boolean).sort().pop() || null,
  };
}

function rows() {
  const out = [];
  state.clients.forEach(c => c.workflows.forEach(w => {
    const t = workflowTotals(w);
    out.push({ client: c, workflow: w, ...t, perExec: t.executions ? t.tasks / t.executions : 0 });
  }));
  return out;
}

// ---------- Rendering ----------

function renderFilters() {
  const el = document.getElementById('month-filter');
  const opts = [{ v: 'all', l: 'All time' }, ...state.months.map(m => ({ v: m, l: monthLabel(m) }))];
  el.innerHTML = opts.map(o =>
    `<button type="button" data-month="${esc(o.v)}" class="${o.v === state.month ? 'active' : ''}">${esc(o.l)}</button>`
  ).join('');
}

function renderShell() {
  document.getElementById('root').innerHTML = `
    <div class="kpis" id="kpis"></div>
    <div class="reports">
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Tasks per client, by workflow</h2>
            <div class="sub" id="stack-sub"></div>
          </div>
        </div>
        <div class="chart-wrap" id="stack-wrap"><canvas id="stack-chart" aria-label="Stacked bar chart of tasks per client by workflow" role="img"></canvas></div>
        <div class="legend-grid" id="stack-legend"></div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>Monthly tasks by client</h2>
            <div class="sub">All months in the data set, regardless of the month filter.</div>
          </div>
        </div>
        <div class="chart-wrap" style="height:300px"><canvas id="trend-chart" aria-label="Bar chart of monthly tasks by client" role="img"></canvas></div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>Workflow detail</h2>
            <div class="sub" id="table-sub"></div>
          </div>
          <div class="search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <input type="text" id="search" placeholder="Filter clients or workflows…" autocomplete="off" />
          </div>
        </div>
        <div class="table-scroll"><table id="detail-table"></table></div>
      </section>
    </div>
    <div class="meta" id="meta"></div>
  `;

  document.getElementById('search').addEventListener('input', e => {
    state.search = e.target.value.toLowerCase();
    renderTable();
  });
}

function renderKpis() {
  const r = rows();
  const active = r.filter(x => x.tasks > 0);
  const tasks = r.reduce((s, x) => s + x.tasks, 0);
  const execs = r.reduce((s, x) => s + x.executions, 0);
  const clients = new Set(active.map(x => x.client.name)).size;
  const period = state.month === 'all' ? 'All time' : monthLabel(state.month, true);

  const tiles = [
    { label: 'Tasks used', value: fmt(tasks), note: period },
    { label: 'Executions', value: fmt(execs), note: execs ? `${(tasks / execs).toFixed(1)} tasks per execution` : period },
    { label: 'Active clients', value: fmt(clients), note: `of ${state.clients.length} total` },
    { label: 'Active workflows', value: fmt(active.length), note: `of ${r.length} total` },
  ];
  document.getElementById('kpis').innerHTML = tiles.map(t => `
    <div class="card">
      <div class="kpi-label">${esc(t.label)}</div>
      <div class="kpi-value">${esc(t.value)}</div>
      <div class="kpi-note">${esc(t.note)}</div>
    </div>`).join('');
}

function renderStack() {
  const clients = state.clients.map(c => {
    const wf = c.workflows.map(w => ({ w, ...workflowTotals(w) }));
    return { c, wf, total: wf.reduce((s, x) => s + x.tasks, 0) };
  }).sort((a, b) => b.total - a.total);

  const hasOther = clients.some(x => x.wf.some(y => y.w.slot === 'other'));
  const slots = [...Array(MAX_SLOTS).keys(), ...(hasOther ? ['other'] : [])];

  // One dataset per color slot; slot k means "the client's k-th workflow", so each bar
  // gets distinct colors and the tooltip resolves the actual workflow name per client.
  const datasets = slots.map(slot => ({
    label: slot === 'other' ? 'Other' : `Slot ${slot + 1}`,
    slot,
    data: clients.map(x => x.wf.filter(y => y.w.slot === slot).reduce((s, y) => s + y.tasks, 0)),
    backgroundColor: slot === 'other' ? OTHER_COLOR : SERIES[slot],
    borderColor: '#fff',
    borderWidth: { left: 0, right: 2, top: 0, bottom: 0 },
    borderSkipped: false,
    barThickness: 30,
  })).filter(d => d.data.some(v => v > 0));

  const names = (clientIdx, slot) => clients[clientIdx].wf.filter(y => y.w.slot === slot);

  document.getElementById('stack-sub').textContent =
    `${state.month === 'all' ? 'All time' : monthLabel(state.month, true)}. Hover a segment for the workflow.`;
  document.getElementById('stack-wrap').style.height = Math.max(140, clients.length * 56 + 50) + 'px';

  charts.stack?.destroy();
  charts.stack = new Chart(document.getElementById('stack-chart'), {
    type: 'bar',
    data: { labels: clients.map(x => x.c.label), datasets },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'point', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(),
          filter: item => item.raw > 0,
          callbacks: {
            title: items => items[0]?.label,
            label: item => {
              const ws = names(item.dataIndex, item.dataset.slot).filter(y => y.tasks > 0);
              if (item.dataset.slot !== 'other') return ` ${ws[0]?.w.name}: ${fmt(item.raw)} tasks`;
              return [` Other (${ws.length} workflows): ${fmt(item.raw)} tasks`, ...ws.map(y => `   ${y.w.name}: ${fmt(y.tasks)}`)];
            },
            footer: items => {
              const total = clients[items[0].dataIndex].total;
              return total ? `${((items[0].raw / total) * 100).toFixed(1)}% of client total` : '';
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          grid: { color: '#eef0f4' },
          border: { display: false },
          ticks: { color: '#9aa0af', font: { family: 'DM Mono', size: 11 }, callback: v => fmt(v) },
        },
        y: {
          stacked: true,
          grid: { display: false },
          border: { color: '#d8dce6' },
          ticks: { color: '#1a1d23', font: { family: 'Inter, Trebuchet MS, sans-serif', size: 13, weight: 600 } },
        },
      },
    },
  });

  // Legend: one block per client listing its workflows with swatch + tasks.
  document.getElementById('stack-legend').innerHTML = clients.map(x => {
    const named = x.wf.filter(y => y.w.slot !== 'other');
    const other = x.wf.filter(y => y.w.slot === 'other');
    const items = named.map(y => ({ color: SERIES[y.w.slot], name: y.w.name, tasks: y.tasks }));
    if (other.length) items.push({ color: OTHER_COLOR, name: `Other (${other.length} workflows)`, tasks: other.reduce((s, y) => s + y.tasks, 0) });
    return `
      <div>
        <div class="legend-client">${esc(x.c.label)} <span>${fmt(x.total)}</span></div>
        <ul class="legend-list">
          ${items.map(i => `
            <li class="${i.tasks ? '' : 'zero'}" title="${esc(i.name)}">
              <span class="swatch" style="background:${i.color}"></span>
              <span class="name">${esc(i.name)}</span>
              <span class="val">${fmt(i.tasks)}</span>
            </li>`).join('')}
        </ul>
      </div>`;
  }).join('');
}

function renderTrend() {
  const datasets = state.clients.map(c => ({
    label: c.label,
    data: state.months.map(m => c.workflows.reduce((s, w) => s + w.months.filter(x => x.month === m).reduce((a, x) => a + x.tasks, 0), 0)),
    backgroundColor: c.color,
    borderColor: '#fff',
    borderWidth: 2,
    borderRadius: { topLeft: 4, topRight: 4 },
    borderSkipped: 'bottom',
    maxBarThickness: 36,
  }));

  charts.trend?.destroy();
  charts.trend = new Chart(document.getElementById('trend-chart'), {
    type: 'bar',
    data: { labels: state.months.map(m => monthLabel(m)), datasets },
    options: {
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, color: '#5a6070', font: { size: 12 } },
        },
        tooltip: {
          ...tooltipStyle(),
          callbacks: { label: item => ` ${item.dataset.label}: ${fmt(item.raw)} tasks` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: '#d8dce6' }, ticks: { color: '#5a6070', font: { size: 12 } } },
        y: {
          beginAtZero: true,
          grid: { color: '#eef0f4' },
          border: { display: false },
          ticks: { color: '#9aa0af', font: { family: 'DM Mono', size: 11 }, callback: v => fmt(v) },
        },
      },
    },
  });
}

function renderTable() {
  const cols = [
    { key: 'client', label: 'Client' },
    { key: 'workflow', label: 'Workflow' },
    { key: 'executions', label: 'Executions', num: true },
    { key: 'tasks', label: 'Tasks', num: true },
    { key: 'perExec', label: 'Tasks / exec', num: true },
    { key: 'lastRun', label: 'Last run' },
  ];
  const sortVal = (r, k) => k === 'client' ? r.client.label : k === 'workflow' ? r.workflow.name : r[k] ?? '';

  const list = rows()
    .filter(r => !state.search || r.client.label.toLowerCase().includes(state.search) || r.workflow.name.toLowerCase().includes(state.search))
    .sort((a, b) => {
      const x = sortVal(a, state.sortKey), y = sortVal(b, state.sortKey);
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * state.sortDir;
    });

  document.getElementById('table-sub').textContent =
    `${state.month === 'all' ? 'All time' : monthLabel(state.month, true)}. ${list.length} workflow${list.length === 1 ? '' : 's'}. Click a column to sort.`;

  const head = `<thead><tr>${cols.map(c =>
    `<th data-key="${c.key}" class="${c.num ? 'num' : ''}">${esc(c.label)}${state.sortKey === c.key ? `<span class="arrow">${state.sortDir < 0 ? '↓' : '↑'}</span>` : ''}</th>`
  ).join('')}</tr></thead>`;

  const body = list.length ? list.map(r => `
    <tr>
      <td><span class="client-pill">${esc(r.client.label)}</span></td>
      <td>${esc(r.workflow.name)}</td>
      <td class="num">${fmt(r.executions)}</td>
      <td class="num">${fmt(r.tasks)}</td>
      <td class="num">${r.executions ? r.perExec.toFixed(1) : '–'}</td>
      <td class="mono">${esc(r.lastRun || '–')}</td>
    </tr>`).join('') : `<tr><td colspan="${cols.length}" class="state">No matching workflows.</td></tr>`;

  const table = document.getElementById('detail-table');
  table.innerHTML = head + `<tbody>${body}</tbody>`;
  table.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.key;
    if (state.sortKey === k) state.sortDir *= -1;
    else { state.sortKey = k; state.sortDir = cols.find(c => c.key === k).num ? -1 : 1; }
    renderTable();
  }));
}

function renderMeta() {
  document.getElementById('meta').innerHTML =
    `Loaded ${esc(state.loadedAt.toLocaleString('en-US'))}<button type="button" id="refresh">Refresh</button>`;
  document.getElementById('refresh').addEventListener('click', load);
}

function tooltipStyle() {
  return {
    backgroundColor: '#011028',
    titleColor: '#fff',
    bodyColor: '#e4e7ef',
    footerColor: '#9aa0af',
    titleFont: { family: 'Inter, Trebuchet MS, sans-serif', size: 13, weight: 600 },
    bodyFont: { family: 'Inter, Trebuchet MS, sans-serif', size: 12 },
    footerFont: { family: 'Inter, Trebuchet MS, sans-serif', size: 11, weight: 400 },
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true,
  };
}

function renderFiltered() {
  renderFilters();
  renderKpis();
  renderStack();
  renderTable();
}

// ---------- Init ----------

async function load() {
  try {
    const res = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { clients, months } = normalize(await res.json());
    state.clients = clients;
    state.months = months;
    if (state.month !== 'all' && !months.includes(state.month)) state.month = 'all';
    state.loadedAt = new Date();

    if (!clients.length) {
      document.getElementById('root').innerHTML = '<p class="state">No task data returned.</p>';
      return;
    }
    if (!document.getElementById('kpis')) renderShell();
    renderFiltered();
    renderTrend();
    renderMeta();
  } catch (e) {
    console.error(e);
    document.getElementById('root').innerHTML =
      `<p class="state">Could not load task data (${esc(e.message)}).<br>Check that the n8n webhook is reachable and allows this origin (CORS).</p>`;
  }
}

document.getElementById('month-filter').addEventListener('click', e => {
  const btn = e.target.closest('button[data-month]');
  if (!btn || btn.dataset.month === state.month) return;
  state.month = btn.dataset.month;
  renderFiltered();
});

load();
