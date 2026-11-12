/**
 * Database schema. Column names are snake_case in SQL (drizzle `casing`).
 * Lengths are centimeters. See PLAN.md section 4.
 *
 * Rows that belong to a wedding carry wedding_id, and links between them point
 * at (wedding_id, id), so the database refuses to link rows across weddings.
 *
 * No 'server-only' import here: scripts (migrate, seed) import this file too.
 */
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { Canvas } from '../../domain/canvas-schema'
import type { FixedItem, ReferenceMeta } from '../../domain/venue-schema'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
const deletedAt = () => timestamp({ withTimezone: true })

/** One save that landed on a layout, kept in layouts.recent_saves. */
export type RecentSave = { saveId: string; version: number }

/** People who can sign in. Email is stored trimmed and lower case. */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    displayName: text().notNull(),
    passwordHash: text().notNull(),
    isAdmin: boolean().notNull().default(false),
    disabledAt: timestamp({ withTimezone: true }),
    passwordChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp({ withTimezone: true }),
    lastSeenAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('users_email_uq').on(t.email),
    check('users_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    check('users_display_name_length', sql`length(btrim(${t.displayName})) between 1 and 60`),
    index('users_last_seen_idx').on(t.lastSeenAt),
  ],
)

export const weddings = pgTable(
  'weddings',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    date: date({ mode: 'string' }),
    unit: text({ enum: ['ft', 'm'] }).notNull().default('ft'),
    minGapCm: real().notNull().default(152.4),
    /** The couple's names. Guest sides are 'partner1' / 'partner2', so renaming relabels every guest. Null shows "Partner 1". */
    partner1Name: text(),
    partner2Name: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('weddings_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('weddings_unit_valid', sql`${t.unit} in ('ft', 'm')`),
    check('weddings_min_gap_positive', sql`${t.minGapCm} > 0`),
    check('weddings_partner1_name_valid', sql`${t.partner1Name} is null or length(btrim(${t.partner1Name})) between 1 and 60`),
    check('weddings_partner2_name_valid', sql`${t.partner2Name} is null or length(btrim(${t.partner2Name})) between 1 and 60`),
  ],
)

/** A sign-in. Only the hash of the cookie token is stored, and no IP address. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    /** Cut to 200 characters by the app. */
    userAgent: text(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique('sessions_token_hash_uq').on(t.tokenHash),
    check('sessions_token_hash_length', sql`length(${t.tokenHash}) = 64`),
    check('sessions_user_agent_length', sql`${t.userAgent} is null or length(${t.userAgent}) <= 200`),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
)

/**
 * Who can open a wedding. A wedding that has members always keeps one owner:
 * a trigger from migration 0006 refuses to commit otherwise (drizzle does not track triggers).
 */
export const weddingMembers = pgTable(
  'wedding_members',
  {
    weddingId: uuid()
      .notNull()
      .references(() => weddings.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text({ enum: ['owner', 'editor'] }).notNull(),
    addedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.weddingId, t.userId] }),
    check('wedding_members_role_valid', sql`${t.role} in ('owner', 'editor')`),
    index('wedding_members_user_idx').on(t.userId),
  ],
)

/** A link that lets someone join a wedding, or (no wedding) become a new planner. Only the token hash is stored. */
export const invites = pgTable(
  'invites',
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenHash: text().notNull(),
    weddingId: uuid().references(() => weddings.id, { onDelete: 'cascade' }),
    role: text({ enum: ['owner', 'editor'] }),
    email: text(),
    note: text(),
    invitedByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('invites_token_hash_uq').on(t.tokenHash),
    check('invites_token_hash_length', sql`length(${t.tokenHash}) = 64`),
    check('invites_role_valid', sql`${t.role} is null or ${t.role} in ('owner', 'editor')`),
    check('invites_email_normalized', sql`${t.email} is null or ${t.email} = lower(btrim(${t.email}))`),
    check('invites_note_length', sql`${t.note} is null or length(${t.note}) <= 200`),
    check('invites_wedding_and_role_together', sql`(${t.weddingId} is null) = (${t.role} is null)`),
    index('invites_wedding_idx').on(t.weddingId),
  ],
)

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenHash: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('password_resets_token_hash_uq').on(t.tokenHash),
    check('password_resets_token_hash_length', sql`length(${t.tokenHash}) = 64`),
  ],
)

