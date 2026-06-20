# NodeWarden Wiki

Welcome to the NodeWarden project Wiki.

If this is your first time coming across the project, you can sum it up in one sentence: it's a third-party server that runs on Cloudflare Workers and is compatible with the official Bitwarden clients. It doesn't rely on a traditional VPS, and you don't need to maintain a database process, an object storage service, or a long-running backend yourself — as long as the resources on the Cloudflare side are ready, you can get your own password vault service running.

## Recommended Reading Order

If you're planning to deploy it yourself, we suggest reading in the following order:

1. [Quick Start](Quick-Start)
2. [Feature Overview](Feature-Overview)
3. [Import and Export](Import-and-Export)
4. [Backup and Restore](Backup-and-Restore)
5. [FAQ](FAQ)

NodeWarden's positioning has always been clear: it isn't trying to fully replicate every enterprise capability of the official Bitwarden server. Instead, it focuses on a handful of goals — personally deployable, maintainable over the long term, as low-cost as possible, and compatible with the official clients — and does the most common, most practical subset of features well. Because of this trade-off, it's an especially good fit for the following kinds of users:

- People who want to self-host Bitwarden but don't want to maintain a separate server
- People already using Cloudflare who want to move their vault onto the same infrastructure
- People who need multi-user capability but don't need advanced enterprise features like organizations, SSO, or enterprise directories
- People who care about backups, import/export, and attachment migration, and want to keep their data in their own hands

## What the Project Can Do

NodeWarden already covers most of the core scenarios that ordinary users actually rely on:

- Supports common vault item types such as logins, secure notes, cards, and identities
- Compatible with the official Bitwarden client sync interface, including `/api/sync`
- Supports attachment upload and download, using either Cloudflare R2 or KV
- Supports Send, including text Send and file Send
- Supports import and export, covering common formats such as Bitwarden JSON, CSV, and attachment ZIPs
- Supports a web-based vault management interface
- Supports TOTP, with additional support for scenarios like `steam://`
- Supports multiple users and invite-code registration
- Supports a cloud backup center, with scheduled backups to WebDAV or E3

If you're coming from the official Bitwarden server or from Vaultwarden, the most important thing to know up front is this: NodeWarden's goal is not to be an enterprise replacement, but to be lightweight, good-enough, compatible, and self-manageable.

## What the Project Does Not Do

To keep the system simple, NodeWarden currently does not cover the following capabilities:

- Organizations / collections / member permissions
- SSO / SCIM / enterprise directories
- A full login 2FA system — currently this centers on user-level TOTP
- An enterprise admin console, subscriptions, or billing

This isn't simply a matter of "missing features." More accurately, it's a deliberate boundary the project has set. For the vast majority of individual self-hosting users, this boundary actually means lower complexity and lower maintenance cost.

## Architecture at a Glance

NodeWarden's core architecture is very straightforward and not hard to understand:

- Runtime: Cloudflare Workers
- Database: Cloudflare D1
- Attachment storage: Cloudflare R2, falling back to KV
- Frontend: Preact + Vite
- Scheduled tasks: Cloudflare Cron Triggers
- Real-time notification capabilities: Durable Objects

Looking at the repository structure, the project can roughly be divided into four parts:

- `src/`: the Workers backend logic — routing, the service layer, backups, authentication, and other core implementations
- `webapp/`: the web frontend
- `migrations/`: D1 initialization SQL
- `shared/`: shared definitions used by both frontend and backend, such as the version number and backup config structures
