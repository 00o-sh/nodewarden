import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendDraft, VaultDraft } from '@/lib/types';
import {
  DEMO_ADMIN_INVITES,
  DEMO_ADMIN_USERS,
  DEMO_AUDIT_LOGS,
  DEMO_AUTHORIZED_DEVICES,
  DEMO_BACKUP_SETTINGS,
  DEMO_CIPHERS,
  DEMO_FOLDERS,
  DEMO_PROFILE,
  DEMO_SENDS,
  DEMO_SESSION,
  IS_DEMO_MODE,
  createDemoBackupSettings,
  createDemoCompletedLogin,
  createDemoInitialBootstrapState,
  createDemoMainRoutesProps,
  getDemoPublicSend,
} from '@/lib/demo';
import { demoBrandIconUrl } from '@/lib/demo-brand-icons';

// The demo build (npm run build:demo) ships lib/demo.ts + lib/demo-brand-icons.ts,
// which the production bundle aliases out entirely. This suite runs with
// __NODEWARDEN_DEMO__ = true and the real demo modules aliased in (see
// vitest.demo.config.ts) so the demo wiring — an in-memory fake backend — is
// exercised instead of shipping as a large untested blob.

// The parameter shapes of createDemoMainRoutesProps aren't exported; derive them
// so the harness stays in lockstep with the source signature.
type Base = Parameters<typeof createDemoMainRoutesProps>[0];
type Notify = Parameters<typeof createDemoMainRoutesProps>[1];
type DemoState = Parameters<typeof createDemoMainRoutesProps>[2];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// A live in-memory DemoRouteState whose setters accept either a value or an
// updater function, exactly like the real useState setters the demo wires to.
function makeState(): DemoState {
  const state = {
    ciphers: DEMO_CIPHERS.map((c) => clone(c)),
    folders: DEMO_FOLDERS.map((f) => ({ ...f })),
    sends: DEMO_SENDS.map((s) => clone(s)),
    users: DEMO_ADMIN_USERS.map((u) => ({ ...u })),
    invites: DEMO_ADMIN_INVITES.map((i) => ({ ...i })),
    authorizedDevices: DEMO_AUTHORIZED_DEVICES.map((d) => ({ ...d })),
    backupSettings: createDemoBackupSettings(),
  } as DemoState;
  const setter =
    <K extends keyof DemoState>(key: K) =>
    (next: unknown) => {
      state[key] = (typeof next === 'function' ? (next as (p: unknown) => unknown)(state[key]) : next) as DemoState[K];
    };
  state.setCiphers = setter('ciphers') as DemoState['setCiphers'];
  state.setFolders = setter('folders') as DemoState['setFolders'];
  state.setSends = setter('sends') as DemoState['setSends'];
  state.setUsers = setter('users') as DemoState['setUsers'];
  state.setInvites = setter('invites') as DemoState['setInvites'];
  state.setAuthorizedDevices = setter('authorizedDevices') as DemoState['setAuthorizedDevices'];
  state.setBackupSettings = setter('backupSettings') as DemoState['setBackupSettings'];
  return state;
}

