# NodeWarden Passkey Login Research Notes

> English translation of [`passkey-login-research.md`](./passkey-login-research.md). The Chinese original is the source of truth; this file is kept as a sibling so upstream syncs of the original stay conflict-free.

Record date: 2026-06-09
Research scope: NodeWarden's own server and web login/registration flow, plus how the official Bitwarden server, web, and browser extension implement account passkey login.

## Conclusion First

NodeWarden already has complete master-password registration, master-password login, token refresh, 2FA, device records, and the official-client-compatible `UserDecryptionOptions`, and it supports the `login.fido2Credentials` field inside vault items. But it does not yet have "account passkey login." The existing `src/utils/passkey.ts` only has utility functions like base64url, challenge, and clientData parsing — it cannot perform FIDO2/WebAuthn server-side registration and authentication verification.

Supporting both "passkey login on our own web" and "passkey login from the official/custom browser extension" can't be done by just adding a login button. Four pieces must be completed:

1. Server-side: add an account WebAuthn credential table, a challenge/token anti-replay mechanism, FIDO2 attestation/assertion verification, and `grant_type=webauthn`.
2. Have the server return PRF decryption material in the Bitwarden shape: the login token response uses a single `UserDecryptionOptions.WebAuthnPrfOption`, and the sync response uses multiple `UserDecryption.WebAuthnPrfOptions`.
3. NodeWarden web: add the client-side flows for passkey registration, management, login, and PRF-based unlocking of the vault key.
4. Extension compatibility must align with the official Bitwarden endpoints and response shapes. The official browser extension currently only enables passkey login in Chromium-based browsers, because the Firefox/Safari extension environments can't yet override the RP ID in the way the official code requires.

The rest follows the code paths.

## Terminology Boundaries

There are three things here that are easily confused; the rest of this document distinguishes them strictly:

- Account passkey login: the user authenticates the account with WebAuthn/passkey instead of a master password, and uses PRF to unlock the vault user key. Official Bitwarden calls this `WebAuthnLogin`.
- Passkey inside a vault item: a login entry stores a website's passkey/FIDO2 credential data, corresponding to NodeWarden's `cipher.login.fido2Credentials`. This is "the vault storing another website's passkey," not "logging in to the NodeWarden account."
- WebAuthn 2FA: a security key used as a second factor after master-password login. The old official web repo is mainly this kind, which is not the same as passkey login.

## NodeWarden Current State

### Routes and Entry Points

The NodeWarden backend is Cloudflare Workers + D1. The main entry `src/index.ts` initializes storage and then enters the router. The authentication boundaries are:

- `src/router-public.ts`: public endpoints, including `/identity/connect/token`, `/identity/accounts/prelogin`, `/api/accounts/register`.
- `src/router-authenticated.ts`: endpoints requiring an access token, including profile, change password, TOTP, sync, vault, devices.
- `src/handlers/identity.ts`: the OAuth/token compatibility entry point.
- `src/handlers/accounts.ts`: account endpoints such as registration, profile, password change, TOTP, API key.

The public routes currently lack:

- `GET /identity/accounts/webauthn/assertion-options`
- `grant_type=webauthn` on `POST /identity/connect/token`
- `POST /api/webauthn/attestation-options`
- `POST /api/webauthn/assertion-options`
- `GET/POST/PUT /api/webauthn`

### Registration Flow

NodeWarden's own web registration entry is `registerAccount()` in `webapp/src/lib/api/auth.ts`:

- Uses the email as salt and derives the master key with PBKDF2.
- Then uses PBKDF2(masterKey, password, 1) to get the client master password hash.
- Randomly generates a 64-byte vault symmetric key.
- Uses HKDF on the masterKey to split it into enc/mac, and encrypts the vault key into a Bitwarden `Key`.
- Generates an RSA-OAEP key pair and encrypts the private key with the vault symmetric key.
- POSTs to `/api/accounts/register`, submitting `email`, `name`, `masterPasswordHash`, `key`, KDF parameters, invite code, `keys.publicKey`, `keys.encryptedPrivateKey`.

The backend `handleRegister()` in `src/handlers/accounts.ts`:

