# Import and Export

## Supported Import Formats

According to the project's public documentation, the currently supported import sources include:

- Bitwarden JSON
- Bitwarden CSV
- Bitwarden vault + attachments ZIP
- NodeWarden JSON
- Other browser or password manager formats shown in the web importer

The most noteworthy of these is "Bitwarden vault + attachments ZIP." This is the capability many migrating users actually need, because in practice the most troublesome part is often not the password entries themselves, but those historical attachments.

## Supported Export Formats

The currently supported export methods include:

- Bitwarden JSON (can be encrypted)
- Bitwarden vault + attachments ZIP (can be encrypted)
- NodeWarden JSON (can be encrypted)
- Instance-level full manual export from the Backup Center

This means you can not only export your data, but also choose a format better suited to where it's headed next.

## Recommended Migration Order

If you're migrating from the official Bitwarden or another compatible service, we recommend the following order:

1. First export your existing vault
2. Import it into the new NodeWarden instance
3. Check the number of entries, the folders, the attachments, and the TOTP fields
4. Run a sync acceptance test with at least two clients
5. Then decide whether to switch over to it as your primary instance

Don't shut down the old instance before you've verified everything.

## What to Verify After Importing

We recommend checking at least:

- Whether the total number of entries matches
- Whether the folders are complete
- Whether favorite status is preserved
- Whether all attachments open
- Whether TOTP works
- Whether Sends exist as expected

If you have special entries that were imported a long time ago, we also recommend spot-checking a few of them, especially records with many custom fields.

## Export Is Not the Same as Backup

This is a point that's easy to overlook.

An export is more about "taking out a copy of your current data," whereas the Backup Center solves the problem of "continuous, scheduled, disaster-recovery-oriented" protection. It's best to use both together, rather than treating one as a substitute for the other.
