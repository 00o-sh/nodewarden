# Feature Overview

This page isn't just a checklist — it aims to make clear how far NodeWarden's current capabilities actually go in practice.

## 1. Web Vault

NodeWarden provides its own Web Vault interface; it's not just an API shell. You can perform common management operations directly in the browser, including viewing, editing, and organizing the contents of your vault.

For many self-hosted projects, the web frontend is often a "nice to have." But NodeWarden's web frontend is a first-class part of the project, and the frontend is maintained independently in the `webapp/` directory.

## 2. Compatibility with the Official Client Sync

The project explicitly supports the official Bitwarden clients' sync flow, particularly `/api/sync` compatibility. This means you don't have to re-learn your habits, nor settle for a feature-incomplete third-party client.

This compatibility is the foundation that makes NodeWarden genuinely usable in practice.

## 3. Attachment Upload and Download

Attachment support is one of NodeWarden's very practical capabilities.

You can choose based on how you deploy:

- R2 as the default attachment storage
- KV as an attachment fallback

If you only store a small number of text-based credentials, KV works fine. But if you're going to store items with attachments, R2 is the better first choice.

## 4. Send

NodeWarden supports Bitwarden's Send capability, including:

- Text Send
- File Send

This kind of feature is easy to underrate in day-to-day use, but once you're already in the Bitwarden ecosystem, Send often becomes a frequently used entry point for temporarily sharing passwords, notes, and small files.

## 5. Import and Export

This is a substantial part of the project.

Currently supported import sources include:

- Bitwarden JSON
- Bitwarden CSV
- Bitwarden vault plus attachments ZIP
- NodeWarden JSON
- The various browser and password manager formats listed in the web importer

Supported export methods include:

- Bitwarden JSON
- Bitwarden encrypted JSON
- ZIP export with attachments
- The NodeWarden JSON family
- Instance-level full manual export from the Backup Center

This means NodeWarden isn't just about "being able to store" data — it has taken both migrating in and migrating out seriously.

## 6. Cloud Backup Center

This is a feature well worth calling out on its own.

The project supports backing up an instance to:

- WebDAV
- E3

And it's not just manual backups — scheduled backups are supported too. For a password management service, this capability is no less important than sync itself.

## 7. TOTP and Steam TOTP

The project supports regular TOTP, and also supports `steam://`-related scenarios.

This means it isn't only chasing "the most basic compatibility"; it has extended into some typical usage details as well, so the real-world experience feels closer to "a vault server you can use for the long term."

## 8. Multiple Users and Invite-Code Registration

NodeWarden supports multiple users — it isn't a single-user experiment. Administrators can control new-user registration via invite codes, which keeps the multi-user capability while avoiding leaving an open public registration entry exposed indefinitely.

For family sharing, small-team collaboration, or use within a small circle, this model is already practical enough.

## 9. User-Level Login 2FA

The project's current support for login two-factor verification is "partial," centered on user-level TOTP.

If you have higher requirements for login security, we recommend treating this as a key item to verify during your actual deployment, rather than assuming by default that it is fully equivalent to the official enterprise solution.