- The first user automatically becomes admin; later users require an invite.
- Validates `JWT_SECRET`, the email, the KDF lower bounds, the encrypted-string shapes, and the public/private keys.
- Does not store the client hash directly; instead it stores `AuthService.hashPasswordServer(masterPasswordHash, email)` into `users.master_password_hash`.
- Stores `users.key`, `users.private_key`, `users.public_key`, the KDF parameters, and `security_stamp`.

Conclusion: account passkey registration is not a replacement for account registration; it is "the user, after logging in, adds a loggable credential in security settings." It still requires an existing vault user key to generate the PRF keyset.

### Master-Password Login Flow

NodeWarden's own web login entry is `performPasswordLogin()` in `webapp/src/lib/app-auth.ts`:

- First `deriveLoginHashLocally()` derives the masterKey and client hash.
- Calls `loginWithPassword()` to POST `/identity/connect/token`.
- After the token succeeds, `completeLogin()` uses `token.Key` and the local masterKey to unlock the vault key.
- Saves the offline-unlock record.

`webapp/src/lib/api/auth.ts` also has `deriveLoginHash()` and `getPreloginKdfConfig()` which call `/identity/accounts/prelogin`, but the current `performPasswordLogin()` uses local fallback iterations. Passkey login should not reuse this masterKey path, because passkey login has no master password and cannot obtain a password-derived masterKey.

The backend `handleToken()` in `src/handlers/identity.ts` currently supports:

- `grant_type=password`
- `grant_type=client_credentials`
- `grant_type=refresh_token`

After a successful password login it:

- Verifies the IP login rate and user status.
- `AuthService.verifyPassword()` verifies the client hash.
- Handles TOTP or a remembered 2FA token.
- Records/updates the device.
- Generates the access token and refresh token.
- Returns `Key`, `PrivateKey`, `AccountKeys`, the KDF parameters, and `UserDecryptionOptions`.

### UserDecryptionOptions and Sync

NodeWarden's `src/utils/user-decryption.ts` currently only constructs master-password unlock:

- `HasMasterPassword: true`
- `MasterPasswordUnlock`
- `TrustedDeviceOption: null`
- `KeyConnectorOption: null`

The sync types in `src/types/index.ts` reserve `UserDecryption.WebAuthnPrfOption?: null`, but the current `src/handlers/sync.ts` actually only returns `MasterPasswordUnlock`, with no account passkey PRF decryption option.

Passkey login must add two shapes:

- Login token response: `UserDecryptionOptions.WebAuthnPrfOption`, returning only the PRF decryption material for the credential used in this authentication.
- Sync response: `UserDecryption.WebAuthnPrfOptions`, returning the passkey decryption material for all of the user's PRF-enabled keysets, for the official client's lock/unlock and key rotation.

### Existing Passkey-Related Code

NodeWarden already supports the FIDO2/passkey fields inside vault items:

- `src/types/index.ts`: `CipherLogin.fido2Credentials`
- `src/handlers/ciphers.ts`: preserves/normalizes `fido2Credentials` when reading/writing ciphers
- `webapp/src/lib/api/vault.ts`: encrypts/decrypts the `fido2Credentials` inside a vault item
- `webapp/src/lib/types.ts`: `CipherLoginPasskey`

This part is "storing a website passkey," not account login.

`src/utils/passkey.ts` only has:

- `bytesToBase64Url()`
- `base64UrlToBytes()`
- `randomChallenge()`
- `parseClientDataJSON()`

The core capabilities that are missing:

- attestation verification
- assertion verification
- authenticator public key format handling
- signature verification
- sign counter updates
- userHandle-to-user-id binding verification
- origin/RP ID verification
- challenge expiry and anti-replay

### Database and Backup Impact

The NodeWarden schema needs to be kept in sync in these places:

- `migrations/0001_init.sql`
- `src/services/storage-schema.ts`
- `wrangler.toml` migrations
- `src/services/backup-archive.ts`
- `src/services/backup-import.ts`
- `shared/backup-schema` related types

The current tables have no account passkey credential, and no WebAuthn challenge table. The `devices` table stores device trust/key info and is not suitable for mixing in passkey credentials, because a WebAuthn credential needs its own fields: public key, credential id, counter, AAGUID, PRF keyset, etc.

## Official Bitwarden Server Reference

Upstream code location:

- `.codex-upstream/bitwarden-server`
- HEAD at research time: `574f3fd`

The official server also has two WebAuthn concepts:

