CREATE TABLE "backup_images" (
	"store_id" text NOT NULL,
	"sha256" text NOT NULL,
	"pathname" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_images_store_id_sha256_pk" PRIMARY KEY("store_id","sha256"),
	CONSTRAINT "backup_images_store_pathname_uq" UNIQUE("store_id","pathname"),
	CONSTRAINT "backup_images_store_id_length" CHECK (length("backup_images"."store_id") between 1 and 300),
	CONSTRAINT "backup_images_sha256_hex" CHECK ("backup_images"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "backup_images_content_type_valid" CHECK ("backup_images"."content_type" in ('image/png', 'image/jpeg')),
	CONSTRAINT "backup_images_byte_size_nonnegative" CHECK ("backup_images"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"backed_up" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remaining" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "backup_runs_trigger_valid" CHECK ("backup_runs"."trigger" in ('cron', 'admin', 'owner')),
	CONSTRAINT "backup_runs_status_valid" CHECK ("backup_runs"."status" in ('running', 'ok', 'partial', 'failed')),
	CONSTRAINT "backup_runs_failures_array" CHECK (jsonb_typeof("backup_runs"."failures") = 'array'),
	CONSTRAINT "backup_runs_counts_nonnegative" CHECK ("backup_runs"."backed_up" >= 0 and "backup_runs"."unchanged" >= 0 and "backup_runs"."failed" >= 0 and "backup_runs"."remaining" >= 0),
	CONSTRAINT "backup_runs_error_length" CHECK ("backup_runs"."error" is null or length("backup_runs"."error") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"wedding_id" uuid NOT NULL,
	"wedding_name" text NOT NULL,
	"kind" text NOT NULL,
	"pathname" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"blob_sha256" text NOT NULL,
	"content_sha256" text NOT NULL,
	"image_sha256s" text[] DEFAULT '{}'::text[] NOT NULL,
	"format_version" integer NOT NULL,
	"guest_count" integer NOT NULL,
	"layout_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"run_id" uuid,
	CONSTRAINT "backups_pathname_uq" UNIQUE("pathname"),
	CONSTRAINT "backups_kind_valid" CHECK ("backups"."kind" in ('nightly', 'manual', 'final')),
	CONSTRAINT "backups_blob_sha256_hex" CHECK ("backups"."blob_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "backups_content_sha256_hex" CHECK ("backups"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "backups_counts_nonnegative" CHECK ("backups"."byte_size" >= 0 and "backups"."guest_count" >= 0 and "backups"."layout_count" >= 0),
	CONSTRAINT "backups_store_id_length" CHECK (length("backups"."store_id") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_run_id_backup_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backup_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_runs_one_running_uq" ON "backup_runs" USING btree ("status") WHERE "backup_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "backup_runs_started_idx" ON "backup_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "backups_wedding_created_idx" ON "backups" USING btree ("wedding_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "backups_created_idx" ON "backups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "backups_image_sha256s_idx" ON "backups" USING gin ("image_sha256s");