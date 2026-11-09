CREATE TABLE "group_members" (
	"wedding_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_guest_id_pk" PRIMARY KEY("group_id","guest_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_wedding_id_id_uq" UNIQUE("wedding_id","id"),
	CONSTRAINT "groups_name_not_blank" CHECK (length(btrim("groups"."name")) > 0),
	CONSTRAINT "groups_color_hex" CHECK ("groups"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"nickname" text,
	"partner_id" uuid,
	"couple_rule_enabled" boolean DEFAULT true NOT NULL,
	"household" text,
	"side" text DEFAULT 'Both' NOT NULL,
	"rsvp" text DEFAULT 'pending' NOT NULL,
	"meal" text,
	"is_child" boolean DEFAULT false NOT NULL,
	"notes" text,
	"name_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "guests_wedding_id_id_uq" UNIQUE("wedding_id","id"),
	CONSTRAINT "guests_first_name_not_blank" CHECK (length(btrim("guests"."first_name")) > 0),
	CONSTRAINT "guests_last_name_not_blank" CHECK (length(btrim("guests"."last_name")) > 0),
	CONSTRAINT "guests_side_valid" CHECK ("guests"."side" in ('Noa', 'Aiden', 'Both')),
	CONSTRAINT "guests_rsvp_valid" CHECK ("guests"."rsvp" in ('yes', 'no', 'pending')),
	CONSTRAINT "guests_partner_not_self" CHECK ("guests"."partner_id" is null or "guests"."partner_id" <> "guests"."id")
);
--> statement-breakpoint
CREATE TABLE "layout_seats" (
	"wedding_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"item_label" text NOT NULL,
	"seat_index" integer NOT NULL,
	CONSTRAINT "layout_seats_layout_id_guest_id_pk" PRIMARY KEY("layout_id","guest_id"),
	CONSTRAINT "layout_seats_seat_uq" UNIQUE("layout_id","item_id","seat_index"),
	CONSTRAINT "layout_seats_index_nonnegative" CHECK ("layout_seats"."seat_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"venue_template_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"last_save_id" uuid,
	"edited_by" text,
	"canvas" jsonb NOT NULL,
	"thumb_svg" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "layouts_wedding_id_id_uq" UNIQUE("wedding_id","id"),
	CONSTRAINT "layouts_name_not_blank" CHECK (length(btrim("layouts"."name")) > 0),
	CONSTRAINT "layouts_kind_valid" CHECK ("layouts"."kind" in ('reception', 'ceremony')),
	CONSTRAINT "layouts_version_positive" CHECK ("layouts"."version" >= 1),
	CONSTRAINT "layouts_edited_by_valid" CHECK ("layouts"."edited_by" is null or "layouts"."edited_by" in ('Noa', 'Aiden')),
	CONSTRAINT "layouts_canvas_object" CHECK (jsonb_typeof("layouts"."canvas") = 'object')
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"scope" text NOT NULL,
	"ip_key" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_attempts_scope_ip_key_pk" PRIMARY KEY("scope","ip_key")
);
--> statement-breakpoint
CREATE TABLE "rule_guests" (
	"wedding_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	CONSTRAINT "rule_guests_rule_id_guest_id_pk" PRIMARY KEY("rule_id","guest_id")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"next_to_each_other" boolean DEFAULT false NOT NULL,
	"applies_to" text DEFAULT 'both' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_wedding_id_id_uq" UNIQUE("wedding_id","id"),
	CONSTRAINT "rules_kind_valid" CHECK ("rules"."kind" in ('together', 'apart')),
	CONSTRAINT "rules_applies_to_valid" CHECK ("rules"."applies_to" in ('reception', 'ceremony', 'both')),
	CONSTRAINT "rules_next_only_together" CHECK ("rules"."kind" = 'together' or not "rules"."next_to_each_other")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"token" text NOT NULL,
	"password_hash" text NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"show_names" boolean DEFAULT true NOT NULL,
	"show_notes" boolean DEFAULT false NOT NULL,
	"last_opened_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_length" CHECK (length("share_links"."token") >= 43)
);
--> statement-breakpoint
CREATE TABLE "venue_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_images_content_type_valid" CHECK ("venue_images"."content_type" in ('image/png', 'image/jpeg')),
	CONSTRAINT "venue_images_size_cap" CHECK (octet_length("venue_images"."bytes") <= 4194304)
);
--> statement-breakpoint
CREATE TABLE "venue_template_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"fixed_items" jsonb NOT NULL,
	"reference_image_id" uuid,
	"reference" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_template_revisions_reason_valid" CHECK ("venue_template_revisions"."reason" in ('save', 'import'))
);
--> statement-breakpoint
CREATE TABLE "venue_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"fixed_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reference_image_id" uuid,
	"reference" jsonb,
	"imported_by" text DEFAULT 'hand' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_save_id" uuid,
	"edited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "venue_templates_name_not_blank" CHECK (length(btrim("venue_templates"."name")) > 0),
	CONSTRAINT "venue_templates_fixed_items_array" CHECK (jsonb_typeof("venue_templates"."fixed_items") = 'array'),
	CONSTRAINT "venue_templates_imported_by_valid" CHECK ("venue_templates"."imported_by" in ('hand', 'pdf vectors', 'ai')),
	CONSTRAINT "venue_templates_version_positive" CHECK ("venue_templates"."version" >= 1),
	CONSTRAINT "venue_templates_edited_by_valid" CHECK ("venue_templates"."edited_by" is null or "venue_templates"."edited_by" in ('Noa', 'Aiden'))
);
--> statement-breakpoint
CREATE TABLE "weddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"date" date,
	"unit" text DEFAULT 'ft' NOT NULL,
	"min_gap_cm" real DEFAULT 152.4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "weddings_name_not_blank" CHECK (length(btrim("weddings"."name")) > 0),
	CONSTRAINT "weddings_unit_valid" CHECK ("weddings"."unit" in ('ft', 'm')),
	CONSTRAINT "weddings_min_gap_positive" CHECK ("weddings"."min_gap_cm" > 0)
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_fk" FOREIGN KEY ("wedding_id","group_id") REFERENCES "public"."groups"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_guest_fk" FOREIGN KEY ("wedding_id","guest_id") REFERENCES "public"."guests"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_partner_fk" FOREIGN KEY ("wedding_id","partner_id") REFERENCES "public"."guests"("wedding_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_seats" ADD CONSTRAINT "layout_seats_layout_fk" FOREIGN KEY ("wedding_id","layout_id") REFERENCES "public"."layouts"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_seats" ADD CONSTRAINT "layout_seats_guest_fk" FOREIGN KEY ("wedding_id","guest_id") REFERENCES "public"."guests"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_venue_template_id_venue_templates_id_fk" FOREIGN KEY ("venue_template_id") REFERENCES "public"."venue_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_guests" ADD CONSTRAINT "rule_guests_rule_fk" FOREIGN KEY ("wedding_id","rule_id") REFERENCES "public"."rules"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_guests" ADD CONSTRAINT "rule_guests_guest_fk" FOREIGN KEY ("wedding_id","guest_id") REFERENCES "public"."guests"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_layout_fk" FOREIGN KEY ("wedding_id","layout_id") REFERENCES "public"."layouts"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_images" ADD CONSTRAINT "venue_images_template_id_venue_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."venue_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_template_revisions" ADD CONSTRAINT "venue_template_revisions_template_id_venue_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."venue_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_templates" ADD CONSTRAINT "venue_templates_reference_image_id_venue_images_id_fk" FOREIGN KEY ("reference_image_id") REFERENCES "public"."venue_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_members_guest_idx" ON "group_members" USING btree ("guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_wedding_name_uq" ON "groups" USING btree ("wedding_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "guests_partner_live_uq" ON "guests" USING btree ("partner_id") WHERE "guests"."partner_id" is not null and "guests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "guests_wedding_live_idx" ON "guests" USING btree ("wedding_id") WHERE "guests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "guests_wedding_name_key_idx" ON "guests" USING btree ("wedding_id","name_key");--> statement-breakpoint
CREATE INDEX "layout_seats_guest_idx" ON "layout_seats" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "layouts_wedding_live_idx" ON "layouts" USING btree ("wedding_id","updated_at") WHERE "layouts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "layouts_template_idx" ON "layouts" USING btree ("venue_template_id");--> statement-breakpoint
CREATE INDEX "login_attempts_updated_idx" ON "login_attempts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "rule_guests_guest_idx" ON "rule_guests" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "rules_wedding_idx" ON "rules" USING btree ("wedding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_uq" ON "share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "share_links_layout_idx" ON "share_links" USING btree ("layout_id");--> statement-breakpoint
CREATE INDEX "share_links_wedding_idx" ON "share_links" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "venue_images_template_idx" ON "venue_images" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "venue_template_revisions_template_idx" ON "venue_template_revisions" USING btree ("template_id","created_at");