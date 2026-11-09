-- The first venue template (spec section 5). It starts empty: the floor plan
-- import fills it once the owners send the plan. Nothing here guesses the layout.
INSERT INTO "venue_templates" ("name", "fixed_items", "imported_by")
SELECT 'Toronto Beach Club', '[]'::jsonb, 'hand'
WHERE NOT EXISTS (
  SELECT 1 FROM "venue_templates" WHERE "name" = 'Toronto Beach Club' AND "deleted_at" IS NULL
);