// A fully-populated VaultDraft (all string fields empty, arrays empty) so the
// per-type overrides in cipherFromDraft can be driven by only setting `type`
// plus the handful of fields under test.
function makeVaultDraft(overrides: Partial<VaultDraft> = {}): VaultDraft {
  const draft: VaultDraft = {
    type: 1,
    favorite: false,
    name: '',
    folderId: '',
    notes: '',
    reprompt: false,
    loginUsername: '',
    loginPassword: '',
    loginTotp: '',
    loginUris: [],
    loginFido2Credentials: [],
    cardholderName: '',
    cardNumber: '',
    cardBrand: '',
    cardExpMonth: '',
    cardExpYear: '',
    cardCode: '',
    identTitle: '',
    identFirstName: '',
    identMiddleName: '',
    identLastName: '',
    identUsername: '',
    identCompany: '',
    identSsn: '',
    identPassportNumber: '',
    identLicenseNumber: '',
    identEmail: '',
    identPhone: '',
    identAddress1: '',
    identAddress2: '',
    identAddress3: '',
    identCity: '',
    identState: '',
    identPostalCode: '',
    identCountry: '',
    sshPrivateKey: '',
    sshPublicKey: '',
    sshFingerprint: '',
    bankName: '',
    bankNameOnAccount: '',
    bankAccountType: '',
    bankAccountNumber: '',
    bankRoutingNumber: '',
    bankBranchNumber: '',
    bankPin: '',
    bankSwiftCode: '',
    bankIban: '',
    bankContactPhone: '',
    licenseFirstName: '',
    licenseMiddleName: '',
    licenseLastName: '',
    licenseDateOfBirth: '',
    licenseNumber: '',
    licenseIssuingCountry: '',
    licenseIssuingState: '',
    licenseIssueDate: '',
    licenseExpirationDate: '',
    licenseIssuingAuthority: '',
    licenseClass: '',
    passportSurname: '',
    passportGivenName: '',
    passportDateOfBirth: '',
    passportSex: '',
    passportBirthPlace: '',
    passportNationality: '',
    passportIssuingCountry: '',
    passportNumber: '',
    passportType: '',
    passportNationalIdentificationNumber: '',
    passportIssuingAuthority: '',
    passportIssueDate: '',
    passportExpirationDate: '',
    customFields: [],
  };
  return { ...draft, ...overrides };
}

function makeSendDraft(overrides: Partial<SendDraft> = {}): SendDraft {
  const draft: SendDraft = {
    type: 'text',
    name: '',
    notes: '',
    text: '',
    file: null,
    deletionDays: '7',
    expirationDays: '0',
    maxAccessCount: '',
    password: '',
    disabled: false,
  };
  return { ...draft, ...overrides };
}

function makeProps(state = makeState()) {
  const notify = vi.fn<Notify>();
  const props = createDemoMainRoutesProps({} as Base, notify as Notify, state);
  return { props, notify, state };
}