- Traditional WebAuthn 2FA: `TwoFactorController`, `WebAuthnTokenProvider`
- Account passkey login: `WebAuthnLogin`

This project should reference the latter.

### Public Passkey Login Entry

`src/Identity/Controllers/AccountsController.cs`

- `GET /accounts/webauthn/assertion-options`
- Returns `WebAuthnLoginAssertionOptionsResponseModel`
- The response contains:
  - `options`
  - `token`
- The token uses `WebAuthnLoginAssertionOptionsTokenable`
- The scope is `Authentication`
- The token lifetime is about 17 minutes

`src/Identity/IdentityServer/RequestValidators/WebAuthnGrantValidator.cs`

- Adds an OAuth extension grant: `grant_type=webauthn`
- Reads from the form:
  - `token`
  - `deviceResponse`
- Unwraps the token, verifying the scope must be `Authentication`
- Deserializes `AuthenticatorAssertionRawResponse`
- Calls `AssertWebAuthnLoginCredential`
- Passes the successfully authenticated credential to `UserDecryptionOptionsBuilder.WithWebAuthnLoginCredential(credential)`
- Then follows the common login-success logic, returning access/refresh tokens and the account encryption state.

`src/Identity/IdentityServer/ApiClient.cs`

- The official identity client's allowed grant types include `WebAuthnGrantValidator.GrantType`.

There's an important behavior in `TwoFactorAuthenticationValidator`: FIDO2 user verification is already treated as a second factor, so after a successful passkey login the official side won't require additional 2FA. NodeWarden later needs an explicit policy: to be compatible with the official clients, it should treat passkey login as having already satisfied 2FA, otherwise the official `LoginViaWebAuthnComponent` will show a "passkey 2FA not supported" error.

### Account Passkey Management Endpoints

`src/Api/Auth/Controllers/WebAuthnController.cs`

The official authenticated API:

- `GET /webauthn`: list the account's passkey credentials.
- `POST /webauthn/attestation-options`: after master-password/secret verification, generate credential create options and a token.
- `POST /webauthn/assertion-options`: after master-password/secret verification, generate assertion options and a token, used to enable/update the PRF keyset for an existing credential.
- `POST /webauthn`: save a new credential.
- `PUT /webauthn`: update a credential's PRF encryption keyset.
- `POST /webauthn/{id}/delete`: delete a credential.

When the official side creates a credential it stores:

- `name`
- `token`
- `deviceResponse`
- `supportsPrf`
- optional `encryptedUserKey`
- optional `encryptedPublicKey`
- optional `encryptedPrivateKey`

The official side allows at most 5 account passkey credentials.

### Official WebAuthnCredential Table

`src/Core/Auth/Entities/WebAuthnCredential.cs`

Fields:

- `Id`
- `UserId`
- `Name`
- `PublicKey`
- `CredentialId`
- `Counter`
- `Type`
- `AaGuid`
- `EncryptedUserKey`
- `EncryptedPrivateKey`
- `EncryptedPublicKey`
- `SupportsPrf`
- `CreationDate`
- `RevisionDate`

SQLite migration: `util/SqliteMigrations/Migrations/20231213032045_WebAuthnLoginCredentials.cs`

The table name is `WebAuthnCredential`, it does a cascade delete on `User`, and it is indexed by `UserId`.

`GetPrfStatus()`:

- `Unsupported`: `SupportsPrf` is false.
- `Supported`: the credential supports PRF but does not yet have a complete encrypted keyset.
- `Enabled`: `EncryptedUserKey`, `EncryptedPrivateKey`, `EncryptedPublicKey` all exist.

### Official Creation and Authentication Strategy

`GetWebAuthnLoginCredentialCreateOptionsCommand.cs`

- Uses Fido2NetLib.
- `user.id` is the user id bytes.
- `user.name/displayName` uses the user's email.
- Excludes the current user's existing credential ids.
- `residentKey: required`
- `userVerification: required`
- `attestation: none`

`GetWebAuthnLoginCredentialAssertionOptionsCommand.cs`

- Passes an empty array for `allowCredentials`.
- `userVerification: required`
- An empty allow list means using discoverable credentials, i.e. the passkey login page can avoid asking for the email first.

`CreateWebAuthnLoginCredentialCommand.cs`

- Limits each user to at most 5.
- Checks that the credential id cannot be duplicated under that user.
- FIDO `MakeNewCredentialAsync` verifies the attestation.
- Stores the credential id/public key/counter/type/AAGUID/PRF keyset.

