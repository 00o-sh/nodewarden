# Backup and Restore

## What Gets Backed Up

Two things need to be made clear:

1. A backup backs up the database contents directly.
2. The vault entries themselves are already in client-encrypted form within the database.

So there's no additional "second layer of backup-package encryption" feature. What the code actually does is write the database rows directly into `db.json` and then package that into a ZIP.

## Backup Package Structure

A backup ZIP contains at least two files:

- `manifest.json`
- `db.json`

During restore, both files are checked for existence first; if either is missing, it errors out immediately.

`manifest.json` records the backup metadata, including:

- Format version
- Export time
- Application version
- The current attachment storage type
- The record count for each table
- Whether attachments are included
- The attachment file count, total size, and largest object size

`db.json` records the actual database row data, including:

- `config`
- `users`
- `user_revisions`
- `folders`
- `ciphers`
- `attachments`

## What Happens When You Check "Include Attachments"

When you check "Include attachments," the backup processes two parts at the same time:

- The attachment records in `db.json`
- The actual attachment files

`manifest.json` records the attachment manifest, containing:

- `cipherId`
- `attachmentId`
- `blobName`
- `sizeBytes`

If attachments are included, they are not stuffed into the database JSON; instead, they participate in backup and restore as separate files. The code requires every attachment record to map to a file path like `attachments/<cipherId>/<attachmentId>.bin`. When one is missing, the restore either errors out or follows the skip logic.

In remote backup mode, attachments are stored separately under `attachments/` in the remote directory; during restore, files are retrieved by `attachments/<blobName>`.

## Backup Filename Verification

The backup ZIP's filename carries a hash prefix computed from the file contents. During export, the ZIP is packaged first, then a SHA-256 prefix is computed and written into the filename.

During a remote restore, this prefix is first verified against the file contents; skipping verification is not allowed by default. If verification fails, the restore returns an error directly.

## Data Restore

After you click a remote restore, the actual flow is roughly as follows:

1. Read the remote ZIP backup file.
2. Verify that the hash prefix in the filename matches the file contents.
3. Parse `manifest.json` and `db.json`.
4. Check whether the target instance is empty; if it is not empty, decide whether to continue or error out based on `replaceExisting`.
5. Create shadow tables.
6. Import the database data from the backup into the shadow tables first.
7. Verify the record counts in the shadow tables.
8. Restore attachment files as needed.
9. For attachments that fail to restore, delete the corresponding attachment rows to avoid leaving dirty records.
10. Swap the shadow tables in as the live tables.
11. If this is an overwrite restore, clean up old attachment objects in the current instance that have lost their references.

## The Actual Result After Clicking "Restore"

After you click "Restore," the result is not "merge existing data with backup data," but rather this behavior:

- The database contents follow the selected backup
- If overwrite restore is enabled, the existing instance data is replaced
- Attachments are restored one by one after the database is imported
- Attachments that fail to restore do not keep their corresponding database rows

So the final state should be understood as:

- Successfully restored data enters the instance in full
- Attachments that fail to restore are skipped
- The database does not retain dirty references pointing to missing attachments

## What Happens When Attachment Restore Fails

During a remote restore, the system first restores the attachment records in the database, then attempts to restore the actual attachment files. For attachments that don't restore successfully, the system removes those attachment rows from the database.

The restore result also returns:

- The number of attachments successfully imported
- The number of attachment files successfully restored
- The number of attachments skipped
- The reasons for skipping