describe('demo data + read helpers', () => {
  it('exposes IS_DEMO_MODE = true under the demo define', () => {
    expect(IS_DEMO_MODE).toBe(true);
  });

  it('populates the demo vault fixtures', () => {
    expect(DEMO_CIPHERS.length).toBeGreaterThan(0);
    expect(DEMO_FOLDERS.length).toBeGreaterThan(0);
    expect(DEMO_SENDS.length).toBeGreaterThan(0);
    expect(DEMO_AUDIT_LOGS.length).toBeGreaterThan(0);
    expect(DEMO_ADMIN_USERS[0].email).toBe(DEMO_PROFILE.email);
    expect(DEMO_SESSION.email).toBe(DEMO_PROFILE.email);
  });

  it('getDemoPublicSend returns the note fixture (case-insensitive)', () => {
    const send = getDemoPublicSend('DEMO-NOTE');
    expect(send).toMatchObject({ id: 'send-demo-note', type: 0, file: null });
    expect(send?.decText).toContain('demo');
  });

  it('getDemoPublicSend returns the file fixture', () => {
    const send = getDemoPublicSend('demo-file');
    expect(send).toMatchObject({ id: 'send-demo-file', type: 1 });
    expect(send?.file?.fileName).toBe('design-handoff.zip');
  });

  it('getDemoPublicSend returns null for unknown / empty access ids', () => {
    expect(getDemoPublicSend('nope')).toBeNull();
    expect(getDemoPublicSend('')).toBeNull();
    expect(getDemoPublicSend(undefined as unknown as string)).toBeNull();
  });

  it('createDemoBackupSettings deep-clones the fixture', () => {
    const a = createDemoBackupSettings();
    expect(a).toEqual(DEMO_BACKUP_SETTINGS);
    a.destinations[0].name = 'mutated';
    expect(DEMO_BACKUP_SETTINGS.destinations[0].name).not.toBe('mutated');
  });

  it('createDemoInitialBootstrapState reports the login phase', () => {
    expect(createDemoInitialBootstrapState()).toMatchObject({ phase: 'login', session: null });
  });

  it('createDemoCompletedLogin defaults to the demo email', async () => {
    const login = createDemoCompletedLogin();
    expect(login.session.email).toBe(DEMO_PROFILE.email);
    await expect(login.profilePromise).resolves.toMatchObject({ email: DEMO_PROFILE.email });
  });

  it('createDemoCompletedLogin normalizes a supplied email', () => {
    const login = createDemoCompletedLogin('  User@Example.COM ');
    expect(login.session.email).toBe('user@example.com');
    expect(login.profile.email).toBe('user@example.com');
  });

  it('demoBrandIconUrl resolves known hosts and strips www.', () => {
    const bare = demoBrandIconUrl('github.com');
    expect(bare).toMatch(/^data:image\//);
    expect(demoBrandIconUrl('WWW.github.com')).toBe(bare);
  });

  it('demoBrandIconUrl returns empty string for unknown hosts', () => {
    expect(demoBrandIconUrl('no-such-host.example')).toBe('');
  });
});

describe('createDemoMainRoutesProps — vault items', () => {
  it('creates a login item (type 1) from a draft', async () => {
    const { props, notify, state } = makeProps();
    const before = state.ciphers.length;
    await props.onCreateVaultItem(
      makeVaultDraft({
        type: 1,
        name: 'New Login',
        favorite: true,
        reprompt: true,
        loginUsername: 'u',
        loginPassword: 'p',
        loginTotp: 'otp',
        loginUris: [{ uri: 'https://example.com', match: null, extra: { foo: 1 } }],
        loginFido2Credentials: [{ credentialId: 'c' }],
        customFields: [{ type: 1, label: 'PIN', value: '1234' }],
      })
    );
    expect(state.ciphers.length).toBe(before + 1);
    const created = state.ciphers[0];
    expect(created).toMatchObject({ type: 1, decName: 'New Login', favorite: true, reprompt: 1 });
    expect(created.login?.decUsername).toBe('u');
    expect(created.login?.uris?.[0]).toMatchObject({ decUri: 'https://example.com', foo: 1 });
    expect(created.fields?.[0]).toMatchObject({ name: 'PIN', decValue: '1234' });
    expect(notify).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('creates a card item (type 3)', async () => {
    const { state } = makeProps();
    const { props } = makeProps(state);
    await props.onCreateVaultItem(makeVaultDraft({ type: 3, name: 'Card', cardNumber: '4111', cardBrand: 'Visa' }));
    expect(state.ciphers[0]).toMatchObject({ type: 3 });
    expect(state.ciphers[0].card?.decNumber).toBe('4111');
    expect(state.ciphers[0].login).toBeNull();
  });

  it('creates an identity item (type 4)', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    await props.onCreateVaultItem(makeVaultDraft({ type: 4, name: 'Me', identFirstName: 'Ada', identSsn: '123' }));
    expect(state.ciphers[0].identity?.decFirstName).toBe('Ada');
    expect(state.ciphers[0].card).toBeNull();
  });

  it('creates an ssh-key item (type 5)', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    await props.onCreateVaultItem(makeVaultDraft({ type: 5, name: 'key', sshPublicKey: 'ssh-ed25519 AAAA', sshFingerprint: 'fp' }));
    expect(state.ciphers[0].sshKey?.decPublicKey).toBe('ssh-ed25519 AAAA');
    expect(state.ciphers[0].sshKey?.decFingerprint).toBe('fp');
  });

  it('creates a secure-note item (type 2 → no sub-object)', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    await props.onCreateVaultItem(makeVaultDraft({ type: 2, name: 'Note', notes: 'secret' }));
    const created = state.ciphers[0];
    expect(created).toMatchObject({ type: 2, decNotes: 'secret' });
    expect(created.login).toBeNull();
    expect(created.card).toBeNull();
    expect(created.identity).toBeNull();
    expect(created.sshKey).toBeNull();
  });

  it('updates an existing item, preserving its id and creation date', async () => {
    const state = makeState();
    const { props, notify } = makeProps(state);
    const target = state.ciphers[0];
    await props.onUpdateVaultItem(target, makeVaultDraft({ type: target.type, name: 'Renamed' }));
    const updated = state.ciphers.find((c) => c.id === target.id);
    expect(updated?.decName).toBe('Renamed');
    expect(updated?.creationDate).toBe(target.creationDate);
    expect(notify).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('soft-deletes, then permanently deletes a vault item', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const target = state.ciphers.find((c) => !c.deletedDate)!;
    await props.onDeleteVaultItem(target);
    const soft = state.ciphers.find((c) => c.id === target.id);
    expect(soft?.deletedDate).toBeTruthy();
    // Second delete on an already-deleted item removes it outright.
    await props.onDeleteVaultItem(soft!);
    expect(state.ciphers.find((c) => c.id === target.id)).toBeUndefined();
  });

  it('archives and unarchives a vault item', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const target = state.ciphers[0];
    await props.onArchiveVaultItem(target);
    expect(state.ciphers.find((c) => c.id === target.id)?.archivedDate).toBeTruthy();
    await props.onUnarchiveVaultItem(target);
    expect(state.ciphers.find((c) => c.id === target.id)?.archivedDate).toBeNull();
  });

  it('runs every bulk vault operation', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const ids = state.ciphers.slice(0, 2).map((c) => c.id);
    const folderId = state.folders[0].id;
    await props.onBulkDeleteVaultItems(ids);
    expect(state.ciphers.filter((c) => ids.includes(c.id) && c.deletedDate).length).toBe(2);
    await props.onBulkRestoreVaultItems(ids);
    expect(state.ciphers.filter((c) => ids.includes(c.id) && c.deletedDate).length).toBe(0);
    await props.onRestoreVaultItems(ids);
    await props.onBulkArchiveVaultItems(ids);
    expect(state.ciphers.filter((c) => ids.includes(c.id) && c.archivedDate).length).toBe(2);
    await props.onBulkUnarchiveVaultItems(ids);
    expect(state.ciphers.filter((c) => ids.includes(c.id) && c.archivedDate).length).toBe(0);
    await props.onBulkMoveVaultItems(ids, folderId);
    expect(state.ciphers.filter((c) => ids.includes(c.id) && c.folderId === folderId).length).toBe(2);
    await props.onBulkPermanentDeleteVaultItems(ids);
    expect(state.ciphers.filter((c) => ids.includes(c.id)).length).toBe(0);
  });

  it('verify-master-password and download attachment are no-op successes', async () => {
    const { props, notify } = makeProps();
    await expect(props.onVerifyMasterPassword('pw')).resolves.toBeUndefined();
    await props.onDownloadVaultAttachment(state0Cipher(), state0Attachment());
    expect(notify).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('refreshing the vault resets it to the fixtures', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    await props.onBulkPermanentDeleteVaultItems(state.ciphers.map((c) => c.id));
    expect(state.ciphers.length).toBe(0);
    await props.onRefreshVault();
    expect(state.ciphers.length).toBe(DEMO_CIPHERS.length);
  });

  it('import / export are read-only warnings', async () => {
    const { props, notify } = makeProps();
    await expect(props.onImport()).resolves.toMatchObject({ totalItems: 0 });
    await expect(props.onImportEncryptedRaw()).resolves.toMatchObject({ totalItems: 0 });
    await props.onExport();
    expect(notify).toHaveBeenCalledWith('warning', expect.any(String));
  });
});