`AssertWebAuthnLoginCredentialCommand.cs`

- First uses the challenge cache for anti-replay.
- Parses the user id from the assertion response's `userHandle`.
- Loads all of that user's WebAuthn credentials.
- Finds the record by credential id.
- FIDO `MakeAssertionAsync` verifies the signature, challenge, origin, RP ID, user verification.
- Updates the counter on success.

### Official PRF Decryption Protocol

`src/Core/Auth/Models/Api/Response/UserDecryptionOptions.cs`

`WebAuthnPrfDecryptionOption` fields:

- `EncryptedPrivateKey`
- `EncryptedUserKey`
- `CredentialId`
- `Transports`

`src/Identity/IdentityServer/UserDecryptionOptionsBuilder.cs`

- `WithWebAuthnLoginCredential()` only adds `WebAuthnPrfOption` when the credential's PRF status is `Enabled`.
- If the credential has no PRF keyset, the passkey can only authenticate the account, not unlock the vault.

`src/Api/Vault/Models/Response/SyncResponseModel.cs`

- The sync response puts all enabled PRF credentials into `UserDecryption.WebAuthnPrfOptions`.

## Official Bitwarden web/browser Client Reference

Upstream code location:

- `.codex-upstream/bitwarden-clients`
- `.codex-upstream/bitwarden-browser`
- Both were at HEAD `825f9be` at research time; the browser repo content corresponds to the clients monorepo.

The old `.codex-upstream/bitwarden-web` mainly has the WebAuthn connector and the 2FA settings page, without the modern account passkey login main flow. Account passkey login should follow `bitwarden-clients`.

### Login Button Visibility

`libs/auth/src/angular/login/default-login-component.service.ts`

- By default, passkey login is only enabled for `ClientType.Web`.

`apps/browser/src/auth/popup/login/extension-login-component.service.ts`

- The browser extension override logic: only enabled for Chromium.
- A comment explains that Firefox and Safari cannot override the relying party ID inside the extension.
- The official code references W3C webextensions issue 238, Mozilla bug 1956484, and Apple forum thread 774351.

Conclusion: even if the NodeWarden backend is fully compatible with the official passkey API, the official extension will only show the passkey login entry on Chromium-based browsers.

### Passkey Login Page

`libs/angular/src/auth/login-via-webauthn/login-via-webauthn.component.ts`

Flow:

1. After entering `/login-with-passkey`, authentication starts automatically.
2. Calls `webAuthnLoginService.getCredentialAssertionOptions()`.
3. Calls `webAuthnLoginService.assertCredential(options)`, which triggers `navigator.credentials.get()`.
4. Calls `webAuthnLoginService.logIn(assertion)`, going through the identity token grant.
5. If `authResult.requiresTwoFactor` is true, it shows a "client does not support passkey 2FA" error.
6. The login success handler only runs once the local `keyService.userKey$(authResult.userId)` has obtained the user key.
7. Success routes:
   - Web: `/vault`
   - Browser: `/tabs/vault`
   - Desktop: `/vault`

Under a browser popout, after success it also reopens the normal popup and closes the popout.

### Client Passkey Login Request

`libs/common/src/auth/services/webauthn-login/webauthn-login-api.service.ts`

- GET `${identityUrl}/accounts/webauthn/assertion-options`
- If NodeWarden's identityUrl is the site origin + `/identity`, the actual path is `/identity/accounts/webauthn/assertion-options`.

`libs/common/src/auth/services/webauthn-login/webauthn-login.service.ts`

- `navigator.credentials.get({ publicKey: options })`
- Proactively adds the PRF extension:
  - the salt is `SHA-256("passwordless-login")`
  - the extension shape is `extensions.prf.eval.first`
- Reads the PRF output from `credential.getClientExtensionResults().prf.results.first`.
- Uses `WebAuthnLoginPrfKeyService.createSymmetricKeyFromPrf()` to turn it into a PRF key.
- Constructs `WebAuthnLoginAssertionResponseRequest`.
- Explicitly checks that `deviceResponse.extensions` must not contain `prf`, to avoid leaking the PRF output to the server.

`libs/common/src/auth/services/webauthn-login/webauthn-login-prf-key.service.ts`

