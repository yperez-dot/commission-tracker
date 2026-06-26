// Add this temporary debug logging to see raw PDF lines
// Insert around line 2650, inside the 3-line block parsing:

const dm = lineC.match(dataLinePattern);
if (!dm) continue;

// DEBUG: Log the raw line before extraction
console.log(`[BSI RAW-LINE] Raw: "${lineC}"`);
console.log(`[BSI RAW-LINE] dm[1] (policy): "${dm[1]}"`);
console.log(`[BSI RAW-LINE] dm[2] (client): "${dm[2]}"`);
console.log(`[BSI RAW-LINE] dm[3] (date): "${dm[3]}"`);
console.log(`[BSI RAW-LINE] dm[4] (amount): "${dm[4]}"`);

// Then continue with normal processing...
