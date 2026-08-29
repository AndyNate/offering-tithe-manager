# Offering & Tithe Management Program

A cross-platform desktop application (Windows, macOS, Linux) for AWC's offering/tithe recording: volunteers enter donations through a simple **Give** form, and a password-gated **Admin** panel manages donors, deposits, CSV import/export, and month-end / year-end reports. All data stays local in a single SQLite file — nothing is sent anywhere except optional deposit-report emails.

Built with **Electron 31** and **better-sqlite3** (React 18 renderer, vendored locally so the app runs fully offline). The original browser prototype (`AWC Donor Form.dc.html`) and its handoff package (`design_handoff_electron_donor_app/`) are kept for reference.

> **AI-assisted development:** this program was developed with the assistance of AI tooling.

## Give (entry) form
- Single **Full name or Tithe ID** field — matched against the donors table; unmatched names auto-create a donor with the lowest unused Tithe ID (starting at `1`, so numbers freed by deleted donors are reused); an unmatched numeric input errors with "Tithe ID doesn't exist."
- **Giving date** field — only shown/editable after admin sign-in; otherwise defaults to today.
- Donation split into four fields — **Regular, Mission, Building fund, Other** — with a live running total.
- **Payment method**: Cash / Cheque, E-Transfer, Online (locked to Cash / Cheque unless signed in as admin).
- Selecting **Online** reveals an **Online fee** field — enter whatever processing fee the online giving provider charged.
- **Notes** become required whenever an Other amount is entered.
- On **Submit** the gift is saved and the form immediately resets with empty fields, ready for the next entry (no confirmation screen).

## Admin panel
Opened from the **Admin** tab with the password (`admin`); **Log out** returns to the Give view and resets admin-only state.

- **Export / Import (CSV)**: export the donors and giving tables to Excel-compatible CSV; import either back, validating required columns before anything is written.
- **Search / edit donor**: fields for Tithe ID, Full name, Spouse, Email, Notes, Registration date with **Find donor** (by ID/name/email), **Newest entry**, **Edit**, **Add donor** (auto-assigns the lowest free Tithe ID), **Delete donor** (asks for confirmation first), and **Clear**.
- **Deposits**: a "New deposit" flow recording deposit number, date, teller names, cash/cheques subtotals, tithe-sheet totals, and per-denomination counts (with a printable/count sheet template, `deposit-template.xlsx`). The New deposit dialog fits on screen without scrolling and is click-to-save only (the Enter key never submits it). Deposit reports can optionally be emailed via the Brevo API (API key and sender address configured in-app); recipients can be managed in settings. Deposits can be recorded without signing in as admin — non-admins get an auto-generated read-only deposit number and today's date; admins can edit the deposit number, send report emails, and delete deposits.
- **Deposits table**: searchable by deposit # or date.
- **Month-end report**: month/year picker with Cash/Cheque, E-Transfer, Online and grand totals, plus an "Other donations report" listing each Other-amount entry's note.
- **Fund totals**: Regular/Mission/Building fund/Other totals for the selected month and year.
- **Year-end report**: each donor's Tithe ID, name, spouse, and total donated that year, with an **Export .csv** button that downloads the report as `year-end-report-<year>.csv`.
- **Donations table**: searchable by name or Tithe ID — date, Tithe ID, name (with a "New" badge for first-time donors), amount, method, fee, notes, and per-row Delete.

