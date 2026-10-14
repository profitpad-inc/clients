// ProfitPad Clients, Task Usage dashboard.
// Fetches per-client / per-workflow / per-month task usage from n8n and renders
// KPI tiles, a stacked bar (tasks per client by workflow), a monthly trend and a detail table.

// Shared helpers (fmt, esc, monthLabel, clientLink, normalizeTasks, monthMax, ...) live in ../assets/common.js.

// Categorical slots in fixed order. A client's workflows are ranked by all-time tasks;
// ranks 1..MAX_NAMED get their own slot, the rest fold into "Other".
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#b4bac6';
const MAX_SLOTS = SERIES.length;

const state = {
  clients: [],     // normalized data, see normalize()
  months: [],      // sorted list of 'YYYY-MM'
  month: null,     // active month filter ('all' or 'YYYY-MM'); set on first load
  trendFocus: null, // client name highlighted on the trend chart, or null
  sortKey: 'tasks',
  sortDir: -1,
  search: '',
  loadedAt: null,
};

const charts = {};

// Anchors a horizontal bar tooltip to the middle of the hovered segment, above it when there
// is room and below it otherwise (Chart.js defaults to the segment's end, which covers the bar).
// Pair with `yAlign: segmentYAlign`.
Chart.Tooltip.positioners.segment = function (items) {
  const el = items[0]?.element;
  if (!el) return false;
  const { x, y, base, height } = el.getProps(['x', 'y', 'base', 'height'], true);
  const top = y - height / 2;
  this._segmentAbove = top >= (this.height || 80) + 8;
  return { x: (x + base) / 2, y: this._segmentAbove ? top : y + height / 2 };
};
const segmentYAlign = ctx => (ctx.tooltip._segmentAbove ? 'bottom' : 'top');

// ---------- Helpers ----------

function inMonth(m) {
  return state.month === 'all' || m.month === state.month;
}

// ---------- Data ----------

