'use strict';

/**
 * Format-tolerant client name key for All Data client files.
 * "CAMBAS DE RIVAS, MILAGROS" and "Milagros Cambas De Rivas" → same key.
 * Matches Smart Matching v2 normalizeNameKey (token-sort, drop 1-char tokens).
 */
function clientNameKey(name) {
  if (!name) return '';
  const noAccents = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const clean = noAccents.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
  return clean
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort()
    .join('|');
}

function clientFileGroupKey(clientName, carrier) {
  return `${clientNameKey(clientName)}|${String(carrier || '').toLowerCase().trim()}`;
}

/**
 * Postgres expression equivalent to clientNameKey(alias.client_full_name).
 * Used by /records/by-client GROUP BY and /client-history WHERE.
 */
function clientNameKeySql(alias = 'cr') {
  const col = `${alias}.client_full_name`;
  return `(
    SELECT string_agg(tok, '|' ORDER BY tok)
    FROM unnest(
      regexp_split_to_array(
        regexp_replace(upper(trim(COALESCE(${col}, ''))), '[^A-Z0-9[:space:]]', ' ', 'g'),
        '[[:space:]]+'
      )
    ) AS tok
    WHERE length(tok) > 1
  )`;
}

module.exports = {
  clientNameKey,
  clientFileGroupKey,
  clientNameKeySql,
};