## Data storage
- Money is stored internally as integer cents; all amounts are displayed formatted.
- The database's default location depends on the platform:
  - **Windows portable** — `data\offering-tithe.db` next to the executable (the whole folder is self-contained; copy it to a USB stick and everything travels together).
  - **Windows (NSIS install), macOS, Linux** — the standard per-user app data folder (Electron `userData`): `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, `~/.config` on Linux — under a folder named `Offering & Tithe Management Program`.
- Anyone can run the program against a different database file at any time: **Admin → Settings → Database → "Use another database…"**. The choice is remembered and the app restarts on that file; click "Return to default database" to go back. "Back up database" saves a copy of the current file wherever you choose.
- When installing a newer Windows build into a fresh portable folder, **copy your existing `data\offering-tithe.db` into the new folder's `data\` directory** to keep your records.
- Existing databases are upgraded automatically on first launch: the `Tithly` payment method is renamed to **Online** (and its fee column to `online_fee_amount`), so any prior "Tithly" records read as "Online".

## Database
The live schema (created by `app/db.js`) contains:
- `donors`: `tithe_id` (PK, sequential), `date`, `full_name`, `spouse`, `email`, `notes`, `is_new_entry`.
- `giving`: `id` (PK), `tithe_id` (FK), `date`, `giving_type`, `regular`, `mission`, `building_fund`, `other`, `total_amount` (generated), `note`, `is_fee`, `online_fee_amount`, `created_donor`.
- `deposits`: `deposit_number` (unique), `date`, `teller1`, `teller2`, `cash_subtotal`, `cheques_subtotal`, `total`, `tithe_sheet_total`, `counts_json`, `cheques_json`, `emailed_to`.
- `settings`: key/value store (sha256-hashed admin password, Brevo API key/sender).

(`schema.sql` at the project root is the original prototype-era reference for `donors` and `giving`; `app/db.js` is the source of truth.)

## Development

Prerequisites: [Node.js](https://nodejs.org) (LTS) on Windows, macOS, or Linux. `better-sqlite3` is rebuilt for Electron automatically on install.

```sh
cd app
npm install          # installs deps + electron-rebuild for better-sqlite3
npm start            # run the app in dev mode
npm run test:db      # database test suites (run under electron)
```

Note: if a command fails with a file-lock/EBUSY error while OneDrive is syncing, simply retry.

## Packaging & installers

`electron-builder` targets all three platforms. Each installer must be built **on its own OS** (the `better-sqlite3` native module is compiled per platform); the app icon lives at `app/build/icon.png` and is converted automatically for each target.

| OS | Command | Outputs in `app/dist/` |
|---|---|---|
| Windows | `npm run dist:win` | `Offering-Tithe-Program-Setup-<version>.exe` (NSIS installer) + `Offering-Tithe-Program-Portable.exe` |
| macOS | `npm run dist:mac` | `Offering-Tithe-Program-<version>-<arch>.dmg` + `.zip` (x64 and arm64) |
| Linux | `npm run dist:linux` | `offering-tithe-program-<version>-<arch>.AppImage` + `.deb` |

`npm run dist` builds for whichever OS you are currently on. Installers are unsigned unless code-signing certificates are configured.

### Automated builds (GitHub Actions)

Pushing a version tag (e.g. `git tag v1.1.0 && git push origin v1.1.0`) triggers `.github/workflows/build.yml`, which builds the Windows, macOS, and Linux installers in parallel on GitHub's machines and attaches them to the matching GitHub Release. The workflow can also be run manually from the Actions tab.

### Pull request security scans

`.github/workflows/security.yml` runs on every pull request and push to `main`/`master`:

| Check | What it does | Blocks the PR on |
|---|---|---|
| Secrets (gitleaks) | scans the diff/history for hardcoded API keys, passwords, tokens | any finding |
| Code scan (Semgrep) | scans for suspicious/vulnerable patterns (hardcoded credentials, unsafe `eval`, potential exfiltration) | any finding |
| Dependency audit (npm) | `npm audit` against production dependencies | high/critical vulnerabilities |
| CodeQL | GitHub's static analysis; results appear in the Security tab (report-only until code scanning is enforced) | no (reports only) |

To make the three blocking checks **required** so a pull request cannot merge with a failing scan: **Settings → Branches → Add branch protection rule** (or **Settings → Rulesets**), target `main`/`master`, enable *Require status checks to be passing*, and add:

- `Security scan / Secrets (gitleaks)`
- `Security scan / Code scan (Semgrep)`
- `Security scan / Dependency audit (npm)`

## Files
- `app/` — the Electron application (main process `main.js`, database layer `db.js`, preload bridge `preload.js`, UI in `src/index.html` + `src/support.js`, tests in `test/`, build icon in `build/`).
- `app/dist/` — built installers: `Offering-Tithe-Program-Setup-*.exe`, `Offering-Tithe-Program-Portable.exe`, `.dmg`/`.zip`, `.AppImage`/`.deb` (see "Packaging & installers").
- `.github/workflows/build.yml` — CI workflow that builds all three platform installers on a version tag.
- `.github/workflows/security.yml` — PR/push security scans (secrets, code patterns, dependency audit, CodeQL).
- `changelog.md` — change log of updates made to the app.
- `AWC Donor Form.dc.html` — original working prototype (reference only).
- `schema.sql` — reference SQL schema.
- `design_handoff_electron_donor_app/` — design/handoff documentation used to build the app.
- `overall_licensing/` — license documents and third-party notices.

## License
Released under the [MIT license](LICENSE) — Copyright © 2026 Nathan Douglas Allen. See also [`overall_licensing/`](overall_licensing/) for third-party notices and [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to contribute.
