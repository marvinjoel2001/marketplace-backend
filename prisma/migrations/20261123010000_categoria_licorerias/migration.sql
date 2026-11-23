-- Categoría para licorerías (alcohol, bolo y bebidas). Idempotente: no duplica si ya existe.
INSERT INTO "Category" ("id", "name", "slug", "icon", "order")
VALUES ('cat_licorerias', 'Licorerías', 'licorerias', 'Wine', 12)
ON CONFLICT ("slug") DO NOTHING;