- Salt constant: `passwordless-login`
- First SHA-256.
- Then HKDF expand into 64 bytes:
  - `"enc"` 32 bytes
  - `"mac"` 32 bytes

`libs/common/src/auth/models/request/identity-token/webauthn-login-token.request.ts`

Form-encoded token request fields:

- `grant_type=webauthn`
- `token=<server assertion options token>`
- `deviceResponse=<JSON string>`
- Also carries the common device request fields.

`libs/common/src/auth/services/webauthn-login/request/webauthn-login-assertion-response.request.ts`

`deviceResponse` shape:

- `id`
- `rawId`
- `type`
- `extensions: {}`
- `response.authenticatorData`
- `response.signature`
- `response.clientDataJSON`
- `response.userHandle`

All binary fields use base64url.

### How the Client Uses PRF to Unlock the Vault Key

`libs/auth/src/common/login-strategies/webauthn-login.strategy.ts`

- `setMasterKey()` is an empty implementation, because passkey login has no master-password masterKey.
- `setUserKey()`:
  - If the token response has `key`, store it as the master-key-encrypted user key, compatible with master-password unlock.
  - If `userDecryptionOptions.webAuthnPrfOption` exists and the local assertion produced a `prfKey`:
    1. Use the PRF key to unwrap `encryptedPrivateKey`.
    2. Use the private key to decapsulate `encryptedUserKey`.
    3. Obtain the user key and write it into `keyService`.

Core constraint: the server can never see the PRF output. The server only stores and returns the keyset encrypted by PRF-related keys.

### Registering a Passkey on the Official Web Settings Page

`apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin-api.service.ts`

The APIs it calls:

- `POST /webauthn/attestation-options`
- `POST /webauthn/assertion-options`
- `POST /webauthn`
- `GET /webauthn`
- `POST /webauthn/{id}/delete`
- `PUT /webauthn`

`apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin.service.ts`

Creation flow:

1. The user does secret verification.
2. Request attestation options.
3. `navigator.credentials.create({ publicKey: options })`, with `extensions.prf = {}`.
4. Determine `supportsPrf` from the client extension results.
5. If it is to be used for vault encryption, immediately do another `navigator.credentials.get()`:
   - `allowCredentials` locks onto the just-created credential.
   - Use the same challenge, rpId, timeout, userVerification.
   - Carry the PRF eval salt.
6. Use the PRF key and the current user key to create a rotateable keyset.
7. Save the credential, carrying `encryptedUserKey`, `encryptedPublicKey`, `encryptedPrivateKey`.

The deletion flow requires secret verification. The enable-encryption flow does an assertion on the existing credential, then creates and PUTs the keyset.

`apps/web/src/app/auth/core/enums/webauthn-login-credential-prf-status.enum.ts`

- `Enabled = 0`
- `Supported = 1`
- `Unsupported = 2`

## Protocol Shapes NodeWarden Should Implement

### Public Login Flow

Goal: compatible with the official clients and with NodeWarden's own web:

1. `GET /identity/accounts/webauthn/assertion-options`
   - Generate discoverable credential assertion options.
   - `allowCredentials: []`
   - `userVerification: "required"`
   - Return `{ options, token }`.
   - The token binds the challenge, scope=`Authentication`, RP ID, origin/audience, and expiry time.

2. Browser/web calls `navigator.credentials.get()`.
   - NodeWarden's own web must also use the PRF extension.
   - The PRF salt must match the official one: `SHA-256("passwordless-login")`.

3. `POST /identity/connect/token`
   - Support `grant_type=webauthn`.
   - Receive `token`, `deviceResponse`, device fields.
   - Decode the token, verify challenge/scope/expiry.
   - Verify the assertion.
   - Find the user id from `userHandle`.
   - Find the passkey record from the credential id.
   - Update the counter.
   - Record/update the device.
   - Return the access/refresh token, `AccountKeys`, `UserDecryptionOptions.WebAuthnPrfOption`.

If the user has TOTP enabled, for official compatibility it is recommended to follow Bitwarden first: treat the passkey's user verification as having satisfied the second factor. Otherwise the official passkey login page will enter the unsupported-2FA error state.

### Account Passkey Management Flow

It's recommended to align with the official API, while internally in NodeWarden it can be mounted under `/api/webauthn`:

