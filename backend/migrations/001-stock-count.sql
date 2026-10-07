CREATE TABLE locations (warehouse text NOT NULL, id text NOT NULL, PRIMARY KEY (warehouse,id));
CREATE TABLE stock_counts (
 id uuid PRIMARY KEY, warehouse text NOT NULL, location text NOT NULL,
 status text NOT NULL CHECK (status IN ('COUNTING','COUNTED','VERIFIED','APPROVED','COMPLETED','CANCELLED')),
 counted_by text NOT NULL, verified_by text, approved_by text,
 correction_of uuid REFERENCES stock_counts(id), started_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (warehouse,location) REFERENCES locations(warehouse,id)
);
CREATE UNIQUE INDEX one_active_count ON stock_counts(warehouse,location) WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE TABLE stock_count_lines (
 count_id uuid REFERENCES stock_counts(id), product text NOT NULL, batch text NOT NULL DEFAULT '',
 system_quantity integer NOT NULL CHECK (system_quantity >= 0), counted_quantity integer CHECK (counted_quantity >= 0),
 reason text CHECK (reason IN ('miscount','damaged','wrong_location','unrecorded_transaction','missing','other')),
 explanation text, PRIMARY KEY(count_id,product,batch)
);
CREATE TABLE adjustments (
 id uuid PRIMARY KEY, count_id uuid NOT NULL UNIQUE REFERENCES stock_counts(id),
 status text NOT NULL CHECK (status IN ('PENDING','POSTED','CANCELLED')),
 approved_by text, posted_at timestamptz
);
CREATE TABLE adjustment_lines (
 adjustment_id uuid REFERENCES adjustments(id), product text NOT NULL, batch text NOT NULL,
 delta integer NOT NULL CHECK (delta <> 0), reason text NOT NULL, explanation text,
 PRIMARY KEY(adjustment_id,product,batch)
);
CREATE TABLE inventory_ledger (
 id uuid PRIMARY KEY, warehouse text NOT NULL, location text NOT NULL, product text NOT NULL, batch text NOT NULL DEFAULT '',
 delta integer NOT NULL CHECK (delta <> 0), adjustment_id uuid REFERENCES adjustments(id),
 actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(warehouse,location) REFERENCES locations(warehouse,id), UNIQUE(adjustment_id,product,batch)
);
CREATE TABLE audit_events (id uuid PRIMARY KEY, document uuid NOT NULL, actor text NOT NULL, action text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE command_receipts (key text PRIMARY KEY, fingerprint text NOT NULL, result jsonb NOT NULL);
CREATE FUNCTION deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only record'; END $$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER adjustment_lines_immutable BEFORE UPDATE OR DELETE ON adjustment_lines FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION protect_count_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Count history cannot be deleted'; END IF;
 IF TG_OP = 'UPDATE' AND (NEW.count_id,NEW.product,NEW.batch,NEW.system_quantity) IS DISTINCT FROM (OLD.count_id,OLD.product,OLD.batch,OLD.system_quantity) THEN RAISE EXCEPTION 'Snapshot immutable'; END IF;
 IF (SELECT status FROM stock_counts WHERE id=NEW.count_id) NOT IN ('COUNTING','COUNTED') THEN RAISE EXCEPTION 'Count lines locked'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER count_line_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_count_lines FOR EACH ROW EXECUTE FUNCTION protect_count_line();
CREATE FUNCTION protect_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Document history cannot be deleted'; END IF;
 IF (TG_TABLE_NAME='stock_counts' AND OLD.status IN ('COMPLETED','CANCELLED')) OR (TG_TABLE_NAME='adjustments' AND OLD.status IN ('POSTED','CANCELLED')) THEN RAISE EXCEPTION 'Document locked'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER count_document_guard BEFORE UPDATE OR DELETE ON stock_counts FOR EACH ROW EXECUTE FUNCTION protect_document();
CREATE TRIGGER adjustment_document_guard BEFORE UPDATE OR DELETE ON adjustments FOR EACH ROW EXECUTE FUNCTION protect_document();
CREATE FUNCTION guard_ledger_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active uuid;
BEGIN
 PERFORM 1 FROM locations WHERE warehouse=NEW.warehouse AND id=NEW.location FOR UPDATE;
 SELECT id INTO active FROM stock_counts WHERE warehouse=NEW.warehouse AND location=NEW.location AND status NOT IN ('COMPLETED','CANCELLED');
 IF active IS NOT NULL AND NOT EXISTS (SELECT 1 FROM adjustments a JOIN adjustment_lines l ON l.adjustment_id=a.id WHERE a.id=NEW.adjustment_id AND a.count_id=active AND a.status='PENDING' AND l.product=NEW.product AND l.batch=NEW.batch AND l.delta=NEW.delta) THEN RAISE EXCEPTION 'Location frozen'; END IF;
 IF COALESCE((SELECT sum(delta) FROM inventory_ledger WHERE warehouse=NEW.warehouse AND location=NEW.location AND product=NEW.product AND batch=NEW.batch),0)+NEW.delta < 0 THEN RAISE EXCEPTION 'Negative stock'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_insert_guard BEFORE INSERT ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION guard_ledger_insert();
