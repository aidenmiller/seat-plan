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

export const weddings = pgTable(
  'weddings',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    date: date({ mode: 'string' }),
    unit: text({ enum: ['ft', 'm'] }).notNull().default('ft'),
    minGapCm: real().notNull().default(152.4),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('weddings_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('weddings_unit_valid', sql`${t.unit} in ('ft', 'm')`),
    check('weddings_min_gap_positive', sql`${t.minGapCm} > 0`),
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
    side: text({ enum: ['Noa', 'Aiden', 'Both'] }).notNull().default('Both'),
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
    check('guests_side_valid', sql`${t.side} in ('Noa', 'Aiden', 'Both')`),
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
