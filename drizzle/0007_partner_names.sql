ALTER TABLE "weddings" ADD COLUMN "partner1_name" text;
--> statement-breakpoint
ALTER TABLE "weddings" ADD COLUMN "partner2_name" text;
--> statement-breakpoint
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_partner1_name_valid" CHECK ("weddings"."partner1_name" is null or length(btrim("weddings"."partner1_name")) between 1 and 60);
--> statement-breakpoint
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_partner2_name_valid" CHECK ("weddings"."partner2_name" is null or length(btrim("weddings"."partner2_name")) between 1 and 60);
--> statement-breakpoint
-- Every wedding so far is Noa and Aiden's.
-- Raw SQL does not run drizzle's $onUpdate, so updated_at stays as it was.
UPDATE "weddings" SET "partner1_name" = 'Noa', "partner2_name" = 'Aiden' WHERE "partner1_name" IS NULL AND "partner2_name" IS NULL;
--> statement-breakpoint
ALTER TABLE "guests" DROP CONSTRAINT "guests_side_valid";
--> statement-breakpoint
-- Old values stay allowed for one release, so the deployment still serving during the build keeps working.
ALTER TABLE "guests" ADD CONSTRAINT "guests_side_valid" CHECK ("guests"."side" in ('partner1', 'partner2', 'both', 'Noa', 'Aiden', 'Both'));
--> statement-breakpoint
-- Sides become positions: Noa is partner 1, Aiden partner 2. updated_at stays as it was here too.
UPDATE "guests" SET "side" = CASE "side" WHEN 'Noa' THEN 'partner1' WHEN 'Aiden' THEN 'partner2' ELSE 'both' END WHERE "side" IN ('Noa', 'Aiden', 'Both');
--> statement-breakpoint
ALTER TABLE "guests" ALTER COLUMN "side" SET DEFAULT 'both';
