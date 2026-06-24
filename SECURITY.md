# Security Policy

NodeWarden is a Bitwarden-compatible server that stores end-to-end encrypted
vault data. We take security reports seriously and appreciate responsible
disclosure.

NodeWarden is independent from Bitwarden. Please do not report
NodeWarden-specific issues to the official Bitwarden team.

## Supported versions

Security fixes are applied to the latest release and the latest code on the
`main` branch. Older tagged releases are not maintained — please upgrade to the
latest version before reporting.

| Version        | Supported              |
| -------------- | ---------------------- |
| Latest release | :white_check_mark:     |
| `main` branch  | :white_check_mark:     |
| Older releases | :x:                    |
| Modified forks | Not directly supported |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, pull requests, or chat groups.**

Report privately through GitHub's **[Private Vulnerability Reporting](https://github.com/00o-sh/nodewarden/security/advisories/new)**
("Report a vulnerability" under the repository's *Security* tab). This keeps the
details private until a fix is available and lets us coordinate disclosure with
you.

## What to include

Please include as much detail as possible:

- A clear description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept where possible).
- Affected version, commit, or deployment method, and any relevant
  configuration.
- Affected area, such as login, sync, vault data, attachments, Send,
  import/export, backup/restore, Passkey, WebAuthn, or API routes.
- Security impact, such as authentication bypass, authorization bypass, replay,
  cross-user access, token misuse, data leakage, or secret exposure.

Please **redact real passwords, tokens, private keys, recovery keys, vault
data, and other secrets** before submitting.

## What to expect

- **Acknowledgement** of valid private reports within a few days (we aim for 72
  hours).
- An initial assessment and, where confirmed, a coordinated fix and disclosure
  timeline. Please do not publicly disclose details before a fix or mitigation
  is available.
- Credit for the report once a fix is released, unless you prefer to remain
  anonymous.

## Scope

Because vault contents are encrypted client-side, the highest-impact areas are
authentication, token handling, access control, attachment/send storage, and
the admin/backup surfaces. Reports are welcome for issues affecting NodeWarden
itself, including:

- Authentication and session handling.
- User authorization and cross-user access.
- Vault data, cipher sync, attachments, and Send.
- Import, export, backup, and restore.
- Passkey, WebAuthn, and two-factor authentication.
- Secret handling and provider credentials.
- Cloudflare Workers, D1, R2, KV, WebDAV, or S3 behavior caused by NodeWarden
  code or documentation.

## Out of scope

The following are usually out of scope:

- Findings against the public demo build's fixture data.
- Missing hardening with no concrete, demonstrated exploit.
- Automated-scanner output without a practical exploit path.
- Reports that only mention outdated dependencies without showing real impact.
- Issues only affecting third-party services or user infrastructure.
- Misconfigured personal deployments not caused by NodeWarden defaults.
- Social engineering, phishing, or denial-of-service testing.

## Rewards

NodeWarden does not currently operate a paid bug bounty program.