// Adds dashboard-only fields to the shared normalizeTasks() result:
// workflow color `slot` (0..MAX_SLOTS-1 or 'other') and a client `color`.
// Slot assignment uses all-time totals so colors never shift when the month filter changes.
function normalize(payload) {
  const { clients, months } = normalizeTasks(payload);
  clients.forEach(c => {
    // If everything fits in the palette, every workflow gets a slot; otherwise keep MAX_SLOTS-1 named + Other.
    const named = c.workflows.length <= MAX_SLOTS ? MAX_SLOTS : MAX_SLOTS - 1;
    c.workflows.forEach((w, i) => { w.slot = i < named ? i : 'other'; });
  });
  // Client color for the trend chart follows the client (alphabetical), never its rank.
  clients.forEach((c, i) => { c.color = SERIES[i % SERIES.length]; });
  return { clients, months };
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

// The client's max for the active period: that month's max, or for "All time" the sum of the
// monthly maxes across every month in the data set. Null if no max applies.
function periodMax(c) {
  const ms = state.month === 'all' ? state.months : [state.month];
  const vals = ms.map(m => monthMax(c, m)).filter(v => v != null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
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
            <div class="sub" id="trend-sub"></div>
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
    return { c, wf, total: wf.reduce((s, x) => s + x.tasks, 0), max: periodMax(c) };
  }).sort((a, b) => b.total - a.total);

  const hasOther = clients.some(x => x.wf.some(y => y.w.slot === 'other'));
  const slots = [...Array(MAX_SLOTS).keys(), ...(hasOther ? ['other'] : [])];

  // Log scale: each bar's length is log10(client total), split into segments by each
  // workflow's share of that total. (A plain log axis on a stack distorts the segments.)
  const logLen = t => (t > 0 ? Math.log10(t) : 0);
  const maxLog = Math.max(1, Math.ceil(Math.max(...clients.map(x => Math.max(logLen(x.total), logLen(x.max || 0))))));

  // One dataset per color slot; slot k means "the client's k-th workflow", so each bar
  // gets distinct colors and the tooltip resolves the actual workflow name per client.
  // `tasks` holds the real values; `data` holds the scaled segment lengths.
  const datasets = slots.map(slot => {
    const tasks = clients.map(x => x.wf.filter(y => y.w.slot === slot).reduce((s, y) => s + y.tasks, 0));
    return {
      label: slot === 'other' ? 'Other' : `Slot ${slot + 1}`,
      slot,
      tasks,
      data: tasks.map((t, i) => (clients[i].total ? (t / clients[i].total) * logLen(clients[i].total) : 0)),
      backgroundColor: slot === 'other' ? OTHER_COLOR : SERIES[slot],
      borderColor: '#fff',
      borderWidth: { left: 0, right: 2, top: 0, bottom: 0 },
      borderSkipped: false,
      barThickness: 30,
    };
  }).filter(d => d.tasks.some(v => v > 0));

  const axisClient = (e, chart) => {
    const y = chart.scales.y;
    if (e.x < y.left || e.x > y.right || e.y < y.top || e.y > y.bottom) return null;
    return clients[Math.round(y.getValueForPixel(e.y))]?.c || null;
  };

  const names = (clientIdx, slot) => clients[clientIdx].wf.filter(y => y.w.slot === slot);

  document.getElementById('stack-sub').textContent =
    `${state.month === 'all' ? 'All time' : monthLabel(state.month, true)}. Bar length is log scale; segments show each workflow's share of the client total. Hover a segment for the workflow. ` +
    (state.month === 'all' ? 'Markers show the max tasks summed over every month in the data.' : 'Markers show the max tasks for the month.');
  document.getElementById('stack-wrap').style.height = Math.max(140, clients.length * 56 + 50) + 'px';

  charts.stack?.destroy();
  charts.stack = new Chart(document.getElementById('stack-chart'), {
    type: 'bar',
    data: { labels: clients.map(x => x.c.label), datasets },
    plugins: [stackMaxPlugin],
    options: {
      indexAxis: 'y',
      layout: { padding: { top: 12 } },
      // Clicking a client label on the y axis opens its HubSpot deal.
      onClick: (e, _els, chart) => {
        const c = axisClient(e, chart);
        if (c?.dealLink) window.open(c.dealLink, '_blank', 'noopener');
      },
      onHover: (e, _els, chart) => {
        chart.canvas.style.cursor = axisClient(e, chart)?.dealLink ? 'pointer' : '';
      },
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'point', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(),
          position: 'segment',
          yAlign: segmentYAlign,
          caretPadding: 6,
          filter: item => item.dataset.tasks[item.dataIndex] > 0,
          callbacks: {
            title: items => items[0]?.label,
            label: item => {
              const t = item.dataset.tasks[item.dataIndex];
              const ws = names(item.dataIndex, item.dataset.slot).filter(y => y.tasks > 0);
              if (item.dataset.slot !== 'other') return ` ${ws[0]?.w.name}: ${fmt(t)} tasks`;
              return [` Other (${ws.length} workflows): ${fmt(t)} tasks`, ...ws.map(y => `   ${y.w.name}: ${fmt(y.tasks)}`)];
            },
            footer: items => {
              const i = items[0].dataIndex;
              const { total, max } = clients[i];
              const t = items[0].dataset.tasks[i];
              const lines = total ? [`${((t / total) * 100).toFixed(1)}% of ${fmt(total)} client total`] : [];
              if (max) lines.push(`${((total / max) * 100).toFixed(1)}% of ${fmt(max)} max`);
              return lines;
            },
          },
        },
        maxMarkers: { values: clients.map(x => (x.max ? logLen(x.max) : null)), labels: clients.map(x => x.max), over: clients.map(x => x.max != null && x.total > x.max) },
      },
      scales: {
        x: {
          stacked: true,
          min: 0,
          max: maxLog,
          grid: { color: '#eef0f4' },
          border: { display: false },
          // Axis is in log10 units; label each power of ten with its real value.
          ticks: { stepSize: 1, color: '#9aa0af', font: { family: 'DM Mono', size: 11 }, callback: v => fmt(10 ** v) },
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
        <div class="legend-client">${clientLink(x.c, 'client-link')} <span class="${x.max != null && x.total > x.max ? 'over' : ''}">${fmt(x.total)}${x.max ? ` of ${fmt(x.max)} max` : ''}</span></div>
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
    client: c.name,
    color: c.color,
    backgroundColor: c.color,
    data: state.months.map(m => c.workflows.reduce((s, w) => s + w.months.filter(x => x.month === m).reduce((a, x) => a + x.tasks, 0), 0)),
    borderColor: '#fff',
    borderWidth: 2,
    borderRadius: { topLeft: 4, topRight: 4 },
    borderSkipped: 'bottom',
    maxBarThickness: 36,
    maxes: state.months.map(m => monthMax(c, m)),
  }));
  if (state.trendFocus && !datasets.some(d => d.client === state.trendFocus)) state.trendFocus = null;

  charts.trend?.destroy();
  charts.trend = new Chart(document.getElementById('trend-chart'), {
    type: 'bar',
    data: { labels: state.months.map(m => monthLabel(m)), datasets },
    plugins: [trendMaxPlugin],
    options: {
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          // Clicking a client focuses it (others hidden, axis goes linear); clicking it again clears focus.
          onClick: (_e, item) => {
            const client = datasets[item.datasetIndex].client;
            state.trendFocus = state.trendFocus === client ? null : client;
            applyTrendFocus();
          },
          onHover: e => { e.native.target.style.cursor = 'pointer'; },
          onLeave: e => { e.native.target.style.cursor = ''; },
          labels: {
            boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, font: { size: 12 },
            generateLabels: chart => chart.data.datasets.map((d, i) => {
              const dim = state.trendFocus && state.trendFocus !== d.client;
              return {
                text: d.label,
                datasetIndex: i,
                fillStyle: dim ? d.color + '55' : d.color,
                strokeStyle: dim ? d.color + '55' : d.color,
                lineWidth: 0,
                borderRadius: 3,
                fontColor: dim ? '#b4bac6' : state.trendFocus ? '#1a1d23' : '#5a6070',
              };
            }),
          },
        },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label: item => {
              const max = item.dataset.maxes[item.dataIndex];
              return ` ${item.dataset.label}: ${fmt(item.raw)} tasks` + (max ? ` of ${fmt(max)} max (${((item.raw / max) * 100).toFixed(1)}%)` : '');
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: '#d8dce6' }, ticks: { color: '#5a6070', font: { size: 12 } } },
        y: {
          grid: { color: '#eef0f4' },
          border: { display: false },
          ticks: { color: '#9aa0af', font: { family: 'DM Mono', size: 11 } },
        },
      },
    },
  });
  applyTrendFocus();
}

