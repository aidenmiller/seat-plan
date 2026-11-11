-- Names from before accounts: copy the old "Noa" / "Aiden" label into the new name column.
-- Raw SQL does not run drizzle's $onUpdate, so updated_at stays as it was.
UPDATE "layouts" SET "edited_by_name" = "edited_by" WHERE "edited_by_name" IS NULL AND "edited_by" IS NOT NULL;
--> statement-breakpoint
UPDATE "venue_templates" SET "edited_by_name" = "edited_by" WHERE "edited_by_name" IS NULL AND "edited_by" IS NOT NULL;
--> statement-breakpoint
-- Templates from before accounts belong to no one. The Toronto Beach Club joins the shared library.
UPDATE "venue_templates" SET "is_library" = true WHERE "name" = 'Toronto Beach Club' AND "owner_user_id" IS NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
-- A wedding that has members must keep an owner. Removing or demoting the last owner fails at COMMIT.
-- The check runs once per changed row, deferred to the end of the transaction, and looks at the state
-- left at that point, so:
--   * Transferring ownership inside one transaction works: the old owner is demoted and the new one
--     promoted, and by commit an owner exists.
--   * Removing or demoting an owner while another owner remains works.
--   * Deleting a whole wedding works: the cascade deletes its members, but the wedding row is gone at
--     commit, so there is nothing left to protect.
--   * A wedding that never had any members (rows from before accounts, or made by older code) stays
--     legal. The check only fires when a member row is deleted or changed, so such a wedding is never
--     looked at. The rule is "do not remove the last owner", not "every wedding must have members".
--   * Removing the only member of a wedding, when that member is the owner, fails: that is removing the
--     last owner.
-- Only an owner's old row matters (an editor row changing cannot take away an owner), so editor rows return early.
CREATE OR REPLACE FUNCTION "wedding_members_keep_an_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."role" = 'owner'
     AND EXISTS (SELECT 1 FROM "weddings" WHERE "id" = OLD."wedding_id")
     AND NOT EXISTS (SELECT 1 FROM "wedding_members" WHERE "wedding_id" = OLD."wedding_id" AND "role" = 'owner') THEN
    RAISE EXCEPTION 'wedding % would have no owner', OLD."wedding_id" USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "wedding_members_keep_an_owner" AFTER UPDATE OR DELETE ON "wedding_members"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "wedding_members_keep_an_owner"();
