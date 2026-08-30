# Contributing

Thanks for your interest in the Offering & Tithe Management Program. This project is released under
the MIT license — see `LICENSE` at the project root.

## Getting started

Prerequisites: [Node.js](https://nodejs.org) (LTS) on Windows, macOS, or Linux.

```sh
cd app
npm install             # installs deps + electron-rebuild for better-sqlite3
npm start               # run the app in dev mode
npm run test:db         # run the database test suites
npm run dist:win        # build the Windows installers (on Windows)
npm run dist:mac        # build the macOS installers (on macOS)
npm run dist:linux      # build the Linux installers (on Linux)
npm run dist            # build for the current OS
```

## Where things live

- `app/main.js` — Electron main process (window, IPC handlers, email).
- `app/preload.js` — narrow `contextBridge` API exposed to the renderer.
- `app/db.js` — SQLite data layer (the source of truth for the schema).
- `app/src/index.html` — the app UI (a template + logic in one file).
- `app/src/support.js` — generated renderer runtime (rebuild from `dc-runtime`, do not hand-edit).
- `app/test/db.test.js` — database test suite.

## Before you submit

- Run `npm run test:db` and make sure all checks pass.
- Don't commit generated or local files. Build outputs, `node_modules`, and
  any `.db` data files are already git-ignored.
- Keep third-party notices accurate if you add dependencies: update
  `overall_licensing/THIRD-PARTY-NOTICES.md` and add any license text under
  `overall_licensing/licenses/`.
- Preserve the existing behavior: money is stored as integer cents, dates are
  kept in local time, and all user input goes through SQL parameterized queries.

## Security scans

`.github/workflows/security.yml` runs on every pull request and push to `main`/`master`:

| Check | What it does | Blocks the PR on |
|---|---|---|
| Secrets (gitleaks) | scans the diff/history for hardcoded API keys, passwords, tokens | any finding |
| Code scan (Semgrep) | scans for suspicious/vulnerable patterns (hardcoded credentials, unsafe `eval`, potential exfiltration) | any finding |
| Dependency audit (npm) | `npm audit` against production dependencies | high/critical vulnerabilities |
| CodeQL | GitHub's static analysis; results appear in the Security tab (report-only until code scanning is enforced) | no (reports only) |

## License note

By contributing, you agree that your contributions are licensed under the same
MIT license as the rest of the project.
