# Licensing Overview — Offering & Tithe Management Program

> **Disclaimer:** This is a practical summary, not legal advice. For high-stakes
> commercial decisions, consult an intellectual-property lawyer.

This folder explains who owns what in this project and what you are allowed to
do with it. Two categories of code/assets exist here, and they have completely
different rules:

---

## Current status

**Released under the MIT license** (2026). The project's own code is licensed
under the MIT license — see `app/LICENSE` and the root `LICENSE`. The MIT
template in `LICENSE-OPTIONS.md` remains there for reference and for reuse in
other projects.

---

## 1. Your own code — you own it outright

Everything written specifically for this project is yours:

- `app/main.js`, `app/preload.js`, `app/db.js`, `app/schema.sql`
- `app/src/index.html` (the app UI), `app/src/resources.js`, `app/test/db.test.js`
- `app/package.json` (project configuration)
- `app/src/deposit-template.xlsx` (your deposit sheet template)

**License:** the project's own code is released under the **MIT license**
(see `app/LICENSE` and the root `LICENSE`). This means anyone may use, copy,
modify, merge, publish, distribute, sublicense, or sell the software, subject
to including the copyright and permission notice. MIT is permissive — it allows
commercial and closed-source derivatives and does not require others to
open-source their own changes.

The `LICENSE-OPTIONS.md` template is retained for reference.

**One caveat:** the original browser prototype (`design_handoff_electron_donor_app/`)
came from a design-tool handoff. If that tool's terms impose conditions on
exports, they would cover the prototype files only — the desktop app code above
was written fresh for this project.

## 2. Third-party components — free to use, small obligations

The app bundles open-source software. **None of it restricts you from selling,
distributing, or modifying your app**, including commercially. The full list,
versions, and copyright holders is in `THIRD-PARTY-NOTICES.md`; verbatim license
texts are in `licenses/`.

Summary of your rights per license type:

| License | Used by | Can you sell/distribute? | What you must do |
|---|---|---|---|
| MIT | Electron, better-sqlite3, React, build tools | Yes, no restrictions | Keep the copyright + license notice with distributions |
| Public domain | SQLite engine | Yes | Nothing |
| SIL OFL 1.1 | Archivo font | Yes (bundled with software) | Include font copyright + OFL text; never sell the .woff2 alone |

### The one ongoing obligation

When you share the packaged app (`Offering-Tithe-Program-Portable.exe` or the zip),
include this folder or at least `THIRD-PARTY-NOTICES.md` + the `licenses/`
texts. That satisfies every attribution condition in one step. There is no
requirement to open-source your own code — MIT does not work that way.

### Things that are NOT code licenses (but worth knowing)

- **Brevo email service**: sending deposit emails uses Brevo's API. That
  relationship is governed by Brevo's Terms of Service and your account plan —
  separate from any software licensing.
- **Trademarks**: the names "Electron", "React", etc. are trademarks of their
  owners. Describing your app as "built with Electron" is fine; naming your own
  product after them is not.
- **No warranty**: every bundled component is provided "as is" — if something
  breaks, their authors are not liable (and neither is implied for your code).

---

## Folder contents

```
overall_licensing/
├── README.md                  ← this overview
├── THIRD-PARTY-NOTICES.md     ← component list to ship with distributions
├── LICENSE-OPTIONS.md         ← how to license YOUR code (MIT template inside)
└── licenses/
    ├── electron-MIT.txt           Electron runtime
    ├── better-sqlite3-MIT.txt     SQLite driver
    ├── react-MIT.txt              React + ReactDOM (vendored copies)
    ├── archivo-OFL11.txt          Archivo font (vendored copy)
    ├── sqlite-publicdomain.txt    SQLite engine
    ├── electron-builder-MIT.txt   packaging tool (dev-only)
    └── electron-rebuild-MIT.txt   native-module tool (dev-only)
```

Additionally, every packaged build already contains Electron's own required
notices: `LICENSE.electron.txt` and `LICENSES.chromium.html` inside
`dist/win-unpacked/`.
