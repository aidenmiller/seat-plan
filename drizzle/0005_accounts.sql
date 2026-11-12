CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"wedding_id" uuid,
	"subject_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	CONSTRAINT "activity_events_detail_object" CHECK (jsonb_typeof("activity_events"."detail") = 'object')
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"wedding_id" uuid,
	"role" text,
	"email" text,
	"note" text,
	"invited_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invites_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "invites_token_hash_length" CHECK (length("invites"."token_hash") = 64),
	CONSTRAINT "invites_role_valid" CHECK ("invites"."role" is null or "invites"."role" in ('owner', 'editor')),
	CONSTRAINT "invites_email_normalized" CHECK ("invites"."email" is null or "invites"."email" = lower(btrim("invites"."email"))),
	CONSTRAINT "invites_note_length" CHECK ("invites"."note" is null or length("invites"."note") <= 200),
	CONSTRAINT "invites_wedding_and_role_together" CHECK (("invites"."wedding_id" is null) = ("invites"."role" is null))
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "password_resets_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "password_resets_token_hash_length" CHECK (length("password_resets"."token_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "sessions_token_hash_length" CHECK (length("sessions"."token_hash") = 64),
	CONSTRAINT "sessions_user_agent_length" CHECK ("sessions"."user_agent" is null or length("sessions"."user_agent") <= 200)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_uq" UNIQUE("email"),
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_display_name_length" CHECK (length(btrim("users"."display_name")) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "wedding_members" (
	"wedding_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wedding_members_wedding_id_user_id_pk" PRIMARY KEY("wedding_id","user_id"),
	CONSTRAINT "wedding_members_role_valid" CHECK ("wedding_members"."role" in ('owner', 'editor'))
);
--> statement-breakpoint
ALTER TABLE "layouts" ADD COLUMN "edited_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "layouts" ADD COLUMN "edited_by_name" text;--> statement-breakpoint
ALTER TABLE "venue_templates" ADD COLUMN "edited_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "venue_templates" ADD COLUMN "edited_by_name" text;--> statement-breakpoint
ALTER TABLE "venue_templates" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "venue_templates" ADD COLUMN "is_library" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_members" ADD CONSTRAINT "wedding_members_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_members" ADD CONSTRAINT "wedding_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_members" ADD CONSTRAINT "wedding_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_dedupe_uq" ON "activity_events" USING btree ("dedupe_key") WHERE "activity_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "activity_events_occurred_idx" ON "activity_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_user_idx" ON "activity_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_wedding_idx" ON "activity_events" USING btree ("wedding_id","occurred_at");--> statement-breakpoint
CREATE INDEX "invites_wedding_idx" ON "invites" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_last_seen_idx" ON "users" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "wedding_members_user_idx" ON "wedding_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_templates" ADD CONSTRAINT "venue_templates_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_templates" ADD CONSTRAINT "venue_templates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_templates_owner_idx" ON "venue_templates" USING btree ("owner_user_id") WHERE "venue_templates"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_edited_by_name_length" CHECK ("layouts"."edited_by_name" is null or length("layouts"."edited_by_name") <= 200);--> statement-breakpoint
ALTER TABLE "venue_templates" ADD CONSTRAINT "venue_templates_edited_by_name_length" CHECK ("venue_templates"."edited_by_name" is null or length("venue_templates"."edited_by_name") <= 200);