/**
 * A log of things that happened. wedding_id and subject_id have no foreign key,
 * so events outlive the rows they mention. kind is checked in TypeScript, not here.
 */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    kind: text().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    weddingId: uuid(),
    subjectId: uuid(),
    detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** When set, a second event with the same key is refused, so a retry cannot log twice. */
    dedupeKey: text(),
  },
  (t) => [
    check('activity_events_detail_object', sql`jsonb_typeof(${t.detail}) = 'object'`),
    uniqueIndex('activity_events_dedupe_uq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('activity_events_occurred_idx').on(t.occurredAt),
    index('activity_events_user_idx').on(t.userId, t.occurredAt),
    index('activity_events_wedding_idx').on(t.weddingId, t.occurredAt),
  ],
)

export const guests = pgTable(
  'guests',
  {
    id: uuid().primaryKey().defaultRandom(),
    weddingId: uuid()
      .notNull()
      .references(() => weddings.id),
    firstName: text().notNull(),
    lastName: text().notNull(),
    nickname: text(),
    partnerId: uuid(),
    coupleRuleEnabled: boolean().notNull().default(true),
    household: text(),
    /** Which partner's guest, by position (weddings.partner1_name / partner2_name), or both. */
    side: text({ enum: ['partner1', 'partner2', 'both'] }).notNull().default('both'),
    rsvp: text({ enum: ['yes', 'no', 'pending'] }).notNull().default('pending'),
    meal: text(),
    isChild: boolean().notNull().default(false),
    notes: text(),
    /** first|last, lower case, accents removed. Not unique: two guests can share a name. */
    nameKey: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique('guests_wedding_id_id_uq').on(t.weddingId, t.id),
    foreignKey({
      name: 'guests_partner_fk',
      columns: [t.weddingId, t.partnerId],
      foreignColumns: [t.weddingId, t.id],
    }),
    check('guests_first_name_not_blank', sql`length(btrim(${t.firstName})) > 0`),
    check('guests_last_name_not_blank', sql`length(btrim(${t.lastName})) > 0`),
    // The old names stay allowed for one release (migration 0007), so the deployment still serving during a build keeps working.
    check('guests_side_valid', sql`${t.side} in ('partner1', 'partner2', 'both', 'Noa', 'Aiden', 'Both')`),
    check('guests_rsvp_valid', sql`${t.rsvp} in ('yes', 'no', 'pending')`),
    check('guests_partner_not_self', sql`${t.partnerId} is null or ${t.partnerId} <> ${t.id}`),
    uniqueIndex('guests_partner_live_uq')
      .on(t.partnerId)
      .where(sql`${t.partnerId} is not null and ${t.deletedAt} is null`),
    index('guests_wedding_live_idx')
      .on(t.weddingId)
      .where(sql`${t.deletedAt} is null`),
    index('guests_wedding_name_key_idx').on(t.weddingId, t.nameKey),
  ],
)

export const groups = pgTable(
  'groups',
  {
    id: uuid().primaryKey().defaultRandom(),
    weddingId: uuid()
      .notNull()
      .references(() => weddings.id),
    name: text().notNull(),
    color: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('groups_wedding_id_id_uq').on(t.weddingId, t.id),
    uniqueIndex('groups_wedding_name_uq').on(t.weddingId, sql`lower(${t.name})`),
    check('groups_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('groups_color_hex', sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
)

export const groupMembers = pgTable(
  'group_members',
  {
    weddingId: uuid().notNull(),
    groupId: uuid().notNull(),
    guestId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.guestId] }),
    foreignKey({
      name: 'group_members_group_fk',
      columns: [t.weddingId, t.groupId],
      foreignColumns: [groups.weddingId, groups.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'group_members_guest_fk',
      columns: [t.weddingId, t.guestId],
      foreignColumns: [guests.weddingId, guests.id],
    }).onDelete('cascade'),
    index('group_members_guest_idx').on(t.guestId),
  ],
)

export const rules = pgTable(
  'rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    weddingId: uuid()
      .notNull()
      .references(() => weddings.id),
    kind: text({ enum: ['together', 'apart'] }).notNull(),
    nextToEachOther: boolean().notNull().default(false),
    appliesTo: text({ enum: ['reception', 'ceremony', 'both'] })
      .notNull()
      .default('both'),
    enabled: boolean().notNull().default(true),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('rules_wedding_id_id_uq').on(t.weddingId, t.id),
    check('rules_kind_valid', sql`${t.kind} in ('together', 'apart')`),
    check('rules_applies_to_valid', sql`${t.appliesTo} in ('reception', 'ceremony', 'both')`),
    check('rules_next_only_together', sql`${t.kind} = 'together' or not ${t.nextToEachOther}`),
    index('rules_wedding_idx').on(t.weddingId),
  ],
)

