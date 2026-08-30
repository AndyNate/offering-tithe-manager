# Database

The app stores everything in a single self-contained SQLite file (`offering-tithe.db`), created and managed by `app/db.js`. Money is stored internally as integer cents; all amounts are displayed formatted.

## Tables

The live schema (created by `app/db.js`) contains:

- `donors`: `tithe_id` (PK, sequential), `date`, `full_name`, `spouse`, `email`, `notes`, `is_new_entry`.
- `giving`: `id` (PK), `tithe_id` (FK), `date`, `giving_type`, `regular`, `mission`, `building_fund`, `other`, `total_amount` (generated), `note`, `is_fee`, `online_fee_amount`, `created_donor`.
- `deposits`: `deposit_number` (unique), `date`, `teller1`, `teller2`, `cash_subtotal`, `cheques_subtotal`, `total`, `tithe_sheet_total`, `counts_json`, `cheques_json`, `emailed_to`.
- `settings`: key/value store (hashed admin password, Brevo API key/sender).

## Notes

- `schema.sql` at the project root is the original prototype-era reference for `donors` and `giving`; `app/db.js` is the source of truth.
- Money is stored as integer cents to avoid floating-point rounding.
- Dates are kept in local time.
- All user input goes through SQL parameterized queries.

## Storage location

The database file's default location depends on the platform:

- **Windows portable** — `data\offering-tithe.db` next to the executable (the whole folder is self-contained; copy it to a USB stick and everything travels together).
- **Windows (NSIS install), macOS, Linux** — the standard per-user app data folder (Electron `userData`): `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, `~/.config` on Linux — under a folder named `Offering & Tithe Management Program`.

Any database file can be used or created at any time from **Admin → Settings → Database** ("Use another database…" / "Return to default database"), and "Back up database" copies the current file wherever you choose.