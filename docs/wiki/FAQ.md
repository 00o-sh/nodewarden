# FAQ

## Deployment and Bindings

### Why does `JWT_SECRET` seem to "stop working" after a redeploy?

`JWT_SECRET` should be set as a secret, not as plain text!

### KV deployment reports that the binding ID doesn't exist, or the KV ID in the example doesn't match

The root cause of this error is usually not that the code is broken, but that the `kv_namespaces.id` in the example was treated as a real resource ID that can be reused directly.

A KV Namespace ID is a resource ID created under your own account; it won't be identical to the one in someone else's repository example. Issue #61 is exactly this problem: seeing a fixed ID in the config, the user manually created a KV namespace, found the ID was different, and mistakenly assumed something was wrong with the deployment process.

The fix is simple:

- Create your own KV Namespace
- Bind the config to that actual ID under your own account
- Don't copy the resource ID from the repository author's account in the example

This reflects the design choice of dropping database rows for attachments that fail to restore, rather than "keeping all attachment records and figuring it out when you click to open them."
