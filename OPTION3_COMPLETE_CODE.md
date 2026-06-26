# Fix #2 - Option 3: Pre-process name-bleed BEFORE Stage 1

## Changes Summary:
1. Add `preprocessNameBleed()` function
2. Call it on each section text before parsing
3. Revert Stage 1 regex to digits-only
4. Remove Stage 2 name-bleed split logic (no longer needed)

---

## 1. ADD preprocessing function (insert around line 2580, before parseBSIPDF):

```javascript
/**
 * Pre-process BSI section text to split name-bleed patterns.
 * Inserts space between policy number and trailing surname letters.
 * Example: "929779560RODRIGUEZ, GUIDO" → "929779560 RODRIGUEZ, GUIDO"
 * This runs BEFORE regex extraction so Stage 1 can parse cleanly.
 */
function preprocessBSINameBleed(text) {
  return text.replace(
    /\b([A-Z0-9]*?\d[A-Z0-9]{5,}?)([A-Z]{2,})(?=[,\s])/g,
    (match, policy, surname) => {
      // Skip if policy contains underscore (legitimate suffix like _MA, _HMO)
      if (policy.includes('_')) {
        return match;
      }
      // Only split if policy looks real (has digits, reasonable length)
      if (policy.length < 6) {
        return match;
      }
      return policy + ' ' + surname;
    }
  );
}
```

---

## 2. CALL preprocessing in main loop (around line 2618):

BEFORE:
```javascript
for (let si = 0; si < sections.length; si++) {
  const { rawCarrier, startIdx } = sections[si];
  const endIdx = (si + 1 < sections.length) ? sections[si + 1].startIdx : text.length;
  const sectionText = text.slice(startIdx, endIdx);
```

AFTER:
```javascript
for (let si = 0; si < sections.length; si++) {
  const { rawCarrier, startIdx } = sections[si];
  const endIdx = (si + 1 < sections.length) ? sections[si + 1].startIdx : text.length;
  let sectionText = text.slice(startIdx, endIdx);
  
  // Pre-process: split name-bleed patterns before parsing
  sectionText = preprocessBSINameBleed(sectionText);
```

---

## 3. REVERT policyAlternatives to digits-only (line 2632):

BEFORE:
```javascript
const policyAlternatives = [
  '[A-Z0-9]{6,15}_[A-Z]{2,5}',
  '[A-Z]{2,3}\\d{8,15}[A-Z]{0,20}',  // MBI format + optional trailing letters
  '\\d{6,15}[A-Z]{4,20}',           // Numeric policy + trailing surname (name bleed)
  '\\d{9,15}',                      // Digits only (no bleed)
  '[A-Z]\\d{6,12}',
  '[A-Z]\\d{8,12}',
];
```

AFTER:
```javascript
const policyAlternatives = [
  '[A-Z0-9]{6,15}_[A-Z]{2,5}',
  '[A-Z]{2,3}\\d{8,15}',            // MBI format
  '\\d{9,15}',                      // Digits only (REVERTED - preprocessing handles bleed)
  '[A-Z]\\d{6,12}',
  '[A-Z]\\d{8,12}',
];
```

---

## 4. REMOVE Stage 2 name-bleed split logic (lines 2696-2710):

DELETE this entire block:
```javascript
// FIX #2: Name-bleed split
console.log(`[BSI TRACE] Processing policy: "${policyNumber}", client: "${clientRaw}", hasUnderscore: ${policyNumber.includes('_')}`);
if (!policyNumber.includes('_')) {
  const bleedMatch = policyNumber.match(/^([0-9A-Z]+?)([A-Z]{4,})$/);
  if (bleedMatch) {
    const cleanPolicy = bleedMatch[1];
    const bleedSurname = bleedMatch[2];
    console.log(`[BSI DEBUG] Policy: "${policyNumber}", Clean: "${cleanPolicy}", Bleed: "${bleedSurname}", Client: "${clientRaw}", ClientUpper: "${clientRaw.toUpperCase()}", Includes: ${clientRaw.toUpperCase().includes(bleedSurname)}`);
    if (!clientRaw.toUpperCase().includes(bleedSurname)) {
      console.log(`[BSI NAME-BLEED] Split "${policyNumber}" → policy "${cleanPolicy}" + restored "${bleedSurname}" to client "${clientRaw}"`);
      policyNumber = cleanPolicy;
      clientRaw = bleedSurname + ' ' + clientRaw;
    } else {
      console.log(`[BSI SKIP-SPLIT] Client already has surname - Policy: "${policyNumber}", Client: "${clientRaw}"`);
    }
  }
}
```

No longer needed - preprocessing already split it!

---

## Expected Result:

**Raw PDF line:**
```
929779560RODRIGUEZ, GUIDO A.04/01/2026$37.50
```

**After preprocessing:**
```
929779560 RODRIGUEZ, GUIDO A.04/01/2026$37.50
```

**Stage 1 extraction:**
- `dm[1]` (policy) = `"929779560"` ✅ Clean!
- `dm[2]` (client) = `"RODRIGUEZ, GUIDO A."` ✅ Full name!

**Stage 2 processing:**
- No split logic needed
- Direct push to records

**Database:**
- `policy_number` = `"929779560"` ✅
- `client_full_name` = `"Rodriguez, Guido A."` ✅ (Title cased)

---

**Ready to apply? Say yes and I'll make the edits as ONE commit.**
