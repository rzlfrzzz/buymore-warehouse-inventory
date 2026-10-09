-- BigSeller SKUs are opaque text identifiers, not ASCII-only internal codes.
-- Keep existing keys and references unchanged, including legacy exceptions.
ALTER TABLE products DROP CONSTRAINT products_check;
ALTER TABLE products ADD CONSTRAINT products_check CHECK (
 legacy OR (
  code=btrim(code) AND length(code) BETWEEN 1 AND 64
  AND code !~ '[\x01-\x1f\x7f]'
 )
);