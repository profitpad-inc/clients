# HANDOFF.md

Everything a new thread needs to understand and continue this project quickly.

## What this is

**ProfitPad Clients** is a small static internal dashboard that reports on n8n usage per ProfitPad client. Right now it has one report page, **Task Usage**, which shows how many n8n tasks each client has consumed, broken down by workflow and month.

- Production: `https://clients.profitpad.com/`
- Local: `http://localhost/profitpad-clients/` (files at `/Users/riipen/Sites/profitpad-clients`)
- Visual style is copied from `https://demo.profitpad.com/` (and its `/template/` page). The favicon and logo were downloaded from `https://demo.profitpad.com/template/`.

There is no build step, no package manager, and no backend in this repo. It is plain HTML, CSS and vanilla JS. Chart.js is loaded from cdnjs.

## File structure

```
/
├── index.html            Redirects to ./dashboard/ (meta refresh + JS). Placeholder home for now.
├── AGENTS.md             Agent instructions (do not run a preview, read this file, conventions).
├── CLAUDE.md             Points to AGENTS.md.
├── HANDOFF.md            This file.
├── README.md             Short project overview.
├── assets/
│   ├── styles.css        Shared layout and theme: top nav, sidebar, page header, cards, spinner, mobile layout.
│   ├── favicon.svg       From demo.profitpad.com/template/favicon.svg
│   └── profitpad_logo.svg From demo.profitpad.com/template/profitpad_logo.svg (white logo for the gradient nav)
└── dashboard/
    ├── index.html        Task Usage page. Page title "ProfitPad Clients". Page-specific CSS is inline in <style>.
    └── dashboard.js      Fetches data, normalizes it, renders KPIs, charts and table.
```

### Paths must stay relative

Because the site lives at the domain root in production but under `/profitpad-clients/` locally, every href/src is relative (`../assets/styles.css`, `./dashboard/`). Never use root-absolute paths like `/assets/...`.

## Page layout (shared shell)

Every page should use the same shell (copy it from `dashboard/index.html`):

1. `<nav class="topnav">` gradient bar (`#011028` to `#0671C0`) with the ProfitPad logo linking to `../`.
2. `<div class="layout">` containing:
   - `<aside class="sidebar">` with a "Reports" label and a `<ul>` of links. The current page's link has `class="active"` and `aria-current="page"`. Each item has a 18px stroke icon (Lucide-style inline SVG) and a text label.
   - `<main class="content"><div class="page">...</div></main>` for page content.
3. Below 800px wide the sidebar becomes a horizontal strip under the nav.

**Sidebar items currently:** only `Task Usage` (`../dashboard/`). To add a page, create `newpage/index.html` with the same shell, then add the new `<li>` to the sidebar in **every** page (there is no templating, the sidebar is duplicated per page).

Design tokens are CSS variables on `:root` in `assets/styles.css` (`--navy`, `--blue`, `--blue-tint`, `--bg`, `--border`, `--text`, `--text-secondary`, `--text-muted`, etc.). Cards (`.card`) have a 3px navy-to-blue gradient top bar, 14px radius, 1.5px border. Headings use `"Eastman Roman", Verdana`; body uses `Inter, "Trebuchet MS"`; mono numbers use DM Mono (Google Fonts). The site is light mode only, matching demo.profitpad.com.

## Data source

```
GET https://n8n.profitpad.com/webhook/n8n-tools-api?request=tasks
```

An n8n webhook. No auth. CORS returns `Access-Control-Allow-Origin` for `https://clients.profitpad.com` and `http://localhost` (verified 2026-10-13). If the page is opened from another origin (e.g. `file://`), the fetch will fail with a CORS error and the page shows an error state.

Response shape:

```json
{
  "results": [
    {
      "client_name": "camo",
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
- At the time of writing there were 3 clients (camo, profitpad, sage), 27 workflows, months 2026-08 to 2026-10.

## How the Task Usage page works (`dashboard/dashboard.js`)

1. `load()` fetches the API, calls `normalize()`, stores results in `state`, and renders. A "Refresh" link at the bottom re-runs `load()`.
2. `normalize()` converts the payload into `state.clients`:
   `[{ name, label, color, workflows: [{ id, name, months: [{month, executions, tasks, firstRun, lastRun}], allTimeTasks, slot }] }]`
   - Clients are sorted alphabetically; `label` is title-cased (`camo` to `Camo`).
   - Each client gets a fixed categorical `color` by alphabetical position (used in the monthly trend chart).
   - Each client's workflows are ranked by **all-time** tasks and given a color `slot` 0..7. If a client has more than 8 workflows, ranks 1 to 7 get slots and the rest are folded into `'other'` (gray). Slots use all-time totals so colors do not change when the month filter changes.
3. `state.month` is the active month filter (`'all'` or `YYYY-MM`). Filter buttons are built from every month present in the data.
4. Reports rendered:
   - **KPI tiles** (`renderKpis`): tasks used, executions (with tasks per execution), active clients, active workflows, for the selected period.
   - **Tasks per client, by workflow** (`renderStack`): the main requested report. Horizontal stacked Chart.js bar, one bar per client sorted by total. There is one dataset per color slot (slot k = that client's k-th workflow), so each bar has distinct segment colors and the tooltip looks up the real workflow name per client. Under the chart is a per-client legend listing each workflow with its swatch and task count. Respects the month filter.
   - **Monthly tasks by client** (`renderTrend`): grouped vertical bar, x = month, one series per client. Always shows all months (ignores the filter).
   - **Workflow detail** (`renderTable`): sortable table (click headers) of client, workflow, executions, tasks, tasks/exec, last run, with a text search. Respects the month filter.
5. All API strings are HTML-escaped with `esc()` before being inserted.

The categorical palette (`SERIES` in dashboard.js and `--series-*` in dashboard/index.html) is a validated colorblind-safe order: blue, orange, aqua, yellow, magenta, green, violet, red, plus gray for "Other". Keep the order; never generate extra hues.

## Ideas / possible next steps

- Make `/index.html` a real landing page once there is more than one report.
- More reports from the same endpoint (executions per workflow, tasks per execution outliers, month over month change per client).
- If more endpoints are added to `n8n-tools-api` (other `request=` values), add a page per report and a sidebar item for each.
