#!/bin/bash
# EMERGENCY: Revert all of today's 8 commits to get backend up

echo "🚨 REVERTING TODAY'S 8 COMMITS (f9b7181 through eb37e1b)"
echo ""
echo "Last known good: a08a4e5 (before today)"
echo ""
read -p "Press ENTER to revert, or Ctrl+C to cancel..."

cd "$(dirname "$0")"

echo ""
echo "=== CREATING REVERT COMMIT ==="
git revert --no-commit ba16a5d^..eb37e1b

if [ $? -eq 0 ]; then
  echo "✅ Revert staged successfully"
  echo ""
  echo "=== COMMITTING REVERT ==="
  git commit -m "Revert today's 8 commits - backend down

Reverted commits:
- eb37e1b: Shared utility + consolidation proposal
- ba16a5d: Agency Override Recon fix
- d6f3696: Type-aware netting (Sales Recon)
- 9c78a2e: Critical netting fixes
- a80eeeb: Fix #6 Part 2
- 428e826: Fix #6 Part 1
- f0b9b97: Manual edit feature
- f9b7181: Compound surname fix

Reason: Railway backend completely down after deployment
Status: Returning to last known good commit a08a4e5

Will re-apply fixes one at a time after diagnosing root cause."

  echo ""
  echo "=== PUSHING TO GITHUB ==="
  git push origin main
  
  if [ $? -eq 0 ]; then
    echo ""
    echo "✅ REVERT COMPLETE"
    echo ""
    echo "Railway will auto-deploy in 2-3 minutes"
    echo "Backend should come back up at that point"
    echo ""
    echo "Check: https://commission-tracker-production-e4fc.up.railway.app/api/health"
  else
    echo "❌ Push failed - check git status"
    exit 1
  fi
else
  echo "❌ Revert failed - check for conflicts"
  git revert --abort
  exit 1
fi
