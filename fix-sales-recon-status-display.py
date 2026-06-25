#!/usr/bin/env python3
"""
Fix Sales Reconciliation Status Display
Updates all m.sale.status references to use resolveStatus(m.sale)
"""

from pathlib import Path
import re

print("=== FIXING SALES RECON STATUS DISPLAY ===\n")

filepath = Path('src/pages/Reconciliation.js')
content = filepath.read_text(encoding='utf-8')

# Replace m.sale.status with resolveStatus(m.sale) in badge displays
# Pattern 1: badge with status
pattern1 = r'<span className="badge badge-amber">\s*\{m\.sale\.status \|\| \'Unpaid\'\}\s*</span>'
replacement1 = '''<span className={`badge ${resolveStatus(m.sale) === 'Deceased' || resolveStatus(m.sale) === 'Termed' ? 'badge-red' : 'badge-amber'}`}>
                                {resolveStatus(m.sale)}
                              </span>'''

matches = re.findall(pattern1, content)
print(f"Found {len(matches)} badge status occurrences")

content = re.sub(pattern1, replacement1, content)

# Hide "Mark Paid" button for deceased/termed clients
# Find the button and wrap it in a conditional
pattern2 = r'(<td style=\{\{textAlign:\'center\'\}\}>\s*)<button\s+className="btn btn-sm btn-primary"[^>]*onClick=\{\(\) => handleMarkPaid\(m\.sale\)\}[^>]*>\s*💰 Mark Paid\s*</button>\s*(</td>)'

replacement2 = r'''\1{resolveStatus(m.sale) !== 'Deceased' && resolveStatus(m.sale) !== 'Termed' && (
                                <button 
                                  className="btn btn-sm btn-primary"
                                  onClick={() => handleMarkPaid(m.sale)}
                                  style={{fontSize:11, padding:'4px 10px'}}
                                >
                                  💰 Mark Paid
                                </button>
                              )}
                            \2'''

matches2 = re.findall(pattern2, content, re.DOTALL)
print(f"Found {len(matches2)} Mark Paid button occurrences")

content = re.sub(pattern2, replacement2, content, flags=re.DOTALL)

filepath.write_text(content, encoding='utf-8')

print("\n✅ COMPLETE")
print("Changes:")
print("  - Updated badge display to use resolveStatus()")
print("  - Added red badge for Deceased/Termed status")
print("  - Hide 'Mark Paid' button for Deceased/Termed clients")
