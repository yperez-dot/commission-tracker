-- Speeds up the new /records classificationLike filter (ILIKE '%override%' etc),
-- used by Agency Override Recon to filter override/chargeback rows server-side
-- instead of downloading every non-BSI commission record and filtering in JS.
-- A plain btree index can't serve a leading-wildcard ILIKE — pg_trgm + GIN can.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_commission_records_classification_trgm
  ON commission_records USING GIN (classification gin_trgm_ops);
