CREATE TYPE "public"."connection_status" AS ENUM('active', 'needs_reauth', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."credential_mode" AS ENUM('byo', 'central');--> statement-breakpoint
CREATE TYPE "public"."match_decided_by" AS ENUM('auto', 'user');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('isrc', 'metadata', 'manual');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('spotify', 'ytmusic', 'soundcloud');--> statement-breakpoint
CREATE TYPE "public"."sync_resource" AS ENUM('liked', 'playlists', 'playlist_tracks');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "authenticators" (
	"credential_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"credential_public_key" text NOT NULL,
	"counter" integer NOT NULL,
	"credential_device_type" text NOT NULL,
	"credential_backed_up" boolean NOT NULL,
	"transports" text,
	CONSTRAINT "authenticators_user_id_credential_id_pk" PRIMARY KEY("user_id","credential_id"),
	CONSTRAINT "authenticators_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"display_name" text,
	"credential_mode" "credential_mode" NOT NULL,
	"client_id_encrypted" text,
	"client_secret_encrypted" text,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"connection_id" uuid NOT NULL,
	"provider_track_id" uuid NOT NULL,
	"added_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_items_connection_id_provider_track_id_pk" PRIMARY KEY("connection_id","provider_track_id")
);
--> statement-breakpoint
CREATE TABLE "match_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"source_track_id" uuid NOT NULL,
	"target_provider" "provider" NOT NULL,
	"target_provider_track_id" uuid,
	"confidence" double precision NOT NULL,
	"method" "match_method" NOT NULL,
	"decided_by" "match_decided_by" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlist_tracks" (
	"playlist_id" uuid NOT NULL,
	"provider_track_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone,
	CONSTRAINT "playlist_tracks_playlist_id_position_pk" PRIMARY KEY("playlist_id","position")
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"track_count" integer,
	"is_owned" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"snapshot_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_id" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at_ms" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"resource" "sync_resource" NOT NULL,
	"resource_id" text,
	"status" "sync_status" DEFAULT 'queued' NOT NULL,
	"cursor" text,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isrc" text,
	"title" text NOT NULL,
	"artists" text[] NOT NULL,
	"album" text,
	"duration_ms" integer,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authenticators" ADD CONSTRAINT "authenticators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_provider_track_id_provider_tracks_id_fk" FOREIGN KEY ("provider_track_id") REFERENCES "public"."provider_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_source_track_id_tracks_id_fk" FOREIGN KEY ("source_track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_decisions" ADD CONSTRAINT "match_decisions_target_provider_track_id_provider_tracks_id_fk" FOREIGN KEY ("target_provider_track_id") REFERENCES "public"."provider_tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_provider_track_id_provider_tracks_id_fk" FOREIGN KEY ("provider_track_id") REFERENCES "public"."provider_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_tracks" ADD CONSTRAINT "provider_tracks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_provider_idx" ON "connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "library_items_connection_idx" ON "library_items" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_decisions_scope_idx" ON "match_decisions" USING btree ("source_track_id","target_provider","user_id");--> statement-breakpoint
CREATE INDEX "playlist_tracks_provider_track_idx" ON "playlist_tracks" USING btree ("provider_track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playlists_connection_provider_id_idx" ON "playlists" USING btree ("connection_id","provider_id");--> statement-breakpoint
CREATE INDEX "playlists_connection_idx" ON "playlists" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_tracks_provider_id_idx" ON "provider_tracks" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX "provider_tracks_track_id_idx" ON "provider_tracks" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_status_idx" ON "sync_runs" USING btree ("connection_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_isrc_idx" ON "tracks" USING btree ("isrc") WHERE "tracks"."isrc" is not null;--> statement-breakpoint
CREATE INDEX "tracks_dedupe_key_idx" ON "tracks" USING btree ("dedupe_key");