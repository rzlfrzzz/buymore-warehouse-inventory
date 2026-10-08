CREATE TABLE warehouse_product_settings (
 warehouse text NOT NULL,
 product text NOT NULL REFERENCES products(code),
 bigseller_sku text,
 bigseller_registered boolean NOT NULL DEFAULT false,
 PRIMARY KEY(warehouse,product)
);
ALTER TABLE export_jobs ADD COLUMN row_snapshot jsonb NOT NULL DEFAULT '[]';
CREATE TABLE export_adjustment_items (
 job_id uuid NOT NULL REFERENCES export_jobs(id),
 adjustment_id uuid NOT NULL UNIQUE REFERENCES adjustments(id),
 PRIMARY KEY(job_id,adjustment_id)
);
