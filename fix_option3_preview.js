// FIX #2 - Option 3: Pre-process raw text to split name-bleed patterns
// This runs BEFORE Stage 1 extraction

// Add this function before the main parsing loop (around line 2625)

/**
 * Pre-process BSI section text to split name-bleed patterns
 * Converts: "929779560RODRIGUEZ" → "929779560 RODRIGUEZ"
 * So Stage 1 regex can extract them cleanly
 */
function preprocessNameBleed(sectionText) {
  // Pattern: 6-15 digits followed by 4+ uppercase letters (likely surname bleed)
  // We insert a space between the digits and the letters
  // Example: "929779560RODRIGUEZJR, GUIDO" → "929779560 RODRIGUEZJR, GUIDO"
  
  return sectionText.replace(
    /(\d{6,15})([A-Z]{4,})/g,
    '$1 $2'  // Insert space between digits and trailing letters
  );
}

// USAGE (insert after line 2629, before lines are split):
// const sectionText = text.slice(startIdx, endIdx);
// const cleanedText = preprocessNameBleed(sectionText);  // ← ADD THIS
// const lines = cleanedText.split('\n').map(l => l.trim()).filter(Boolean);  // ← Use cleaned


// REVERT policyAlternatives to digits-only (line 2632):
const policyAlternatives = [
  '[A-Z0-9]{6,15}_[A-Z]{2,5}',   // With suffix (_HMO, _PPO, etc.)
  '[A-Z]{2,3}\\d{8,15}',         // MBI format (letters then digits)
  '\\d{9,15}',                   // Digits only (REVERTED - no bleed capture)
  '[A-Z]\\d{6,12}',              // 1 letter + digits
  '[A-Z]\\d{8,12}',              // 1 letter + digits (alternate)
];

// REMOVE Stage 2 name-bleed split logic (no longer needed)
// The preprocessing already split it, so policyNumber will be clean
// and clientRaw will have the surname already

// DELETE lines 2696-2710 (the entire name-bleed split block and debug logs)
