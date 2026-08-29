# Third-Party Notices

This application ("Offering & Tithe Management Program") incorporates the following third-party
components. All are free to use commercially; the only obligation is to keep
these notices with distributions of the app. Full license texts are in the
`licenses/` folder beside this file.

| Component | Version | Use in this project | License | Copyright holder |
|---|---|---|---|---|
| Electron | 31.7.7 | Desktop app framework (window, IPC, packaging runtime) | MIT | Electron contributors / GitHub Inc. |
| Chromium (bundled in Electron) | — | Rendering engine inside Electron | BSD-style + many embedded licenses (see `LICENSES.chromium.html` shipped in every Electron build) | The Chromium Authors |
| Node.js (bundled in Electron) | — | JavaScript runtime inside Electron | MIT | Node.js contributors |
| better-sqlite3 | 12.11.1 | SQLite database driver (`app/db.js`) | MIT | Joshua Wise |
| SQLite engine (compiled by better-sqlite3) | — | Database file format and queries | Public domain | D. Richard Hipp & contributors |
| React + ReactDOM | 18.3.1 | UI rendering (`app/src/vendor/react*.js`) | MIT | Meta Platforms, Inc. and affiliates |
| Archivo font (variable, latin subset) | v2.000 | App typography (`app/src/vendor/fonts/`) | SIL Open Font License 1.1 | The Archivo Project Authors (Omnibus-Type) |
| electron-builder | 26.15.3 | Build tool that produces the packaged .exe (dev-time only, not shipped inside the app) | MIT | Loopline Systems |
| @electron/rebuild | 3.7.2 | Rebuilds native modules for Electron's ABI (dev-time only) | MIT | Contributors to the Electron project |
| NSIS | 3.0.4.1 | Generates the portable-exe wrapper (build-time only) | zlib/libpng license (NSIS license) | Nullsoft & contributors |

## Notes on specific components

- **Electron**: when distributing an Electron app you should also preserve
  Electron's own license files. Every packaged build contains them:
  `LICENSE.electron.txt` and `LICENSES.chromium.html` live inside
  `dist/win-unpacked/`.
- **Archivo (OFL 1.1)**: bundling/embedding/selling *with software* is
  explicitly permitted. Two restrictions: (1) the font file may not be sold
  *by itself*, and (2) modified versions of the font may not use the name
  "Archivo". Unmodified use as in this project has no further conditions.
- **SQLite**: public domain — no obligations at all.
- **Dev-only tools** (electron-builder, @electron/rebuild, NSIS): these run on
  the build machine and are not distributed inside your .exe, so no notice is
  strictly required in the app itself; listed here for completeness.

## What you must do when sharing or selling the app

Keep this folder (or its contents) with any distribution of the app — e.g.
include a copy of `THIRD-PARTY-NOTICES.md` and the `licenses/` texts in the
zip or alongside the installer. That single step satisfies the attribution
conditions of every MIT component and the OFL font.
