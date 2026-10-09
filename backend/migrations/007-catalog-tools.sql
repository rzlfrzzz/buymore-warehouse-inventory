-- Preserve external SKU spelling and leading zeros; never normalize identifiers.
ALTER TABLE products DROP CONSTRAINT products_check;
ALTER TABLE products ADD CONSTRAINT products_check CHECK(legacy OR (code=btrim(code) AND code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'));
CREATE TABLE product_reference_photos (
 warehouse text NOT NULL, product text NOT NULL REFERENCES products(code),
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 2097152),
 updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(warehouse,product)
);
-- New evidence and movements must not resurrect an archived catalog entry.
CREATE FUNCTION require_active_product() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM products WHERE code=NEW.product AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product is archived or unknown'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inspection_active_product BEFORE INSERT ON inspections FOR EACH ROW EXECUTE FUNCTION require_active_product();
CREATE TRIGGER ledger_active_product BEFORE INSERT ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION require_active_product();
CREATE TRIGGER operation_active_product BEFORE INSERT ON operation_document_lines FOR EACH ROW EXECUTE FUNCTION require_active_product();
CREATE TRIGGER reservation_active_product BEFORE INSERT ON inventory_reservations FOR EACH ROW EXECUTE FUNCTION require_active_product();
CREATE TRIGGER count_active_product BEFORE INSERT ON stock_count_lines FOR EACH ROW EXECUTE FUNCTION require_active_product();