- `GET /api/webauthn`
- `POST /api/webauthn/attestation-options`
- `POST /api/webauthn/assertion-options`
- `POST /api/webauthn`
- `PUT /api/webauthn`
- `POST /api/webauthn/:id/delete`

For official client compatibility, it may also be necessary to accept aliases without the `/api` prefix:

- `/webauthn`
- `/webauthn/attestation-options`
- `/webauthn/assertion-options`
- `/webauthn/:id/delete`

NodeWarden's own web can use `/api/webauthn` directly; the official web/browser clients will assemble `/webauthn` based on their own API base.

### Suggested New Table

Following NodeWarden's naming style, lowercase snake_case is recommended:

```sql
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  type TEXT,
  aa_guid TEXT,
  transports TEXT,
  encrypted_user_key TEXT,
  encrypted_public_key TEXT,
  encrypted_private_key TEXT,
  supports_prf INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentials_user_credential
  ON webauthn_credentials(user_id, credential_id);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
  ON webauthn_credentials(user_id);
```

If you want to more strictly prevent the same credential id from being registered across different users, you can also add a global unique index on `credential_id`. The official code at least checks uniqueness per user; for actual security, a global unique is more advisable, because the credential id itself should uniquely identify an authenticator credential.

The PRF status need not be stored as an enum; it can be computed from fields:

- `supports_prf = 0` => `Unsupported`
- `supports_prf = 1` and the three encrypted keys are not all present => `Supported`
- `supports_prf = 1` and all three encrypted keys exist => `Enabled`

### Challenge/Token Storage

The official server carries the options in a protected token, then uses a challenge cache for anti-replay. In Workers/D1, NodeWarden is recommended to combine:

- token: HMAC/JWT style, binding `scope`, `challenge`, `userId?`, `rpId`, `createdAt`, `expiresAt`.
- A D1 table or KV: record whether a challenge has been used, with at least the fields `challenge_hash`, `scope`, `user_id`, `expires_at`, `used_at`.
- The login assertion options are a public endpoint, not bound to a user id; the create/update/delete management flows should bind a user id.
- Mark as used immediately after successful verification.

Suggested scopes:

- `Authentication`
- `CreateCredential`
- `UpdateKeySet`

The official side also has `PrfRegistration` semantics; NodeWarden can cover this with `CreateCredential`, as long as the token logic is rigorous.

### Server-Side WebAuthn Verification Library

NodeWarden currently has no FIDO2/WebAuthn server-side verification dependency. Do not hand-write signature and attestation parsing.

Candidate: `@simplewebauthn/server`. The official docs currently state it provides `generateRegistrationOptions`, `verifyRegistrationResponse`, `generateAuthenticationOptions`, `verifyAuthenticationResponse`, and document the data structures for RP ID, origin, credential public key, counter, transports, etc. Docs: https://simplewebauthn.dev/docs/packages/server

Note: NodeWarden runs on Cloudflare Workers, not an ordinary Node server. Before formally choosing a library, a build/runtime check is needed to confirm the package doesn't depend on Node APIs that Workers don't support. This verification belongs to the implementation phase and is not written as a test program in this research document.

## What NodeWarden Web Needs to Change

### Login Page

The current login UI is in `webapp/src/components/AuthViews.tsx`; its state and behavior are mainly managed by `webapp/src/App.tsx`, `webapp/src/lib/app-auth.ts`.

Add:

- A "log in with passkey" button on the login page.
- A new `performPasskeyLogin()`:
  1. GET `/identity/accounts/webauthn/assertion-options`
  2. Convert the base64url challenge/user id/credential id in the server options to ArrayBuffer.
  3. `navigator.credentials.get()`, with the PRF salt.
  4. POST `/identity/connect/token`, `grant_type=webauthn`.
  5. Take the encrypted keyset from the response's `UserDecryptionOptions.WebAuthnPrfOption`.
  6. Use the local PRF key to derive the user key.
  7. Construct `SessionState` and enter the app.

You can't reuse `completeLogin(token, email, masterKey, fallbackKdfIterations)`, because it requires masterKey. A dedicated passkey complete function should be added.

### Settings Page

The current account/security-related UI is around `webapp/src/components/SettingsPage.tsx`.

Add:

- A passkey list.
- A new-passkey dialog.
- Delete passkey.
- For passkeys that support PRF but haven't enabled encryption, provide an "enable for login unlock" action.