// Applies state.trendFocus to the trend chart. No focus: every client on a log axis.
// Focus: other clients are hidden (still listed, dimmed, in the legend so you can switch)
// and the axis turns linear, sized to the focused client's bars and maxes.
function applyTrendFocus() {
  const chart = charts.trend;
  const focus = state.trendFocus;
  const peakOf = ds => Math.max(1, ...ds.flatMap(d => [...d.data, ...d.maxes.filter(v => v != null)]));

  chart.data.datasets.forEach((d, i) => chart.setDatasetVisibility(i, !focus || focus === d.client));

  const y = chart.options.scales.y;
  if (focus) {
    y.type = 'linear';
    y.min = 0;
    y.max = niceCeil(peakOf(chart.data.datasets.filter(d => d.client === focus)) * 1.05);
    y.ticks.callback = v => fmt(v);
  } else {
    // Top of the log axis: the next power of ten above every bar and every max.
    y.type = 'logarithmic';
    y.min = 1;
    y.max = 10 ** Math.ceil(Math.log10(peakOf(chart.data.datasets)) + 1e-9);
    // Only label powers of ten (1, 10, 100, ...).
    y.ticks.callback = v => (Number.isInteger(Math.log10(v)) ? fmt(v) : '');
  }

  const label = focus ? state.clients.find(c => c.name === focus).label : null;
  document.getElementById('trend-sub').textContent = focus
    ? `All months in the data set, regardless of the month filter. Showing ${label} on a linear scale; click ${label} in the legend again to show all clients on a log scale. Dashed ticks mark the monthly max (red when exceeded).`
    : "All months in the data set, regardless of the month filter. Log scale. Dashed ticks mark each client's monthly max (red when exceeded). Click a client in the legend to focus it.";
  chart.update();
}

// Rounds up to a tidy axis maximum (1, 2, 2.5, 5 or 10 times a power of ten).
function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].find(m => m * p >= v) * p;
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
      <td>${clientLink(r.client, 'client-pill')}</td>
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

// ---------- Max markers ----------

const MAX_COLOR = '#011028';
const OVER_COLOR = '#e34948';

// Stacked chart: a vertical tick across each client's bar at its max (in log10 units),
// labeled with the max above the bar. Values come from options.plugins.maxMarkers.
const stackMaxPlugin = {
  id: 'maxMarkers',
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, scales: { x, y } } = chart;
    ctx.save();
    (opts.values || []).forEach((v, i) => {
      if (v == null) return;
      const px = x.getPixelForValue(v);
      const py = y.getPixelForValue(i);
      const color = opts.over[i] ? OVER_COLOR : MAX_COLOR;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(px, py - 19);
      ctx.lineTo(px, py + 19);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '11px "DM Mono", monospace';
      ctx.textBaseline = 'bottom';
      const text = `max ${fmt(opts.labels[i])}`;
      const w = ctx.measureText(text).width;
      // Keep the label inside the chart area.
      ctx.textAlign = px + w / 2 > chart.chartArea.right ? 'right' : 'center';
      ctx.fillText(text, ctx.textAlign === 'right' ? px - 4 : px, py - 20);
    });
    ctx.restore();
  },
};

// Trend chart: a dashed horizontal tick over each client's bar at that month's max.
const trendMaxPlugin = {
  id: 'trendMax',
  afterDatasetsDraw(chart) {
    const { ctx, scales: { y } } = chart;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    chart.data.datasets.forEach((d, di) => {
      const meta = chart.getDatasetMeta(di);
      if (!chart.isDatasetVisible(di)) return;
      if (state.trendFocus && state.trendFocus !== d.client) return;
      meta.data.forEach((bar, i) => {
        const max = d.maxes?.[i];
        if (!max) return;
        const py = y.getPixelForValue(max);
        const half = bar.width / 2 + 3;
        ctx.strokeStyle = d.data[i] > max ? OVER_COLOR : MAX_COLOR;
        ctx.beginPath();
        ctx.moveTo(bar.x - half, py);
        ctx.lineTo(bar.x + half, py);
        ctx.stroke();
      });
    });
    ctx.restore();
  },
};

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
    const { clients, months } = normalize(await fetchApi('tasks'));
    state.clients = clients;
    state.months = months;
    // Default to the current month, or the latest month in the data if this month has none.
    if (state.month === null) {
      const thisMonth = currentMonth();
      state.month = months.includes(thisMonth) ? thisMonth : months[months.length - 1] || 'all';
    }
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