// Helpers for the download-attachment signature (values are ignored by the demo).
function state0Cipher() {
  return DEMO_CIPHERS[0];
}
function state0Attachment() {
  return { id: 'a', fileName: 'f', size: 1 } as never;
}

describe('createDemoMainRoutesProps — folders', () => {
  it('creates a folder and rejects an empty name', async () => {
    const state = makeState();
    const { props, notify } = makeProps(state);
    const before = state.folders.length;
    await props.onCreateFolder('  ');
    expect(state.folders.length).toBe(before);
    expect(notify).toHaveBeenCalledWith('error', expect.any(String));
    await props.onCreateFolder('  Work  ');
    expect(state.folders.length).toBe(before + 1);
    expect(state.folders[0].decName).toBe('Work');
  });

  it('renames and deletes a folder, orphaning its ciphers', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const folderId = state.folders[0].id;
    // Attach a cipher to the folder so deletion has something to orphan.
    state.ciphers[0].folderId = folderId;
    await props.onRenameFolder(folderId, 'Renamed');
    expect(state.folders.find((f) => f.id === folderId)?.decName).toBe('Renamed');
    await props.onDeleteFolder(folderId);
    expect(state.folders.find((f) => f.id === folderId)).toBeUndefined();
    expect(state.ciphers.find((c) => c.folderId === folderId)).toBeUndefined();
  });

  it('bulk-deletes folders and orphans their ciphers', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const ids = state.folders.map((f) => f.id);
    state.ciphers[0].folderId = ids[0];
    await props.onBulkDeleteFolders(ids);
    expect(state.folders.length).toBe(0);
    expect(state.ciphers.every((c) => !c.folderId || !ids.includes(c.folderId))).toBe(true);
  });
});

