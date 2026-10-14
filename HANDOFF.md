# HANDOFF.md

Everything a new thread needs to understand and continue this project quickly.

## What this is

**ProfitPad Clients** is a small static internal dashboard that reports on n8n usage per ProfitPad client. It has two report pages: **Client Overview** (the landing page: each client's tasks against their monthly max, plus server costs billed per month) and **Task Usage** (n8n tasks per client, broken down by workflow and month).

- Production: `https://clients.profitpad.com/`
- Local: `http://localhost/profitpad-clients/docs/` (repo at `/Users/riipen/Sites/profitpad-clients`)
- **`docs/` is the web root.** Everything the website serves lives in `docs/`; the production server should point its document root at `docs/`. Project markdown files (README, HANDOFF, AGENTS, CLAUDE) stay at the repo root and must never go in `docs/` (despite the folder name, `docs/` is the website, not documentation).
- Visual style is copied from `https://demo.profitpad.com/` (and its `/template/` page). The favicon and logo were downloaded from `https://demo.profitpad.com/template/`.

There is no build step, no package manager, and no backend in this repo. It is plain HTML, CSS and vanilla JS. Chart.js is loaded from cdnjs.

## File structure

```
/
├── AGENTS.md                 Agent instructions (do not run a preview, read this file, conventions).
├── CLAUDE.md                 Points to AGENTS.md.
├── HANDOFF.md                This file.
├── README.md                 Short project overview.
├── .gitignore
└── docs/                      Web root. Everything the site serves.
    ├── index.html            Redirects to ./overview/ (meta refresh + JS).
    ├── assets/
    │   ├── styles.css        Shared layout and theme: top nav, sidebar, page header, cards, filters, KPI tiles, tables, client links, spinner, mobile layout.
    │   ├── common.js         Shared JS for every page: API fetch, IGNORED_MONTHS, formatting, clientLink, normalizeTasks, normalizeCosts, monthMax.
    │   ├── favicon.svg       From demo.profitpad.com/template/favicon.svg
    │   └── profitpad_logo.svg From demo.profitpad.com/template/profitpad_logo.svg (white logo for the gradient nav)
    ├── overview/
    │   ├── index.html        Client Overview page (landing page). Page-specific CSS (usage bars, pivot table) is inline in <style>.
    │   └── overview.js       Fetches tasks + server_cost, merges per client, renders KPIs, summary table, monthly pivot table.
    └── dashboard/
        ├── index.html        Task Usage page. Page title "ProfitPad Clients". Page-specific CSS (series colors, chart legend) is inline in <style>.
        └── dashboard.js      Fetches task data, renders KPIs, charts and table.
```

### Paths must stay relative

Because the site lives at the domain root in production but under `/profitpad-clients/docs/` locally, every href/src is relative (`../assets/styles.css`, `./dashboard/`). Never use root-absolute paths like `/assets/...`.

## Page layout (shared shell)

Every page should use the same shell (copy it from `docs/dashboard/index.html`):

1. `<nav class="topnav">` gradient bar (`#011028` to `#0671C0`) with the ProfitPad logo linking to `../`.
2. `<div class="layout">` containing:
   - `<aside class="sidebar">` with a "Reports" label and a `<ul>` of links. The current page's link has `class="active"` and `aria-current="page"`. Each item has a 18px stroke icon (Lucide-style inline SVG) and a text label.
   - `<main class="content"><div class="page">...</div></main>` for page content.
3. Below 800px wide the sidebar becomes a horizontal strip under the nav.

**Sidebar items currently:** `Client Overview` (`../overview/`), then `Task Usage` (`../dashboard/`). To add a page, create `docs/newpage/index.html` with the same shell, load `../assets/common.js` before the page script, then add the new `<li>` to the sidebar in **every** page (there is no templating, the sidebar is duplicated per page).

Shared CSS (filters, KPI tiles, `.reports`/`.card-head`, tables, `.client-pill`/`.client-link`, `.meta`) lives in `styles.css`; only page-specific CSS goes inline. Shared JS lives in `docs/assets/common.js` (plain globals, no modules).

Design tokens are CSS variables on `:root` in `docs/assets/styles.css` (`--navy`, `--blue`, `--blue-tint`, `--bg`, `--border`, `--text`, `--text-secondary`, `--text-muted`, etc.). Cards (`.card`) have a 3px navy-to-blue gradient top bar, 14px radius, 1.5px border. Headings use `"Eastman Roman", Verdana`; body uses `Inter, "Trebuchet MS"`; mono numbers use DM Mono (Google Fonts). The site is light mode only, matching demo.profitpad.com.

## Data sources

Both are the same n8n webhook with a different `request=` value, fetched with `fetchApi(request)` from common.js. No auth. CORS returns `Access-Control-Allow-Origin` for `https://clients.profitpad.com` and `http://localhost` (verified 2026-10-13 for both requests). If the page is opened from another origin (e.g. `file://`), the fetch will fail with a CORS error and the page shows an error state.

`IGNORED_MONTHS` in common.js (currently `2026-08`) is dropped from both endpoints in `normalizeTasks()` / `normalizeCosts()`, so ignored months never appear anywhere on the site.

### Tasks

```
GET https://n8n.profitpad.com/webhook/n8n-tools-api?request=tasks
```

Response shape:

```json
{
  "results": [
    {
      "client_name": "camo",
      "deal_link": "https://app.hubspot.com/contacts/44271052/record/0-3/61032290442",
      "max_tasks": [
        { "from": "2026-08-01", "to": "2100-12-31", "max": 10000 }
      ],
      "workflows": [
        {
          "workflow_id": "2EBH3DXVC82Jw2MZ",
          "workflow_name": "update hs deal",
          "months": [
            {
              "month": "2026-09",
              "count_executions": 17,
              "sum_tasks_used": 119,
              "first_run_at": "2026-09-29",
              "recent_run_at": "2026-09-30"
            }
          ]
        }
      ]
    }
  ]
}
```

- One entry per client, one entry per workflow, one entry per month (`YYYY-MM`) that workflow ran.
- A workflow only has entries for months it actually ran.
- `max_tasks` is the client's maximum tasks per month, as a list of date ranges (`from`/`to` inclusive, `YYYY-MM-DD`). A client may have no `max_tasks` (profitpad currently has none), in which case no max is shown. `deal_link` is the client's HubSpot deal URL (missing for some clients, e.g. profitpad); only http(s) values are kept, as `client.dealLink`.
- At the time of writing there were 3 clients (camo, profitpad, sage), 27 workflows, months 2026-08 to 2026-10.

`normalizeTasks()` (common.js) turns this into `{ clients, months }`: clients sorted alphabetically, each `{ name, label, caps: [{from, to, max}], dealLink, workflows: [{ id, name, months: [{month, executions, tasks, firstRun, lastRun}], allTimeTasks }] }`, workflows ranked by all-time tasks, workflows with no remaining months dropped. `monthMax(client, 'YYYY-MM')` returns the max for a month (the range overlapping that month; if several overlap, the one starting latest wins), or null.

### Server cost

```
GET https://n8n.profitpad.com/webhook/n8n-tools-api?request=server_cost
```

```json
{
  "results": [
    {
      "client_name": "camo",
      "billing": [
        { "invoice_month": "202609", "currency": "USD", "gross_cost": 0.36, "credits": -0.06, "net_billed": 0.3 }
      ]
    }
  ]
}
```

- Server costs billed per client per month. The site only shows `net_billed` (labeled "Server cost"); gross and credits are parsed but not displayed. `invoice_month` is `YYYYMM` (no dash). `credits` is negative; `net_billed` = gross + credits.
- Clients are matched to the tasks data by `client_name`. At the time of writing only camo and sage had bills, both for 2026-09 only.
- `normalizeCosts()` (common.js) returns a `Map` of client name to `[{ month: 'YYYY-MM', gross, credits, net, currency }]` sorted by month.

## How the Client Overview page works (`docs/overview/overview.js`)

1. `load()` fetches `tasks` and `server_cost` with `Promise.allSettled`; if only `server_cost` fails, the page still renders with costs shown as `–` and a note in the footer.
2. `merge()` joins both by client name (clients in either endpoint are kept) and builds `client.months`, newest first: `{ month, tasks, executions, activeWorkflows, max, cost }`.
3. `state.thisMonth` is the current calendar month, or the latest month with task data if the current month has none.
4. Reports rendered:
   - **KPI tiles**: clients (active this month), tasks this month, clients over their max this month, and total server cost (net billed) for the latest billed month.
   - **Clients** summary table: one row per client, sorted by tasks this month: tasks, max, a usage bar (`usageCell`, red when over), active workflows, and the client's most recent bill with its month.
   - **By month** pivot table (`renderPivot`): one row per client, one column group per month (oldest to newest, every month in either endpoint) with tasks, usage bar of that month's max (`–` when no max) and net server cost, plus a totals row (cost total shows `Mixed` if currencies differ). The current month usually has no bill yet.
5. Client names link to the HubSpot deal via `clientLink()`.

## How the Task Usage page works (`docs/dashboard/dashboard.js`)

1. `load()` fetches `tasks`, calls `normalize()`, stores results in `state`, and renders. A "Refresh" link at the bottom re-runs `load()`.
2. `normalize()` calls the shared `normalizeTasks()` and adds dashboard-only fields:
   - Each client gets a fixed categorical `color` by alphabetical position (used in the monthly trend chart).
   - Each client's workflows are ranked by **all-time** tasks and given a color `slot` 0..7. If a client has more than 8 workflows, ranks 1 to 7 get slots and the rest are folded into `'other'` (gray). Slots use all-time totals so colors do not change when the month filter changes.
   - `periodMax(client)` returns the max for the active filter: that month's max, or for "All time" the **sum** of monthly maxes across every month in the data set.
3. `state.month` is the active month filter (`'all'` or `YYYY-MM`). On first load it defaults to the current calendar month, or the latest month in the data if the current month has no data; Refresh keeps the selected filter. Filter buttons are built from every month present in the data.
4. Reports rendered:
   - **KPI tiles** (`renderKpis`): tasks used, executions (with tasks per execution), active clients, active workflows, for the selected period.
   - **Tasks per client, by workflow** (`renderStack`): the main requested report. Horizontal stacked Chart.js bar, one bar per client sorted by total. There is one dataset per color slot (slot k = that client's k-th workflow), so each bar has distinct segment colors and the tooltip looks up the real workflow name per client. **Log scale:** each bar's length is `log10(client total)` and is split into segments by each workflow's share of that total (the x axis is linear in log10 units, labeled 1, 10, 100, ...). A plain logarithmic axis is deliberately not used on this stacked chart, because it would distort segment sizes. Each dataset keeps real values in `dataset.tasks`; `dataset.data` holds the scaled lengths, so tooltips must read `tasks`, not `raw`. **Max markers:** the `stackMaxPlugin` Chart.js plugin draws a vertical navy tick at `log10(periodMax)` across each client's bar, labeled `max N` (red if the client is over its max); the x axis extends to cover the max. The tooltip footer shows the percent of max. Under the chart is a per-client legend listing each workflow with its swatch and task count, with the header showing `total of max`. Respects the month filter.
   - **Monthly tasks by client** (`renderTrend`): grouped vertical bar, x = month, one series per client. Always shows all months (ignores the filter). Standard Chart.js logarithmic y axis (min 1, labels only on powers of ten); zero months simply show no bar. **Max markers:** each dataset carries `maxes` (per month, from `monthMax`), and `trendMaxPlugin` draws a dashed navy tick over each client's bar at that month's max (red when exceeded). The y axis max is the next power of ten above all bars and maxes. Tooltips show `of N max (x%)`. **Legend focus:** clicking a client in the legend sets `state.trendFocus` instead of hiding the series; `applyTrendFocus()` then hides the other clients' bars (`setDatasetVisibility`; they stay in the legend, dimmed, so another client can be clicked), switches the y axis to linear sized to the focused client's bars and maxes (rounded up with `niceCeil`), and updates the caption. Clicking the same client again returns to all clients on the log axis. Focus survives Refresh.
   - **Workflow detail** (`renderTable`): sortable table (click headers) of client, workflow, executions, tasks, tasks/exec, last run, with a text search. Respects the month filter.
5. **HubSpot deal links:** `clientLink(client, cls)` renders the client name as a link to `dealLink` (new tab), or a plain span when there is none. Used in the stacked chart legend headers and the table's client pills. On the stacked chart, clicking a client name on the y axis also opens the deal (pointer cursor on hover). The trend chart is not linked, since its legend toggles series.
6. All API strings are HTML-escaped with `esc()` before being inserted.

The categorical palette (`SERIES` in dashboard.js and `--series-*` in docs/dashboard/index.html) is a validated colorblind-safe order: blue, orange, aqua, yellow, magenta, green, violet, red, plus gray for "Other". Keep the order; never generate extra hues.

## Ideas / possible next steps

- A server cost chart on the overview once there are several months of bills (only 2026-09 exists so far).
- More reports from the same endpoint (executions per workflow, tasks per execution outliers, month over month change per client).
- If more endpoints are added to `n8n-tools-api` (other `request=` values), add a page per report and a sidebar item for each.
