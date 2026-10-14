// ProfitPad Clients, Client overview.
// Combines request=tasks (usage, monthly max, HubSpot deal) and request=server_cost (monthly
// server bills) into KPI tiles, a one-row-per-client summary and a monthly breakdown per client.
// Shared helpers (fmt, money, esc, monthLabel, clientLink, normalizeTasks, normalizeCosts,
// monthMax, ...) live in ../assets/common.js.

const state = {
  clients: [],      // merged clients, see merge()
  thisMonth: null,  // 'YYYY-MM' used for "this month" figures
  costError: null,  // message if server_cost failed (tasks still render)
  loadedAt: null,
};

// ---------- Data ----------

// Merges task and cost data by client name. Clients that appear in only one endpoint are kept.
// Each client: { name, label, dealLink, caps, workflows, costs: [{month, gross, credits, net, currency}],
//   months: [{ month, tasks, executions, activeWorkflows, max, cost }] } with months newest first.
function merge(tasks, costs) {
  const byName = new Map(tasks.clients.map(c => [c.name, c]));
  costs.forEach((_rows, name) => {
    if (!byName.has(name)) byName.set(name, { name, label: titleCase(name), workflows: [], caps: [], dealLink: null });
  });

  return [...byName.values()].map(c => {
    const clientCosts = costs.get(c.name) || [];
    const monthSet = new Set([...c.workflows.flatMap(w => w.months.map(m => m.month)), ...clientCosts.map(r => r.month)]);
    const months = [...monthSet].sort().reverse().map(month => {
      const runs = c.workflows.map(w => w.months.find(m => m.month === month)).filter(Boolean);
      return {
        month,
        tasks: runs.reduce((s, m) => s + m.tasks, 0),
        executions: runs.reduce((s, m) => s + m.executions, 0),
        activeWorkflows: runs.filter(m => m.tasks > 0).length,
        max: monthMax(c, month),
        cost: clientCosts.find(r => r.month === month) || null,
      };
    });
    return { ...c, costs: clientCosts, months };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function monthOf(c, ym) {
  return c.months.find(m => m.month === ym) || { month: ym, tasks: 0, executions: 0, activeWorkflows: 0, max: monthMax(c, ym), cost: null };
}

// Latest month with a server bill across all clients, or null.
function latestCostMonth() {
  return state.clients.flatMap(c => c.costs.map(r => r.month)).sort().pop() || null;
}

// ---------- Rendering ----------

function usageCell(tasks, max, empty = 'No max') {
  if (!max) return `<span class="muted">${empty}</span>`;
  const pct = (tasks / max) * 100;
  const over = tasks > max;
  return `
    <div class="usage${over ? ' over' : ''}" title="${fmt(tasks)} of ${fmt(max)} tasks">
      <div class="usage-bar"><span style="width:${Math.min(100, pct).toFixed(1)}%"></span></div>
      <span class="usage-pct">${pct.toFixed(pct < 10 ? 1 : 0)}%</span>
    </div>`;
}

const costText = r => (r ? money(r.net, r.currency) : '–');

function renderShell() {
  document.getElementById('root').innerHTML = `
    <div class="kpis" id="kpis"></div>
    <div class="reports">
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Clients</h2>
            <div class="sub" id="summary-sub"></div>
          </div>
        </div>
        <div class="table-scroll"><table id="summary-table"></table></div>
      </section>
      <section class="card">
        <div class="card-head">
          <div>
            <h2>By month</h2>
            <div class="sub">Tasks, share of the monthly max, and net server cost billed for each client and month. The current month is usually not billed yet.</div>
          </div>
        </div>
        <div class="table-scroll"><table id="pivot-table" class="pivot"></table></div>
      </section>
    </div>
    <div class="meta" id="meta"></div>
  `;
}

function renderKpis() {
  const ym = state.thisMonth;
  const now = state.clients.map(c => monthOf(c, ym));
  const tasks = now.reduce((s, m) => s + m.tasks, 0);
  const withMax = now.filter(m => m.max);
  const over = withMax.filter(m => m.tasks > m.max).length;

  const costMonth = latestCostMonth();
  const bills = costMonth ? state.clients.map(c => c.costs.find(r => r.month === costMonth)).filter(Boolean) : [];
  const currencies = [...new Set(bills.map(r => r.currency))];
  const net = bills.reduce((s, r) => s + r.net, 0);

  const tiles = [
    { label: 'Clients', value: fmt(state.clients.length), note: `${now.filter(m => m.tasks > 0).length} active in ${monthLabel(ym)}` },
    { label: 'Tasks this month', value: fmt(tasks), note: monthLabel(ym, true) },
    { label: 'Over max', value: fmt(over), note: `of ${withMax.length} client${withMax.length === 1 ? '' : 's'} with a max` },
    state.costError
      ? { label: 'Server cost', value: '–', note: 'Could not load server costs' }
      : !costMonth
        ? { label: 'Server cost', value: '–', note: 'No bills yet' }
        : currencies.length === 1
          ? { label: 'Server cost', value: money(net, currencies[0]), note: `Billed for ${monthLabel(costMonth)}` }
          : { label: 'Server cost', value: `${currencies.length} currencies`, note: `${monthLabel(costMonth)}, see clients below` },
  ];
  document.getElementById('kpis').innerHTML = tiles.map(t => `
    <div class="card">
      <div class="kpi-label">${esc(t.label)}</div>
      <div class="kpi-value">${esc(t.value)}</div>
      <div class="kpi-note">${esc(t.note)}</div>
    </div>`).join('');
}

function renderSummary() {
  const ym = state.thisMonth;
  const list = state.clients.map(c => ({ c, m: monthOf(c, ym), bill: c.costs[c.costs.length - 1] || null }))
    .sort((a, b) => b.m.tasks - a.m.tasks || a.c.name.localeCompare(b.c.name));

  document.getElementById('summary-sub').textContent =
    `Task figures are for ${monthLabel(ym, true)}. Server cost is each client's most recent bill. Client names open the HubSpot deal.`;

  document.getElementById('summary-table').innerHTML = `
    <thead><tr>
      <th>Client</th>
      <th class="num">Tasks</th>
      <th class="num">Max</th>
      <th>Used</th>
      <th class="num">Active workflows</th>
      <th class="num">Server cost</th>
      <th>Billed for</th>
    </tr></thead>
    <tbody>${list.map(({ c, m, bill }) => `
      <tr>
        <td>${clientLink(c, 'client-pill')}</td>
        <td class="num">${fmt(m.tasks)}</td>
        <td class="num">${m.max ? fmt(m.max) : '–'}</td>
        <td>${usageCell(m.tasks, m.max)}</td>
        <td class="num">${fmt(m.activeWorkflows)}</td>
        <td class="num">${state.costError ? '–' : costText(bill)}</td>
        <td class="mono">${bill ? esc(monthLabel(bill.month)) : '–'}</td>
      </tr>`).join('')}
    </tbody>`;
}

// Pivot table: one row per client, one column group per month (oldest to newest) with
// tasks, usage of the monthly max and server cost, plus a totals row.
function renderPivot() {
  const months = [...new Set(state.clients.flatMap(c => c.months.map(m => m.month)))].sort();
  const cell = (c, ym) => c.months.find(m => m.month === ym) || { tasks: 0, max: monthMax(c, ym), cost: null };

  const totals = months.map(ym => {
    const cells = state.clients.map(c => cell(c, ym));
    const bills = cells.map(m => m.cost).filter(Boolean);
    const currencies = [...new Set(bills.map(r => r.currency))];
    return {
      tasks: cells.reduce((s, m) => s + m.tasks, 0),
      cost: !bills.length ? '–' : currencies.length === 1 ? money(bills.reduce((s, r) => s + r.net, 0), currencies[0]) : 'Mixed',
    };
  });

  document.getElementById('pivot-table').innerHTML = `
    <thead>
      <tr>
        <th rowspan="2">Client</th>
        ${months.map(ym => `<th colspan="3" class="group">${esc(monthLabel(ym))}</th>`).join('')}
      </tr>
      <tr>
        ${months.map(() => '<th class="num group-start">Tasks</th><th>Used</th><th class="num">Server cost</th>').join('')}
      </tr>
    </thead>
    <tbody>${state.clients.map(c => `
      <tr>
        <td>${clientLink(c, 'client-pill')}</td>
        ${months.map(ym => {
          const m = cell(c, ym);
          return `
            <td class="num group-start">${fmt(m.tasks)}</td>
            <td>${usageCell(m.tasks, m.max, '–')}</td>
            <td class="num strong">${costText(m.cost)}</td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td>Total</td>
        ${totals.map(t => `
          <td class="num group-start">${fmt(t.tasks)}</td>
          <td></td>
          <td class="num">${esc(t.cost)}</td>`).join('')}
      </tr>
    </tfoot>`;
}

function renderMeta() {
  const note = state.costError ? ` · Server costs unavailable (${esc(state.costError)})` : '';
  document.getElementById('meta').innerHTML =
    `Loaded ${esc(state.loadedAt.toLocaleString('en-US'))}${note}<button type="button" id="refresh">Refresh</button>`;
  document.getElementById('refresh').addEventListener('click', load);
}

// ---------- Init ----------

async function load() {
  // Server cost failing should not hide task data, so the two requests settle independently.
  const [tasksRes, costRes] = await Promise.allSettled([fetchApi('tasks'), fetchApi('server_cost')]);
  try {
    if (tasksRes.status === 'rejected') throw tasksRes.reason;
    const tasks = normalizeTasks(tasksRes.value);
    state.costError = costRes.status === 'rejected' ? costRes.reason.message : null;
    if (state.costError) console.error(costRes.reason);
    state.clients = merge(tasks, state.costError ? new Map() : normalizeCosts(costRes.value));
    // "This month" is the current month, or the latest month with task data if it has none.
    const cur = currentMonth();
    state.thisMonth = tasks.months.includes(cur) ? cur : tasks.months[tasks.months.length - 1] || cur;
    state.loadedAt = new Date();

    if (!state.clients.length) {
      document.getElementById('root').innerHTML = '<p class="state">No client data returned.</p>';
      return;
    }
    if (!document.getElementById('kpis')) renderShell();
    renderKpis();
    renderSummary();
    renderPivot();
    renderMeta();
  } catch (e) {
    console.error(e);
    document.getElementById('root').innerHTML =
      `<p class="state">Could not load client data (${esc(e.message)}).<br>Check that the n8n webhook is reachable and allows this origin (CORS).</p>`;
  }
}

load();