export const ruleGuests = pgTable(
  'rule_guests',
  {
    weddingId: uuid().notNull(),
    ruleId: uuid().notNull(),
    guestId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ruleId, t.guestId] }),
    foreignKey({
      name: 'rule_guests_rule_fk',
      columns: [t.weddingId, t.ruleId],
      foreignColumns: [rules.weddingId, rules.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'rule_guests_guest_fk',
      columns: [t.weddingId, t.guestId],
      foreignColumns: [guests.weddingId, guests.id],
    }).onDelete('cascade'),
    index('rule_guests_guest_idx').on(t.guestId),
  ],
)

/** Shared by all weddings (PLAN change 5). */
export const venueTemplates = pgTable(
  'venue_templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    fixedItems: jsonb().$type<FixedItem[]>().notNull().default([]),
    referenceImageId: uuid().references((): AnyPgColumn => venueImages.id),
    reference: jsonb().$type<ReferenceMeta>(),
    importedBy: text({ enum: ['hand', 'pdf vectors', 'ai'] })
      .notNull()
      .default('hand'),
    version: integer().notNull().default(1),
    lastSaveId: uuid(),
    /** The newest saves that landed (newest first, up to 20), as on layouts: a retried save after a lost reply answers "already saved". */
    recentSaves: jsonb().$type<RecentSave[]>().notNull().default([]),
    editedBy: text({ enum: ['Noa', 'Aiden'] }),
    editedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** The editor's name as it was when they saved. */
    editedByName: text(),
    /** The planner who made it. Null for templates from before accounts. */
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** In the shared library every planner can copy it. */
    isLibrary: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('venue_templates_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('venue_templates_recent_saves_array', sql`jsonb_typeof(${t.recentSaves}) = 'array'`),
    check('venue_templates_fixed_items_array', sql`jsonb_typeof(${t.fixedItems}) = 'array'`),
    check('venue_templates_imported_by_valid', sql`${t.importedBy} in ('hand', 'pdf vectors', 'ai')`),
    check('venue_templates_version_positive', sql`${t.version} >= 1`),
    check('venue_templates_edited_by_valid', sql`${t.editedBy} is null or ${t.editedBy} in ('Noa', 'Aiden')`),
    check('venue_templates_edited_by_name_length', sql`${t.editedByName} is null or length(${t.editedByName}) <= 200`),
    index('venue_templates_owner_idx')
      .on(t.ownerUserId)
      .where(sql`${t.deletedAt} is null`),
  ],
)

export const venueImages = pgTable(
  'venue_images',
  {
    id: uuid().primaryKey().defaultRandom(),
    templateId: uuid()
      .notNull()
      .references((): AnyPgColumn => venueTemplates.id, { onDelete: 'cascade' }),
    contentType: text({ enum: ['image/png', 'image/jpeg'] }).notNull(),
    bytes: bytea().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    sha256: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('venue_images_content_type_valid', sql`${t.contentType} in ('image/png', 'image/jpeg')`),
    check('venue_images_size_cap', sql`octet_length(${t.bytes}) <= 4194304`),
    index('venue_images_template_idx').on(t.templateId),
  ],
)

