/**
 * Timbre's schema.
 *
 * Two vocabularies of "account" coexist here, and keeping them apart matters:
 *
 *   `users` / `accounts` / `sessions`  — Auth.js. Who is logged in to Timbre.
 *   `connections`                      — a link to Spotify / YT Music / SoundCloud.
 *
 * Timbre deliberately does not use Spotify as a login provider. Spotify is a
 * BYO connection that a user may never add, or may disconnect, and losing your
 * login because you unlinked a music service would be indefensible.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
/**
 * Mirrors Auth.js's `AdapterAccountType`. Inlined rather than imported so that
 * the database package carries no dependency on the web framework's auth library.
 */
type AdapterAccountType = "oauth" | "oidc" | "email" | "webauthn";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Auth.js — shape dictated by @auth/drizzle-adapter
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const authenticators = pgTable(
  "authenticators",
  {
    credentialID: text("credential_id").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").notNull(),
    credentialPublicKey: text("credential_public_key").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credential_device_type").notNull(),
    credentialBackedUp: boolean("credential_backed_up").notNull(),
    transports: text("transports"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.credentialID] })],
);

// ---------------------------------------------------------------------------
// Music service connections
// ---------------------------------------------------------------------------

export const providerEnum = pgEnum("provider", ["spotify", "ytmusic", "soundcloud"]);
export const credentialModeEnum = pgEnum("credential_mode", ["byo", "central"]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  /** Token refresh failed or scopes changed; the user must reconnect. */
  "needs_reauth",
  /** User revoked access at the provider, or deleted their BYO app. */
  "revoked",
]);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    /** The user's identifier on that service. */
    providerAccountId: text("provider_account_id").notNull(),
    /** Their handle there, shown in the UI so multiple links are tellable apart. */
    displayName: text("display_name"),
    credentialMode: credentialModeEnum("credential_mode").notNull(),

    // All four are AES-256-GCM envelopes from @timbre/core, never plaintext.
    // client_* are null for `central` providers, where Timbre holds the app.
    clientIdEncrypted: text("client_id_encrypted"),
    clientSecretEncrypted: text("client_secret_encrypted"),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scope: text("scope"),
    status: connectionStatusEnum("status").notNull().default("active"),
    /** Last failure message, surfaced in the UI so a dead link is explainable. */
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One link per service per user. Multi-account support is a Phase 3 concern.
    uniqueIndex("connections_user_provider_idx").on(table.userId, table.provider),
  ],
);

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

/**
 * A recording, deduplicated across every user and service. Global rather than
 * per-user so that a match computed once is reusable, which matters when
 * Spotify search costs a request per lookup.
 */
export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The only globally reliable join key. Absent on most of YouTube Music. */
    isrc: text("isrc"),
    title: text("title").notNull(),
    artists: text("artists").array().notNull(),
    album: text("album"),
    durationMs: integer("duration_ms"),
    /** From @timbre/core `dedupeKey`. The fallback identity when ISRC is null. */
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Partial unique: ISRC identifies a recording, but null must not collide.
    uniqueIndex("tracks_isrc_idx").on(table.isrc).where(sql`${table.isrc} is not null`),
    index("tracks_dedupe_key_idx").on(table.dedupeKey),
  ],
);

/**
 * How one recording appears on one service. Global, keyed by the service's own
 * id — the same Spotify track referenced by a thousand users is one row.
 */
export const providerTracks = pgTable(
  "provider_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    providerId: text("provider_id").notNull(),
    url: text("url"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("provider_tracks_provider_id_idx").on(table.provider, table.providerId),
    index("provider_tracks_track_id_idx").on(table.trackId),
  ],
);

/**
 * A user's saved/liked songs. Separate from `provider_tracks` because the
 * track is global but the act of saving it is personal.
 */
export const libraryItems = pgTable(
  "library_items",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    providerTrackId: uuid("provider_track_id")
      .notNull()
      .references(() => providerTracks.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.providerTrackId] }),
    index("library_items_connection_idx").on(table.connectionId),
  ],
);

export const playlists = pgTable(
  "playlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    providerId: text("provider_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    trackCount: integer("track_count"),
    /** False for playlists the user follows but does not own. */
    isOwned: boolean("is_owned").notNull().default(false),
    imageUrl: text("image_url"),
    /**
     * Provider-supplied version marker (Spotify's snapshot_id). When it is
     * unchanged since the last run, the whole playlist can be skipped — the
     * cheapest possible win against a per-request quota.
     */
    snapshotId: text("snapshot_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("playlists_connection_provider_id_idx").on(table.connectionId, table.providerId),
    index("playlists_connection_idx").on(table.connectionId),
  ],
);