The own-web creation flow must match the official one:

1. While logged in, first verify the master password or the existing session secret.
2. Request attestation options.
3. `navigator.credentials.create()` with `extensions.prf = {}`.
4. If the user wants this passkey to directly unlock the vault, do another `navigator.credentials.get()` on the just-created credential to obtain the PRF output.
5. Use the PRF key to encrypt/wrap the current user key and send it to the server to store.

### Client-Side Crypto Capabilities

NodeWarden web already has:

- PBKDF2
- HKDF expand
- Bitwarden EncString encryption/decryption
- RSA-OAEP private key encryption

But the passkey PRF keyset must align with the official strategy:

- The PRF key is a 64-byte symmetric key, the first 32 enc, the last 32 mac.
- `encryptedPrivateKey` uses the PRF key to wrap a decapsulation private key.
- `encryptedUserKey` uses the corresponding public key to encapsulate the user key.
- `encryptedPublicKey` is used for key rotation.

This requires carefully reusing or completing NodeWarden's existing crypto helpers, to avoid producing a keyset that the official client cannot mutually decrypt.

## Extension Compatibility Requirements

### Official Browser Extension

The official extension passkey login entry is at:

- `apps/browser/src/auth/popup/login/extension-login-component.service.ts`
- Only enabled on Chromium.

For the official/derived extension to passkey-login against NodeWarden:

- The identity URL must be able to access `/accounts/webauthn/assertion-options`.
- The token URL must support `grant_type=webauthn`.
- The API URL must be able to access the `/webauthn` management endpoints.
- The response casing and field names must accommodate both PascalCase/camelCase. NodeWarden's current token response already double-writes some fields; this style should continue.
- On a successful passkey login it must return a `webAuthnPrfOption` that can unlock the vault, otherwise the official component, though authentication succeeds, won't enter a usable vault.

### RP ID and origin

Own web:

- The RP ID is usually the site host, e.g. `vault.example.com`.
- The origin is `https://vault.example.com`.

Official browser extension:

- The extension page origin is `chrome-extension://...`.
- The official side only enables Chromium because the Chromium extension has the RP ID override capability it needs.
- When the NodeWarden server verifies the assertion, it must allow the correct origin/RP ID combination. It can't simply accept only the current request origin, otherwise extension login will fail.

Recommended to make configurable:

- `WEBAUTHN_RP_ID`
- `WEBAUTHN_RP_NAME`
- `WEBAUTHN_ALLOWED_ORIGINS`

By default the web origin can be derived from the request URL, but in production explicit configuration is recommended.

## Security Constraints

- All account passkeys must be `userVerification: required`.
- Login assertions use discoverable credentials; `userHandle` must resolve to a user id and be consistent with the credential record.
- Challenges must have an expiry time and a one-time-use marker.
- The PRF output must never be passed to the server, nor written to logs.
- The token must bind a scope, to prevent an attestation token from being used for authentication.
- The counter must be updated. On a counter anomaly, at least record an audit event; whether to block should be decided alongside the realities of multi-device passkeys.
- A per-user credential count limit is recommended to follow the official 5.
- Delete/add/enable-encryption must require a second verification from the logged-in user.
- After a password change or user key rotation, the keysets of all enabled PRF credentials must also be rotated, otherwise passkey login won't be able to unlock the new vault key.
- Backup export/import must include the account passkey table, otherwise after restore all passkey logins will fail.
- Recommended new audit logs:
  - `auth.passkey.login.success`
  - `auth.passkey.login.failed`
  - `account.passkey.create`
  - `account.passkey.delete`
  - `account.passkey.encryption.enable`
  - `account.passkey.rotate`

## Suggested Implementation Order

### Phase 1: Backend Foundation

1. Add the `webauthn_credentials` and challenge tables.
2. Add the storage repo.
3. Integrate the WebAuthn server-side verification library.
4. Implement assertion options and `grant_type=webauthn`.
5. Add the `WebAuthnPrfOption` shape to the token response.

This phase first lets an "already manually-inserted enabled credential" complete login verification, but no UI yet.

### Phase 2: Account Passkey Management API

1. Implement `/api/webauthn` and the `/webauthn` aliases.
2. Implement attestation options, save credential, list, delete, enable/update encryption.
3. Add audit events.
4. Integrate backup export/import.
5. Add `WebAuthnPrfOptions` to the sync response.