describe('createDemoMainRoutesProps — sends', () => {
  const origin = 'http://localhost:3000';

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a text send and copies its link when asked', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const before = state.sends.length;
    await props.onCreateSend(makeSendDraft({ type: 'text', name: 'Note', text: 'hi', expirationDays: '3', maxAccessCount: '5' }), true);
    expect(state.sends.length).toBe(before + 1);
    expect(state.sends[0]).toMatchObject({ type: 0, decName: 'Note', decText: 'hi' });
    expect(state.sends[0].maxAccessCount).toBe(5);
    expect(state.sends[0].expirationDate).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('creates a file send without copying the link', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const file = new File([new Uint8Array(2048)], 'photo.png', { type: 'image/png' });
    await props.onCreateSend(makeSendDraft({ type: 'file', name: 'Pic', file }), false);
    const created = state.sends[0];
    expect(created.type).toBe(1);
    expect(created.file?.fileName).toBe('photo.png');
    expect(created.file?.sizeName).toBe('2 KB');
    expect(created.expirationDate).toBeNull();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('updates an existing send and deletes it', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const target = state.sends[0];
    await props.onUpdateSend(target, makeSendDraft({ type: 'text', name: 'Updated', text: 'x' }), true);
    expect(state.sends.find((s) => s.id === target.id)?.decName).toBe('Updated');
    await props.onDeleteSend(target);
    expect(state.sends.find((s) => s.id === target.id)).toBeUndefined();
    expect(origin).toBeTruthy();
  });

  it('bulk-deletes sends', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const ids = state.sends.map((s) => s.id);
    await props.onBulkDeleteSends(ids);
    expect(state.sends.length).toBe(0);
  });
});

