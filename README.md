# ProfitPad Clients

Internal dashboard for reporting on n8n usage per ProfitPad client.

- Production: https://clients.profitpad.com/
- Local: http://localhost/profitpad-clients/docs/

## Reports

- **Client Overview** (`/overview/`, the landing page): each client's tasks against their monthly max, and net server costs billed per month. Client names link to their HubSpot deal.
- **Task Usage** (`/dashboard/`): tasks used per client broken down by workflow, monthly tasks by client (both marked with each client's max tasks per month), and a sortable workflow detail table. Filterable by month. Client names link to their HubSpot deal.

## Stack

Static site: plain HTML, CSS and vanilla JS, with [Chart.js](https://www.chartjs.org/) loaded from cdnjs. No build step and no dependencies to install. Data is fetched in the browser from an n8n webhook:

```
GET https://n8n.profitpad.com/webhook/n8n-tools-api?request=tasks
GET https://n8n.profitpad.com/webhook/n8n-tools-api?request=server_cost
```

The webhook only allows requests (CORS) from `https://clients.profitpad.com` and `http://localhost`, so opening the files directly from disk will not load data.

## Structure

Everything served by the website lives in `docs/`, which is the web root. Project markdown files (README, HANDOFF, AGENTS, CLAUDE) stay at the repo root.

```
docs/
  index.html          Redirects to ./overview/
  assets/             Shared styles.css, common.js, favicon and logo
  overview/           Client Overview page (index.html + overview.js)
  dashboard/          Task Usage page (index.html + dashboard.js)
AGENTS.md / CLAUDE.md Instructions for AI agents
HANDOFF.md            Detailed project handoff: structure, data shape, how each report works
```

## Development

Edit the files and reload the page. All paths are relative so the site works both at a domain root and under a subpath. See [HANDOFF.md](HANDOFF.md) for conventions and details.