export const playlistTracks = pgTable(
  "playlist_tracks",
  {
    playlistId: uuid("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    providerTrackId: uuid("provider_track_id")
      .notNull()
      .references(() => providerTracks.id, { onDelete: "cascade" }),
    /** Playlist order is meaningful and must survive a transfer. */
    position: integer("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }),
  },
  (table) => [
    // Keyed by position, not by track: a playlist may legitimately contain the
    // same track twice.
    primaryKey({ columns: [table.playlistId, table.position] }),
    index("playlist_tracks_provider_track_idx").on(table.providerTrackId),
  ],
);

// ---------------------------------------------------------------------------
// Sync bookkeeping
// ---------------------------------------------------------------------------

export const syncResourceEnum = pgEnum("sync_resource", [
  "liked",
  "playlists",
  "playlist_tracks",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * One row per ingest attempt. `cursor` is what makes a run resumable: a sync
 * killed halfway through a 2,000-track Spotify library picks up where it
 * stopped instead of spending the quota again.
 */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    resource: syncResourceEnum("resource").notNull(),
    /** Set when `resource` is `playlist_tracks`. */
    resourceId: text("resource_id"),
    status: syncStatusEnum("status").notNull().default("queued"),
    /** Opaque provider continuation token; persisted verbatim. */
    cursor: text("cursor"),
    itemsSeen: integer("items_seen").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("sync_runs_connection_status_idx").on(table.connectionId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Matching (Phase 2)
// ---------------------------------------------------------------------------

export const matchMethodEnum = pgEnum("match_method", ["isrc", "metadata", "manual"]);
export const matchDecidedByEnum = pgEnum("match_decided_by", ["auto", "user"]);

/**
 * A recorded conclusion about "this recording, over on that service".
 * Persisted so a re-run never re-asks the user a question they already
 * answered, and never re-spends search quota on a settled lookup.
 */
export const matchDecisions = pgTable(
  "match_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for a global/automatic decision; set when a user overrode it. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    sourceTrackId: uuid("source_track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    targetProvider: providerEnum("target_provider").notNull(),
    /** Null records a confirmed absence — "not available there" is an answer. */
    targetProviderTrackId: uuid("target_provider_track_id").references(
      () => providerTracks.id,
      { onDelete: "set null" },
    ),
    confidence: doublePrecision("confidence").notNull(),
    method: matchMethodEnum("method").notNull(),
    decidedBy: matchDecidedByEnum("decided_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Phase 2 caveat: `user_id` is nullable for global decisions, and Postgres
    // treats NULLs as distinct in a unique index — so this does NOT currently
    // prevent duplicate global rows. Before this table is written to, either add
    // NULLS NOT DISTINCT (Postgres 15+) or split global and per-user decisions
    // into two partial indexes.
    uniqueIndex("match_decisions_scope_idx").on(
      table.sourceTrackId,
      table.targetProvider,
      table.userId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Persisted token buckets backing @timbre/core's RateLimiter. In the database
 * rather than in memory so that pacing survives a restart and is shared by the
 * web process and the ingest worker — two processes with independent buckets
 * would together exceed the limit they each think they are respecting.
 */
export const rateBuckets = pgTable("rate_buckets", {
  /** Typically `<connectionId>:<provider>`. */
  key: text("key").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  updatedAtMs: doublePrecision("updated_at_ms").notNull(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  connections: many(connections),
}));

export const connectionsRelations = relations(connections, ({ one, many }) => ({
  user: one(users, { fields: [connections.userId], references: [users.id] }),
  playlists: many(playlists),
  libraryItems: many(libraryItems),
  syncRuns: many(syncRuns),
}));

export const tracksRelations = relations(tracks, ({ many }) => ({
  providerTracks: many(providerTracks),
}));

export const providerTracksRelations = relations(providerTracks, ({ one, many }) => ({
  track: one(tracks, { fields: [providerTracks.trackId], references: [tracks.id] }),
  libraryItems: many(libraryItems),
  playlistTracks: many(playlistTracks),
}));

export const libraryItemsRelations = relations(libraryItems, ({ one }) => ({
  connection: one(connections, {
    fields: [libraryItems.connectionId],
    references: [connections.id],
  }),
  providerTrack: one(providerTracks, {
    fields: [libraryItems.providerTrackId],
    references: [providerTracks.id],
  }),
}));

export const playlistsRelations = relations(playlists, ({ one, many }) => ({
  connection: one(connections, {
    fields: [playlists.connectionId],
    references: [connections.id],
  }),
  tracks: many(playlistTracks),
}));

export const playlistTracksRelations = relations(playlistTracks, ({ one }) => ({
  playlist: one(playlists, {
    fields: [playlistTracks.playlistId],
    references: [playlists.id],
  }),
  providerTrack: one(providerTracks, {
    fields: [playlistTracks.providerTrackId],
    references: [providerTracks.id],
  }),
}));

export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
  connection: one(connections, {
    fields: [syncRuns.connectionId],
    references: [connections.id],
  }),
}));