describe('createDemoMainRoutesProps — account security (read-only surface)', () => {
  it('routes the read-only account actions through a warning', async () => {
    const { props, notify } = makeProps();
    await props.onChangePassword();
    await props.onSavePasswordHint();
    await props.onEnableTotp();
    props.onOpenDisableTotp();
    await props.onDisableTwoFactorPasskeys();
    await props.onEnableAccountPasskeyDirectUnlock();
    await props.onDeleteAccountPasskey();
    await props.onSaveDomainRules();
    expect(notify).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('returns fixed values for passkey / recovery / api-key reads', async () => {
    const { props } = makeProps();
    await expect(props.onGetTwoFactorPasskeySettings()).resolves.toEqual({ enabled: false, keys: [] });
    await expect(props.onCreateTwoFactorPasskey()).resolves.toEqual({ enabled: false, keys: [] });
    await expect(props.onDeleteTwoFactorPasskey()).resolves.toEqual({ enabled: false, keys: [] });
    await expect(props.onGetRecoveryCode()).resolves.toBe('DEMO-READ-ONLY');
    await expect(props.onGetApiKey()).resolves.toBe('DEMO-READ-ONLY');
    await expect(props.onRotateApiKey()).resolves.toBe('DEMO-READ-ONLY');
    await expect(props.onListAccountPasskeys()).resolves.toEqual([]);
    await expect(props.onCreateAccountPasskey()).resolves.toBeNull();
  });

  it('lock/session-timeout changes are silent no-ops', () => {
    const { props } = makeProps();
    expect(props.onLockTimeoutChange(60)).toBeUndefined();
    expect(props.onSessionTimeoutActionChange('lock')).toBeUndefined();
  });
});

describe('createDemoMainRoutesProps — audit logs', () => {
  it('filters, searches and paginates the audit log', async () => {
    const { props } = makeProps();
    const all = await props.onLoadAuditLogs({ limit: 50, offset: 0 });
    expect(all.total).toBe(DEMO_AUDIT_LOGS.length);
    expect(all.logs.length).toBe(DEMO_AUDIT_LOGS.length);

    const authOnly = await props.onLoadAuditLogs({ category: 'auth', level: 'all' });
    expect(authOnly.logs.every((l) => l.category === 'auth')).toBe(true);

    const warnOnly = await props.onLoadAuditLogs({ level: 'warn', category: 'all' });
    expect(warnOnly.logs.every((l) => l.level === 'warn')).toBe(true);

    const searched = await props.onLoadAuditLogs({ q: 'login' });
    expect(searched.logs.length).toBeGreaterThan(0);

    const windowed = await props.onLoadAuditLogs({ from: '2026-07-08T14:00:00.000Z', to: '2026-07-08T15:00:00.000Z' });
    expect(windowed.logs.every((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= new Date('2026-07-08T14:00:00.000Z').getTime() && t <= new Date('2026-07-08T15:00:00.000Z').getTime();
    })).toBe(true);

    const firstPage = await props.onLoadAuditLogs({ limit: 1, offset: 0 });
    expect(firstPage.logs.length).toBe(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.offset).toBe(1);
  });

  it('audit-log settings + clear are demo stubs', async () => {
    const { props, notify } = makeProps();
    await expect(props.onLoadAuditLogSettings()).resolves.toMatchObject({ retentionDays: 90 });
    await expect(props.onSaveAuditLogSettings({ retentionDays: 30, maxEntries: 100 })).resolves.toMatchObject({ retentionDays: 30 });
    await expect(props.onClearAuditLogs()).resolves.toBe(0);
    expect(notify).toHaveBeenCalledWith('success', expect.any(String));
  });
});

describe('createDemoMainRoutesProps — devices', () => {
  it('refresh, rename (valid + empty), trust and removal transitions', async () => {
    const state = makeState();
    const { props, notify } = makeProps(state);
    await props.onRefreshAuthorizedDevices();

    const device = state.authorizedDevices[0];
    await props.onRenameAuthorizedDevice(device, '   ');
    expect(notify).toHaveBeenCalledWith('error', expect.any(String));
    await props.onRenameAuthorizedDevice(device, 'Work Laptop');
    expect(state.authorizedDevices.find((d) => d.identifier === device.identifier)?.name).toBe('Work Laptop');

    // A trusted device can be pinned permanently, then have its trust revoked.
    const trusted = state.authorizedDevices.find((d) => d.trusted)!;
    props.onTrustDevicePermanently(trusted);
    expect(state.authorizedDevices.find((d) => d.identifier === trusted.identifier)?.trustedUntil).toContain('2099');
    props.onRevokeDeviceTrust(trusted);
    expect(state.authorizedDevices.find((d) => d.identifier === trusted.identifier)?.trusted).toBe(false);

    props.onRevokeAllDeviceTrust();
    expect(state.authorizedDevices.every((d) => !d.trusted)).toBe(true);

    props.onRemoveDevice(device);
    expect(state.authorizedDevices.find((d) => d.identifier === device.identifier)).toBeUndefined();

    props.onRemoveAllDevices();
    expect(state.authorizedDevices.length).toBe(0);
  });

  it('domain-rule refresh + save are stubs', async () => {
    const { props, notify } = makeProps();
    props.onRefreshDomainRules();
    expect(notify).toHaveBeenCalledWith('success', expect.any(String));
  });
});

describe('createDemoMainRoutesProps — admin (users + invites)', () => {
  it('creates, prunes and deletes invites', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const before = state.invites.length;
    await props.onCreateInvite(48);
    expect(state.invites.length).toBe(before + 1);
    await props.onCreateInvite(undefined as unknown as number);
    props.onRefreshAdmin();

    await props.onDeleteInvalidInvites();
    expect(state.invites.every((i) => i.status === 'active')).toBe(true);

    const code = state.invites[0].code;
    await props.onDeleteInvite(code);
    expect(state.invites.find((i) => i.code === code)).toBeUndefined();

    await props.onDeleteAllInvites();
    expect(state.invites.length).toBe(0);
  });

  it('toggles user status and deletes users', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const active = state.users.find((u) => u.status === 'active')!;
    await props.onToggleUserStatus(active.id, active.status);
    expect(state.users.find((u) => u.id === active.id)?.status).toBe('banned');

    await props.onDeleteUser(active.id);
    expect(state.users.find((u) => u.id === active.id)).toBeUndefined();
  });
});

