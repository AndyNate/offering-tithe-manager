-- AWC donor app — SQLite schema
-- Money is stored as INTEGER cents (divide by 100 in the renderer).
-- Dates are stored as 'YYYY-MM-DD' TEXT so strftime() report queries work.

CREATE TABLE donors (
    tithe_id       VARCHAR(20) PRIMARY KEY,
    date           DATE NOT NULL,                 -- date the donor first registered ('YYYY-MM-DD')
    full_name      VARCHAR(255) NOT NULL,
    spouse         VARCHAR(255),
    email          VARCHAR(255),
    notes          TEXT,
    is_new_entry   BOOLEAN NOT NULL DEFAULT 1     -- boolean as 0/1
);

CREATE TABLE giving (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    tithe_id           VARCHAR(20) NOT NULL REFERENCES donors(tithe_id),
    date               DATE NOT NULL,             -- date the donation was recorded ('YYYY-MM-DD')
    giving_type        VARCHAR(20) NOT NULL CHECK (giving_type IN ('Cash / Cheque', 'E-Transfer', 'Online')),
    regular            INTEGER NOT NULL DEFAULT 0,   -- cents
    mission            INTEGER NOT NULL DEFAULT 0,   -- cents
    building_fund      INTEGER NOT NULL DEFAULT 0,   -- cents
    other              INTEGER NOT NULL DEFAULT 0,   -- cents
    total_amount       INTEGER GENERATED ALWAYS AS (regular + mission + building_fund + other) STORED CHECK (total_amount > 0),   -- cents
    note               TEXT,
    is_fee             BOOLEAN NOT NULL DEFAULT 0,
    online_fee_amount  INTEGER NOT NULL DEFAULT 0,   -- cents
    created_donor      BOOLEAN NOT NULL DEFAULT 0    -- true when this gift's submit created the donor ("New" badge)
);

CREATE INDEX idx_giving_tithe_id ON giving (tithe_id);

CREATE TABLE deposits (
    deposit_number   VARCHAR(10) PRIMARY KEY,
    date             DATE NOT NULL,                -- 'YYYY-MM-DD'
    teller1          VARCHAR(255),
    teller2          VARCHAR(255),
    cash_subtotal    INTEGER NOT NULL DEFAULT 0,   -- cents
    cheques_subtotal INTEGER NOT NULL DEFAULT 0,   -- cents
    total            INTEGER NOT NULL DEFAULT 0,   -- cents
    tithe_sheet_total INTEGER NOT NULL DEFAULT 0,  -- cents
    counts_json      TEXT,                         -- bill/coin counts as JSON
    cheques_json     TEXT,                         -- [{identification, amount}] amount in cents
    emailed_to       TEXT                          -- comma-separated recipients when emailed
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