export const venueTemplateRevisions = pgTable(
  'venue_template_revisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    templateId: uuid()
      .notNull()
      .references(() => venueTemplates.id, { onDelete: 'cascade' }),
    fixedItems: jsonb().$type<FixedItem[]>().notNull(),
    referenceImageId: uuid(),
    reference: jsonb().$type<ReferenceMeta>(),
    reason: text({ enum: ['save', 'import'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('venue_template_revisions_reason_valid', sql`${t.reason} in ('save', 'import')`),
    index('venue_template_revisions_template_idx').on(t.templateId, t.createdAt),
  ],
)

export const layouts = pgTable(
  'layouts',
  {
    id: uuid().primaryKey().defaultRandom(),
    weddingId: uuid()
      .notNull()
      .references(() => weddings.id),
    name: text().notNull(),
    kind: text({ enum: ['reception', 'ceremony'] }).notNull(),
    venueTemplateId: uuid().references(() => venueTemplates.id),
    version: integer().notNull().default(1),
    lastSaveId: uuid(),
    /**
     * The newest 20 saves that landed, newest first, so a retry of an older
     * save after someone saved since still answers 'already-saved'.
     */
    recentSaves: jsonb().$type<RecentSave[]>().notNull().default([]),
    editedBy: text({ enum: ['Noa', 'Aiden'] }),
    editedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** The editor's name as it was when they saved. */
    editedByName: text(),
    canvas: jsonb().$type<Canvas>().notNull(),
    thumbSvg: text().notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique('layouts_wedding_id_id_uq').on(t.weddingId, t.id),
    check('layouts_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('layouts_kind_valid', sql`${t.kind} in ('reception', 'ceremony')`),
    check('layouts_version_positive', sql`${t.version} >= 1`),
    check('layouts_edited_by_valid', sql`${t.editedBy} is null or ${t.editedBy} in ('Noa', 'Aiden')`),
    check('layouts_edited_by_name_length', sql`${t.editedByName} is null or length(${t.editedByName}) <= 200`),
    check('layouts_canvas_object', sql`jsonb_typeof(${t.canvas}) = 'object'`),
    check('layouts_recent_saves_array', sql`jsonb_typeof(${t.recentSaves}) = 'array'`),
    index('layouts_wedding_live_idx')
      .on(t.weddingId, t.updatedAt)
      .where(sql`${t.deletedAt} is null`),
    index('layouts_template_idx').on(t.venueTemplateId),
  ],
)

/** A checked copy of the seats in each layout's canvas, rebuilt on every canvas write. */
export const layoutSeats = pgTable(
  'layout_seats',
  {
    weddingId: uuid().notNull(),
    layoutId: uuid().notNull(),
    guestId: uuid().notNull(),
    itemId: text().notNull(),
    itemLabel: text().notNull(),
    seatIndex: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.layoutId, t.guestId] }),
    unique('layout_seats_seat_uq').on(t.layoutId, t.itemId, t.seatIndex),
    foreignKey({
      name: 'layout_seats_layout_fk',
      columns: [t.weddingId, t.layoutId],
      foreignColumns: [layouts.weddingId, layouts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'layout_seats_guest_fk',
      columns: [t.weddingId, t.guestId],
      foreignColumns: [guests.weddingId, guests.id],
    }).onDelete('cascade'),
    check('layout_seats_index_nonnegative', sql`${t.seatIndex} >= 0`),
    index('layout_seats_guest_idx').on(t.guestId),
  ],
)

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    weddingId: uuid().notNull(),
    layoutId: uuid().notNull(),
    label: text().notNull().default(''),
    token: text().notNull(),
    passwordHash: text().notNull(),
    credentialVersion: integer().notNull().default(1),
    showNames: boolean().notNull().default(true),
    showNotes: boolean().notNull().default(false),
    lastOpenedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'share_links_layout_fk',
      columns: [t.weddingId, t.layoutId],
      foreignColumns: [layouts.weddingId, layouts.id],
    }).onDelete('cascade'),
    uniqueIndex('share_links_token_uq').on(t.token),
    check('share_links_token_length', sql`length(${t.token}) >= 43`),
    index('share_links_layout_idx').on(t.layoutId),
    index('share_links_wedding_idx').on(t.weddingId),
  ],
)

/** One wedding a backup run could not back up. The message never holds guest data (runner.ts, safeFailureMessage). */
export type BackupFailure = { weddingId: string; message: string }

/**
 * One run of the backup job (src/server/backups/runner.ts): the nightly cron,
 * an admin's "run now", or an owner's "back up now". Only one run is ever
 * 'running' (the partial unique index, and the lease taken under an advisory
 * lock); a run whose heartbeat is older than 6 minutes is marked 'failed' by
 * the next one.
 */
