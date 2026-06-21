# Security Policy

NodeWarden is a Bitwarden-compatible server that stores end-to-end encrypted
vault data. We take security reports seriously and appreciate responsible
disclosure.

## Supported versions

Security fixes are applied to the latest release on the `main` branch. Older
tagged releases are not maintained — please upgrade to the latest version
before reporting.

| Version        | Supported          |
| -------------- | ------------------ |
| Latest release | :white_check_mark: |
| Older releases | :x:                |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's **[Private Vulnerability Reporting](https://github.com/00o-sh/nodewarden/security/advisories/new)**
("Report a vulnerability" under the repository's *Security* tab). This keeps
the details private until a fix is available and lets us coordinate a
disclosure with you.

When reporting, please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept where possible).
- Affected version/commit and any relevant configuration.

## What to expect

- **Acknowledgement** of your report within a few days.
- An initial assessment and, where confirmed, a coordinated fix and disclosure
  timeline.
- Credit for the report once a fix is released, unless you prefer to remain
  anonymous.

## Scope

Because vault contents are encrypted client-side, the highest-impact areas are
authentication, token handling, access control, attachment/send storage, and
the admin/backup surfaces. Reports that demonstrate bypass of these are
especially valuable.

Out of scope: findings against the public demo build's fixture data, missing
hardening that has no concrete exploit, and automated-scanner output without a
demonstrated impact.
