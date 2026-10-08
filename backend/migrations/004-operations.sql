DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='memberships_role_check') THEN
  ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
 END IF;
END $$;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK(role IN ('Staff','Admin','Head','Checker'));

ALTER TABLE products ADD COLUMN IF NOT EXISTS track_batch boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_expiry boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS bigseller_sku text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS uom text NOT NULL DEFAULT 'PCS';
ALTER TABLE products ADD COLUMN IF NOT EXISTS uom_factor integer NOT NULL DEFAULT 1 CHECK(uom_factor > 0);
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS expiry date;

CREATE TABLE suppliers(id uuid PRIMARY KEY, warehouse text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(warehouse,name));
CREATE TABLE operation_settings(warehouse text PRIMARY KEY, report_page_size integer NOT NULL DEFAULT 50 CHECK(report_page_size BETWEEN 1 AND 500), report_default_days integer NOT NULL DEFAULT 30 CHECK(report_default_days BETWEEN 1 AND 365), csv_delimiter text NOT NULL DEFAULT ',' CHECK(length(csv_delimiter) BETWEEN 1 AND 3), export_warehouse_name text NOT NULL DEFAULT '', bigseller_template_confirmed boolean NOT NULL DEFAULT false);
CREATE TABLE operation_documents(id uuid PRIMARY KEY, warehouse text NOT NULL, type text NOT NULL CHECK(type IN ('RECEIVING','ISSUE')), status text NOT NULL CHECK(status IN ('DRAFT','PENDING','VERIFIED','REJECTED','EXPORTED')), supplier_id uuid REFERENCES suppliers(id), reference text, created_by uuid NOT NULL REFERENCES users(id), submitted_by uuid REFERENCES users(id), verified_by uuid REFERENCES users(id), rejected_by uuid REFERENCES users(id), reject_reason text, created_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz, verified_at timestamptz, UNIQUE(id,warehouse));
CREATE TABLE operation_document_lines(id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES operation_documents(id), product text NOT NULL, location text NOT NULL, document_quantity integer NOT NULL CHECK(document_quantity >= 0), actual_quantity integer NOT NULL CHECK(actual_quantity >= 0), uom text NOT NULL, base_quantity integer NOT NULL CHECK(base_quantity > 0), batch text NOT NULL DEFAULT '', expiry date, FOREIGN KEY(product,batch) REFERENCES product_batches(product,batch));
ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS operation_document_id uuid REFERENCES operation_documents(id);
CREATE INDEX operation_documents_list ON operation_documents(warehouse,type,created_at DESC,id);
CREATE INDEX operation_lines_doc ON operation_document_lines(document_id);
CREATE TABLE export_jobs(id uuid PRIMARY KEY, warehouse text NOT NULL, type text NOT NULL CHECK(type IN ('PO','SR')), status text NOT NULL CHECK(status IN ('READY','FAILED')), file_name text, content bytea, checksum text, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE export_job_items(job_id uuid NOT NULL REFERENCES export_jobs(id), document_id uuid NOT NULL REFERENCES operation_documents(id), PRIMARY KEY(job_id,document_id), UNIQUE(document_id));
CREATE INDEX export_jobs_list ON export_jobs(warehouse,created_at DESC,id);
CREATE TABLE inventory_reservations(id uuid PRIMARY KEY, warehouse text NOT NULL, location text NOT NULL, product text NOT NULL, batch text NOT NULL DEFAULT '', quantity integer NOT NULL CHECK(quantity > 0), document_id uuid NOT NULL REFERENCES operation_documents(id), status text NOT NULL CHECK(status IN ('ACTIVE','RELEASED','CONSUMED')), created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz, UNIQUE(document_id,product,batch,location));
CREATE INDEX reservations_active_lookup ON inventory_reservations(warehouse,location,product,batch) WHERE status='ACTIVE';
CREATE FUNCTION available_stock(p_warehouse text,p_location text,p_product text,p_batch text) RETURNS integer LANGUAGE sql AS $$
 SELECT COALESCE((SELECT sum(delta)::int FROM inventory_ledger WHERE warehouse=p_warehouse AND location=p_location AND product=p_product AND batch=p_batch),0)-COALESCE((SELECT sum(quantity)::int FROM inventory_reservations WHERE warehouse=p_warehouse AND location=p_location AND product=p_product AND batch=p_batch AND status='ACTIVE'),0)
$$;
DROP TRIGGER IF EXISTS ledger_insert_guard ON inventory_ledger;
CREATE OR REPLACE FUNCTION guard_ledger_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active uuid;
BEGIN
 PERFORM 1 FROM locations WHERE warehouse=NEW.warehouse AND id=NEW.location FOR UPDATE;
 SELECT id INTO active FROM stock_counts WHERE warehouse=NEW.warehouse AND location=NEW.location AND status NOT IN ('COMPLETED','CANCELLED');
 IF active IS NOT NULL AND NOT EXISTS (SELECT 1 FROM adjustments a JOIN adjustment_lines l ON l.adjustment_id=a.id WHERE a.id=NEW.adjustment_id AND a.count_id=active AND a.status='PENDING' AND l.product=NEW.product AND l.batch=NEW.batch AND l.delta=NEW.delta) THEN RAISE EXCEPTION 'Location frozen'; END IF;
 IF COALESCE((SELECT sum(delta) FROM inventory_ledger WHERE warehouse=NEW.warehouse AND location=NEW.location AND product=NEW.product AND batch=NEW.batch),0)+NEW.delta < 0 THEN RAISE EXCEPTION 'Negative stock'; END IF;
 IF NEW.delta < 0 AND available_stock(NEW.warehouse,NEW.location,NEW.product,NEW.batch)+NEW.delta < 0 THEN RAISE EXCEPTION 'Reserved stock unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_insert_guard BEFORE INSERT ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION guard_ledger_insert();

