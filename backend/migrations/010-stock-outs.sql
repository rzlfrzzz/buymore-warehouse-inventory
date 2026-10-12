CREATE TABLE stock_outs (
 id uuid PRIMARY KEY, warehouse text NOT NULL, location text NOT NULL,
 product text NOT NULL, product_name text NOT NULL, batch text NOT NULL,
 unit text NOT NULL, factor integer NOT NULL CHECK(factor>0),
 quantity integer NOT NULL CHECK(quantity>0), base_quantity integer NOT NULL CHECK(base_quantity>0),
 purpose text NOT NULL CHECK(purpose IN ('PRODUCTION','TRANSFER')),
 destination_warehouse text, destination_location text,
 taker text NOT NULL CHECK(length(trim(taker)) BETWEEN 1 AND 200),
 taken_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by uuid NOT NULL REFERENCES users(id),
 FOREIGN KEY(warehouse,location) REFERENCES locations(warehouse,id),
 FOREIGN KEY(destination_warehouse,destination_location) REFERENCES locations(warehouse,id),
 FOREIGN KEY(product,batch) REFERENCES product_batches(product,batch),
 CHECK(base_quantity::bigint=quantity::bigint*factor),
 CHECK((purpose='PRODUCTION' AND destination_warehouse IS NULL AND destination_location IS NULL)
 OR (purpose='TRANSFER' AND destination_warehouse IS NOT NULL AND destination_location IS NOT NULL AND destination_warehouse<>warehouse))
);
CREATE INDEX stock_outs_history ON stock_outs(warehouse,recorded_at DESC,id);
CREATE TABLE stock_out_movements (
 stock_out_id uuid NOT NULL REFERENCES stock_outs(id),
 ledger_id uuid NOT NULL UNIQUE REFERENCES inventory_ledger(id),
 leg text NOT NULL CHECK(leg IN ('SOURCE','DESTINATION')),
 PRIMARY KEY(stock_out_id,leg)
);
CREATE TRIGGER stock_outs_immutable BEFORE UPDATE OR DELETE ON stock_outs FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER stock_out_movements_immutable BEFORE UPDATE OR DELETE ON stock_out_movements FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER stock_outs_no_truncate BEFORE TRUNCATE ON stock_outs EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER stock_out_movements_no_truncate BEFORE TRUNCATE ON stock_out_movements EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION validate_stock_out() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s stock_outs; expected integer;
BEGIN
 IF TG_TABLE_NAME='stock_outs' THEN
  SELECT * INTO s FROM stock_outs WHERE id=NEW.id;
 ELSE
  SELECT * INTO s FROM stock_outs WHERE id=NEW.stock_out_id;
 END IF;
 expected := CASE WHEN s.purpose='TRANSFER' THEN 2 ELSE 1 END;
 IF (SELECT count(*) FROM stock_out_movements WHERE stock_out_id=s.id)<>expected
 OR EXISTS (
  SELECT 1 FROM stock_out_movements m JOIN inventory_ledger l ON l.id=m.ledger_id
  WHERE m.stock_out_id=s.id AND (
   l.product<>s.product OR l.batch<>s.batch OR l.actor<>s.recorded_by::text
   OR (m.leg='SOURCE' AND (l.warehouse<>s.warehouse OR l.location<>s.location OR l.delta<>-s.base_quantity))
   OR (m.leg='DESTINATION' AND (s.purpose<>'TRANSFER' OR l.warehouse<>s.destination_warehouse OR l.location<>s.destination_location OR l.delta<>s.base_quantity))
  )
 ) THEN RAISE EXCEPTION 'Invalid stock out ledger movements'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_out_complete AFTER INSERT ON stock_outs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_stock_out();
CREATE CONSTRAINT TRIGGER stock_out_link_complete AFTER INSERT ON stock_out_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_stock_out();