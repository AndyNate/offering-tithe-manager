# Security Policy

## Supported versions

Only the latest tagged release is actively supported with security fixes.

| Version | Supported |
| --- | --- |
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a vulnerability

Please report vulnerabilities **privately** — do not open a public issue.

1. Use GitHub **Private vulnerability reporting**: this repository's **Security** tab → **Report a vulnerability**.
2. Preferring email? Contact `<security@example.com>` (replace with a real address before publishing this repo publicly).

Please include:

- Which component is affected (main process, renderer, database layer, build scripts) and the version
- Steps to reproduce, or a minimal proof of concept
- Affected platforms (Windows / macOS / Linux)

We will acknowledge reports within 48 hours and work on a fix for the next release.

## If a real secret is leaked (e.g. a Brevo API key or the admin password)

- **Rotate the credential first** — regenerate the API key / change the password. Every push and pull request in this repository is scanned for hardcoded secrets (gitleaks) and the check fails on any finding, but a secret visible in git history should still be treated as compromised and rotated immediately.
- If the secret has not been pushed, remove it from the working tree and rewrite the commit before pushing.
- If the secret is already on GitHub, report it via the channels above; we will help rotate and clean up history.

## Built-in scanning

The following automated checks run on every pull request and push to `main` (see `.github/workflows/security.yml`):

- **Secrets (gitleaks)** — hardcoded credentials and tokens (blocks the PR)
- **Code scan (Semgrep)** — suspicious and vulnerable code patterns (blocks the PR)
- **Dependency audit (npm)** — known-vulnerable production dependencies (blocks the PR)
- **CodeQL** — GitHub's static analysis, reported in the Security tab (report-only)