### Phase 3: NodeWarden's Own Web

1. The login page passkey button and `performPasskeyLogin()`.
2. The passkey settings page.
3. PRF keyset creation, saving, deletion, enable encryption.
4. Browser capability detection and error prompts.

### Phase 4: Extension Compatibility

1. Use the official browser extension's Chromium passkey login flow to verify the endpoints.
2. Verify the identity/api/web vault URLs in `/config`.
3. Verify the RP ID and allowed origins.
4. Add compatibility fields or alias routes if necessary.

Per the user's request, this phase only needs the code to run without errors; no visual tests or test programs are written here.

## To-Do List

- [ ] Design and persist `webauthn_credentials`.
- [ ] Design and persist the WebAuthn challenge/replay cache.
- [ ] Select and verify a Workers-compatible WebAuthn server library.
- [ ] `GET /identity/accounts/webauthn/assertion-options`.
- [ ] `POST /identity/connect/token` supporting `grant_type=webauthn`.
- [ ] `UserDecryptionOptions.WebAuthnPrfOption`.
- [ ] `UserDecryption.WebAuthnPrfOptions`.
- [ ] `/api/webauthn` management endpoints.
- [ ] `/webauthn` official client alias.
- [ ] NodeWarden web passkey login entry.
- [ ] NodeWarden web passkey management page.
- [ ] Rotate PRF keysets in sync during key rotation.
- [ ] Backup export/import covering the new table.
- [ ] Audit logs covering passkey management and login.

## Key File Index

NodeWarden:

- `src/router-public.ts`
- `src/router-authenticated.ts`
- `src/handlers/accounts.ts`
- `src/handlers/identity.ts`
- `src/handlers/sync.ts`
- `src/services/auth.ts`
- `src/services/storage-schema.ts`
- `src/services/storage-user-repo.ts`
- `src/services/storage-device-repo.ts`
- `src/utils/passkey.ts`
- `src/utils/user-decryption.ts`
- `src/types/index.ts`
- `webapp/src/lib/api/auth.ts`
- `webapp/src/lib/app-auth.ts`
- `webapp/src/components/AuthViews.tsx`
- `webapp/src/components/SettingsPage.tsx`

Bitwarden server:

- `.codex-upstream/bitwarden-server/src/Identity/Controllers/AccountsController.cs`
- `.codex-upstream/bitwarden-server/src/Identity/IdentityServer/RequestValidators/WebAuthnGrantValidator.cs`
- `.codex-upstream/bitwarden-server/src/Identity/IdentityServer/ApiClient.cs`
- `.codex-upstream/bitwarden-server/src/Api/Auth/Controllers/WebAuthnController.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/Entities/WebAuthnCredential.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/GetWebAuthnLoginCredentialCreateOptionsCommand.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/GetWebAuthnLoginCredentialAssertionOptionsCommand.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/CreateWebAuthnLoginCredentialCommand.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/AssertWebAuthnLoginCredentialCommand.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/Models/Api/Response/UserDecryptionOptions.cs`
- `.codex-upstream/bitwarden-server/util/SqliteMigrations/Migrations/20231213032045_WebAuthnLoginCredentials.cs`

Bitwarden clients/browser:

- `.codex-upstream/bitwarden-clients/libs/auth/src/angular/login/default-login-component.service.ts`
- `.codex-upstream/bitwarden-clients/apps/browser/src/auth/popup/login/extension-login-component.service.ts`
- `.codex-upstream/bitwarden-clients/libs/angular/src/auth/login-via-webauthn/login-via-webauthn.component.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/webauthn-login-api.service.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/webauthn-login.service.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/webauthn-login-prf-key.service.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/models/request/identity-token/webauthn-login-token.request.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/request/webauthn-login-response.request.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/request/webauthn-login-assertion-response.request.ts`
- `.codex-upstream/bitwarden-clients/libs/auth/src/common/login-strategies/webauthn-login.strategy.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin-api.service.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin.service.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/request/save-credential.request.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/request/enable-credential-encryption.request.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/request/webauthn-login-attestation-response.request.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/enums/webauthn-login-credential-prf-status.enum.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/models/response/user-decryption-options/webauthn-prf-decryption-option.response.ts`
- `.codex-upstream/bitwarden-clients/libs/auth/src/common/models/domain/user-decryption-options.ts`