export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    trigger: text({ enum: ['cron', 'admin', 'owner'] }).notNull(),
    /** The admin or owner who started it; null for the cron. */
    startedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    status: text({ enum: ['running', 'ok', 'partial', 'failed'] }).notNull().default('running'),
    backedUp: integer().notNull().default(0),
    unchanged: integer().notNull().default(0),
    failed: integer().notNull().default(0),
    failures: jsonb().$type<BackupFailure[]>().notNull().default([]),
    /** Weddings left for the next run when this one reached its deadline. */
    remaining: integer().notNull().default(0),
    error: text(),
  },
  (t) => [
    check('backup_runs_trigger_valid', sql`${t.trigger} in ('cron', 'admin', 'owner')`),
    check('backup_runs_status_valid', sql`${t.status} in ('running', 'ok', 'partial', 'failed')`),
    check('backup_runs_failures_array', sql`jsonb_typeof(${t.failures}) = 'array'`),
    check('backup_runs_counts_nonnegative', sql`${t.backedUp} >= 0 and ${t.unchanged} >= 0 and ${t.failed} >= 0 and ${t.remaining} >= 0`),
    check('backup_runs_error_length', sql`${t.error} is null or length(${t.error}) <= 1000`),
    uniqueIndex('backup_runs_one_running_uq')
      .on(t.status)
      .where(sql`${t.status} = 'running'`),
    index('backup_runs_started_idx').on(t.startedAt),
  ],
)

/**
 * A backup stored in the backup store (src/server/backups/store.ts): the
 * wedding's backup file without its images, gzipped, at `pathname`. The
 * images are stored once each by content (backup_images) and named by
 * `image_sha256s`. wedding_id has no foreign key, so backups outlive the
 * wedding (as activity_events do); wedding_name is the name at backup time.
 * store_id names the store the file went to (BackupStore.id): a backup in
 * another store (one replaced since) is never read, compared or reused.
 */
export const backups = pgTable(
  'backups',
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: text().notNull(),
    weddingId: uuid().notNull(),
    weddingName: text().notNull(),
    kind: text({ enum: ['nightly', 'manual', 'final'] }).notNull(),
    pathname: text().notNull(),
    /** Size of the stored (gzipped) file. */
    byteSize: bigint({ mode: 'number' }).notNull(),
    /** sha256 of the stored (gzipped) bytes, checked on every read. */
    blobSha256: text().notNull(),
    /** What the backup holds (build.ts, contentSha256): equal means nothing changed. */
    contentSha256: text().notNull(),
    imageSha256s: text().array().notNull().default(sql`'{}'::text[]`),
    formatVersion: integer().notNull(),
    guestCount: integer().notNull(),
    layoutCount: integer().notNull(),
    createdAt: createdAt(),
    /** The last time a run found the wedding unchanged since this backup (created_at at first). */
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    runId: uuid().references(() => backupRuns.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('backups_pathname_uq').on(t.pathname),
    check('backups_kind_valid', sql`${t.kind} in ('nightly', 'manual', 'final')`),
    check('backups_blob_sha256_hex', sql`${t.blobSha256} ~ '^[0-9a-f]{64}$'`),
    check('backups_content_sha256_hex', sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check('backups_counts_nonnegative', sql`${t.byteSize} >= 0 and ${t.guestCount} >= 0 and ${t.layoutCount} >= 0`),
    check('backups_store_id_length', sql`length(${t.storeId}) between 1 and 300`),
    index('backups_wedding_created_idx').on(t.weddingId, t.createdAt.desc()),
    index('backups_created_idx').on(t.createdAt),
    index('backups_image_sha256s_idx').using('gin', t.imageSha256s),
  ],
)

/**
 * A floor plan image in a backup store, stored once per store by its content
 * (backups/images/<sha256>.<ext>).
 */
export const backupImages = pgTable(
  'backup_images',
  {
    storeId: text().notNull(),
    sha256: text().notNull(),
    pathname: text().notNull(),
    contentType: text({ enum: ['image/png', 'image/jpeg'] }).notNull(),
    byteSize: bigint({ mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.sha256] }),
    unique('backup_images_store_pathname_uq').on(t.storeId, t.pathname),
    check('backup_images_store_id_length', sql`length(${t.storeId}) between 1 and 300`),
    check('backup_images_sha256_hex', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('backup_images_content_type_valid', sql`${t.contentType} in ('image/png', 'image/jpeg')`),
    check('backup_images_byte_size_nonnegative', sql`${t.byteSize} >= 0`),
  ],
)

/**
 * Wrong-guess counts behind the login slow-down. One row per scope and address;
 * the row with ip_key '*' counts every address together for that scope.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    scope: text().notNull(),
    ipKey: text().notNull(),
    failures: integer().notNull().default(0),
    windowStart: timestamp({ withTimezone: true }).notNull().defaultNow(),
    blockedUntil: timestamp({ withTimezone: true }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.ipKey] }), index('login_attempts_updated_idx').on(t.updatedAt)],
)
