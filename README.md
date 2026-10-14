# ProfitPad Clients

Internal dashboard for reporting on n8n usage per ProfitPad client.

- Production: https://clients.profitpad.com/
- Local: http://localhost/profitpad-clients/

## Reports

- **Task Usage** (`/dashboard/`): tasks used per client broken down by workflow, monthly tasks by client, and a sortable workflow detail table. Filterable by month.

## Stack

Static site: plain HTML, CSS and vanilla JS, with [Chart.js](https://www.chartjs.org/) loaded from cdnjs. No build step and no dependencies to install. Data is fetched in the browser from an n8n webhook:

```
GET https://n8n.profitpad.com/webhook/n8n-tools-api?request=tasks
```

The webhook only allows requests (CORS) from `https://clients.profitpad.com` and `http://localhost`, so opening the files directly from disk will not load data.

## Structure

```
index.html            Redirects to ./dashboard/
assets/               Shared styles.css, favicon and logo
dashboard/            Task Usage page (index.html + dashboard.js)
AGENTS.md / CLAUDE.md Instructions for AI agents
HANDOFF.md            Detailed project handoff: structure, data shape, how each report works
```

## Development

Edit the files and reload the page. All paths are relative so the site works both at a domain root and under a subpath. See [HANDOFF.md](HANDOFF.md) for conventions and details.
