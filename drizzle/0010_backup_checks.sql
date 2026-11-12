ALTER TABLE "backups" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN "unreadable_at" timestamp with time zone;