describe('createDemoMainRoutesProps — backup center', () => {
  it('export + save/load settings round-trip', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    await props.onExportBackup('master');
    await expect(props.onLoadBackupSettings()).resolves.toBe(state.backupSettings);

    const next = createDemoBackupSettings();
    next.destinations[0].name = 'Renamed WebDAV';
    const saved = await props.onSaveBackupSettings('master', next);
    expect(saved.destinations[0].name).toBe('Renamed WebDAV');
    expect(state.backupSettings.destinations[0].name).toBe('Renamed WebDAV');
  });

  it('import backup resets the vault', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    state.ciphers = [];
    await expect(props.onImportBackup('master', new File([], 'b.zip'), true)).resolves.toMatchObject({ object: 'instance-backup-import' });
    expect(state.ciphers.length).toBe(DEMO_CIPHERS.length);
    state.ciphers = [];
    await props.onImportBackupAllowingChecksumMismatch('master', new File([], 'b.zip'));
    expect(state.ciphers.length).toBe(DEMO_CIPHERS.length);
  });

  it('runs a remote backup for a named and a default destination', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const named = await props.onRunRemoteBackup('master', state.backupSettings.destinations[0].id);
    expect(named.result.provider).toBe('webdav');
    const fallback = await props.onRunRemoteBackup('master', 'does-not-exist');
    expect(fallback.result.provider).toBe('webdav');
  });

  it('lists, inspects, downloads and deletes remote backups', async () => {
    const { props, notify } = makeProps();
    const listing = await props.onListRemoteBackups('demo-webdav', 'archive');
    expect(listing.items.length).toBeGreaterThan(0);
    expect(listing.currentPath).toBe('archive');

    const integrity = await props.onInspectRemoteBackup('master', 'demo-webdav', 'archive/backup.zip');
    expect(integrity.fileName).toBe('backup.zip');
    expect(integrity.integrity.matches).toBe(true);

    await props.onDownloadRemoteBackup('master', 'demo-webdav', 'archive/backup.zip');
    await props.onDeleteRemoteBackup('master', 'demo-webdav', 'archive/backup.zip');
    expect(notify).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('restores a remote backup, streaming progress (both integrity modes)', async () => {
    vi.useFakeTimers();
    try {
      const state = makeState();
      const { props } = makeProps(state);
      state.ciphers = [];

      const p1 = props.onRestoreRemoteBackup('master', 'demo-webdav', 'archive/backup.zip');
      await vi.runAllTimersAsync();
      await expect(p1).resolves.toMatchObject({ object: 'instance-backup-import' });
      expect(state.ciphers.length).toBe(DEMO_CIPHERS.length);

      state.ciphers = [];
      // A bare filename (no '/') exercises the path.split('/').pop() fallback.
      const p2 = props.onRestoreRemoteBackupAllowingChecksumMismatch('master', 'demo-webdav', 'backup.zip');
      await vi.runAllTimersAsync();
      await expect(p2).resolves.toMatchObject({ object: 'instance-backup-import' });
      expect(state.ciphers.length).toBe(DEMO_CIPHERS.length);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createDemoMainRoutesProps — branch edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fully populates card, identity and ssh drafts (dec* field arms)', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    await props.onCreateVaultItem(
      makeVaultDraft({
        type: 3,
        name: 'Card',
        cardholderName: 'Ada',
        cardNumber: '4111 1111 1111 1111',
        cardBrand: 'Visa',
        cardExpMonth: '12',
        cardExpYear: '2030',
        cardCode: '123',
      })
    );
    await props.onCreateVaultItem(
      makeVaultDraft({
        type: 4,
        name: 'Identity',
        identTitle: 'Dr',
        identFirstName: 'Ada',
        identMiddleName: 'M',
        identLastName: 'Lovelace',
        identUsername: 'ada',
        identCompany: 'Analytical',
        identSsn: '111-22-3333',
        identPassportNumber: 'P1',
        identLicenseNumber: 'L1',
        identEmail: 'ada@example.com',
        identPhone: '555',
        identAddress1: '1 St',
        identAddress2: 'Apt 2',
        identAddress3: 'Floor 3',
        identCity: 'London',
        identState: 'LDN',
        identPostalCode: 'EC1',
        identCountry: 'UK',
      })
    );
    await props.onCreateVaultItem(
      makeVaultDraft({ type: 5, name: 'ssh', sshPrivateKey: 'priv', sshPublicKey: 'pub', sshFingerprint: 'SHA256:x' })
    );
    expect(state.ciphers[0].sshKey?.decPrivateKey).toBe('priv');
    expect(state.ciphers[1].identity?.decCountry).toBe('UK');
    expect(state.ciphers[2].card?.decCode).toBe('123');
  });

  it('derives the type from the current item when the draft type is falsy', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const card = state.ciphers.find((c) => c.type === 3) ?? state.ciphers[0];
    await props.onUpdateVaultItem(card, makeVaultDraft({ type: 0 as unknown as number, name: 'Kept type' }));
    const updated = state.ciphers.find((c) => c.id === card.id);
    expect(updated?.type).toBe(card.type);
  });

  it('falls back to a non-crypto demo id when randomUUID is unavailable', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const state = makeState();
      const { props } = makeProps(state);
      await props.onCreateVaultItem(makeVaultDraft({ type: 1, name: 'no-uuid' }));
      expect(state.ciphers[0].id).toMatch(/^demo-cipher-/);
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original);
    }
  });

  it('handles a zero-byte file send and default deletion window', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    await props.onCreateSend(makeSendDraft({ type: 'file', name: 'empty', file: new File([], 'empty.bin'), deletionDays: '' }), false);
    expect(state.sends[0].file?.sizeName).toBe('0 KB');
  });

  it('lists a remote backup at the root path (null parent)', async () => {
    const { props } = makeProps();
    const listing = await props.onListRemoteBackups('demo-webdav', '');
    expect(listing.parentPath).toBeNull();
  });

  it('applies default audit-log paging and email-only search', async () => {
    const { props } = makeProps();
    const defaults = await props.onLoadAuditLogs({});
    expect(defaults.limit).toBe(50);
    const byEmail = await props.onLoadAuditLogs({ q: 'example' });
    expect(byEmail.logs.length).toBeGreaterThan(0);
    const none = await props.onLoadAuditLogs({ q: 'zzz-no-such-entry' });
    expect(none.logs.length).toBe(0);
  });

  it('reactivates a banned user via the status toggle', async () => {
    const state = makeState();
    const { props } = makeProps(state);
    const banned = state.users.find((u) => u.status === 'banned')!;
    await props.onToggleUserStatus(banned.id, banned.status);
    expect(state.users.find((u) => u.id === banned.id)?.status).toBe('active');
  });
});
