-- Fix Aetna classifications: Change "New Business" to "Renewal" 
-- where effective_date is in a different month/year than the payment period

-- This will fix the THEI_AETNA_STATEMENT_JANUARY_2026.csv upload
-- where rows 3-14 show "New Business" but should be "Renewal"

UPDATE commission_records
SET classification = 'Renewal'
WHERE carrier = 'Aetna'
  AND classification = 'New Business'
  AND period = '202601'  -- January 2026 payment
  AND (
    -- Effective date NOT in January 2026
    effective_date < '2026-01-01' OR effective_date >= '2026-02-01'
  )
  AND commission > 0;  -- Don't change chargebacks

-- Expected changes:
-- PROS DE CANEL,SILVIA - 01/01/2025 → Renewal
-- PROENCA,SERGIO - 01/01/2025 → Renewal  
-- PROENCA,MARIA - 06/01/2022 → Renewal
-- ONEILL A,SHIRLEY - 01/01/2023 → Renewal
-- MORRIS C,EZZARD - 01/01/2025 → Renewal
-- LIZARDO,JUANA - 05/01/2024 → Renewal
-- GRANTHAM R,WILLIAM - 04/01/2024 → Renewal
-- GONZALEZ,MARISOL - 01/01/2025 → Renewal
-- ESTRADA Y,MARTHA - 10/01/2023 → Renewal
-- DIONISIO M,NORBERTO - 01/01/2024 → Renewal
-- CANEL,DANIEL - 01/01/2025 → Renewal
-- ABRAMS,DAWNMARILYN - 01/01/2024 → Renewal

-- SEMINARIO will stay "New Business" (eff date = 01/01/2026, same month as payment)
