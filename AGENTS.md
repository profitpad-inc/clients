# AGENTS.md

Instructions for AI agents (Claude Code, Codex, etc.) working in this repo.

## Read first

- **Read `HANDOFF.md` before doing anything.** It describes what this project does, how it is structured, where the data comes from, and the conventions to follow.
- **Keep `HANDOFF.md` and `README.md` up to date.** Whenever you add a page or report, change the data source, add a sidebar item, change the structure, or change conventions, update both files in the same change.

## Do not run a preview

- **Do not start a dev server or open a preview/browser to view the site.** The site is already served by the local web server at `http://localhost/profitpad-clients/docs/` and the user will check it themselves.
- This is a static site with no build step. Edit the files directly.
- **All site files live in `docs/`** (the web root). Project markdown files (`AGENTS.md`, `CLAUDE.md`, `HANDOFF.md`, `README.md`) stay at the repo root. Never put them or other non-site files in `docs/` (despite its name, `docs/` is the website, not documentation).

## Conventions

- Plain HTML, CSS and vanilla JS. No framework, no bundler, no npm.
- All links and asset paths must be **relative** (`../assets/...`, `./dashboard/`), never root-absolute (`/assets/...`). The site is served both at the domain root (`https://clients.profitpad.com/`) and under a subpath (`http://localhost/profitpad-clients/docs/`).
- Match the visual style of https://demo.profitpad.com/ (gradient top nav, white cards with a gradient top bar, `#f4f5f7` background, `#0671C0` accent). Shared styles live in `docs/assets/styles.css`.
- Never use em dashes in copy or docs; use commas instead.
