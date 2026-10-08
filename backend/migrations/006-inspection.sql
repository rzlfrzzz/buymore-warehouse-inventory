ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
UPDATE memberships SET role=CASE WHEN role IN ('Admin','Head','System Admin') THEN 'Admin' ELSE 'User' END;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK(role IN ('Admin','User'));
-- Existing sessions are invalidated because their authorization model has changed.
DELETE FROM sessions;
CREATE TABLE inspection_photos(id uuid PRIMARY KEY, warehouse text NOT NULL, owner uuid NOT NULL REFERENCES users(id), mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png')), content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 2097152), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE inspections(id uuid PRIMARY KEY, warehouse text NOT NULL, location text NOT NULL, product text NOT NULL, batch text NOT NULL, quantity integer NOT NULL CHECK(quantity>=0), unit text NOT NULL, factor integer NOT NULL CHECK(factor>0), base_quantity integer NOT NULL CHECK(base_quantity>=0), snapshot integer NOT NULL CHECK(snapshot>=0), photo uuid NOT NULL UNIQUE REFERENCES inspection_photos(id), created_by uuid NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')), reviewed_by uuid REFERENCES users(id), reason text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, FOREIGN KEY(warehouse,location) REFERENCES locations(warehouse,id), FOREIGN KEY(product,batch) REFERENCES product_batches(product,batch));
CREATE INDEX inspections_warehouse_status ON inspections(warehouse,status,created_at);
CREATE INDEX inspection_photo_owner ON inspection_photos(warehouse,owner);
CREATE TABLE master_imports(id uuid PRIMARY KEY, warehouse text NOT NULL, checksum text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), row_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(warehouse,checksum));
CREATE TRIGGER inspection_photo_immutable BEFORE UPDATE OR DELETE ON inspection_photos FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION protect_inspection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'PENDING' THEN RAISE EXCEPTION 'Inspection history locked'; END IF;
 IF (NEW.id,NEW.warehouse,NEW.location,NEW.product,NEW.batch,NEW.quantity,NEW.unit,NEW.factor,NEW.base_quantity,NEW.snapshot,NEW.photo,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.warehouse,OLD.location,OLD.product,OLD.batch,OLD.quantity,OLD.unit,OLD.factor,OLD.base_quantity,OLD.snapshot,OLD.photo,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Inspection evidence immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inspection_immutable BEFORE UPDATE OR DELETE ON inspections FOR EACH ROW EXECUTE FUNCTION protect_inspection();
-- Units are historical semantics, not a display preference. Preserve ledger/count meaning.
CREATE FUNCTION protect_product_units() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.uom,NEW.uom_factor) IS DISTINCT FROM (OLD.uom,OLD.uom_factor) AND (
 EXISTS(SELECT 1 FROM inventory_ledger WHERE product=OLD.code) OR
 EXISTS(SELECT 1 FROM operation_document_lines WHERE product=OLD.code) OR
 EXISTS(SELECT 1 FROM stock_count_lines WHERE product=OLD.code) OR
 EXISTS(SELECT 1 FROM inspections WHERE product=OLD.code)) THEN
 RAISE EXCEPTION 'Unit conversion has history; create a new SKU instead'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER product_unit_history BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION protect_product_units();

ALTER TABLE inventory_ledger ADD COLUMN inspection_id uuid UNIQUE REFERENCES inspections(id);
ALTER TABLE inventory_ledger ADD COLUMN master_import_id uuid REFERENCES master_imports(id);
