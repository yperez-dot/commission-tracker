# 🚨 MANDATORY PRE-PUSH CHECKLIST

**Never push code without completing these steps.**

---

## ✅ Before EVERY commit to routes/files.js:

```bash
node -c routes/files.js
```

**Must show:** No output (silent = pass) or "✅ SYNTAX CHECK PASSED"

**If syntax error:** Fix it before committing!

---

## ✅ Before EVERY push to production:

### 00. Diff review order (added 2026-07-08)
**Show `git diff` BEFORE asking for go. Wait for explicit approval of the diff, THEN push.**
Do not accept a "push" approval that precedes the diff review — restate that the diff is still pending.
Sequence: diff shown → Yahoska reviews → "go" → push. Not: build → "go" → push → show diff.

---

### 0. Missing Renewals Baseline Snapshot (if touching records.js OR MissingRenewals.js)

**Record the current Missing count BEFORE pushing** — open the Missing Renewals page, note the count shown in the header, write it here or in the commit message. Without a baseline, "stop and report if counts move unexpectedly" has nothing to compare against.

```
Pre-push Missing count: _____  (period: ______, filters: ______)
```

Why: The frontend builds its own match using `/bob` + `/records` directly (client-side normName/nameVariants). No backend instrumentation fields are live for this view. The only baseline that exists is a screenshot or manual note taken before the deploy.

---

### 1. Syntax Check (2 seconds)
```bash
# Check main files
node -c routes/files.js
node -c server.js

# Check all route files
for file in routes/*.js; do node -c "$file"; done
```

### 2. Local Test (30 seconds)
```bash
# Start server locally
npm start

# Verify it starts without errors
# Check http://localhost:3001/api/health
```

### 3. Frontend Build Test (if frontend changed)
```bash
cd src
npm run build
```

---

## 🤖 GitHub Actions Auto-Check

**Added:** `.github/workflows/syntax-check.yml`

**What it does:**
- Runs on every push to main
- Checks syntax of all JS files
- Blocks deploy if syntax fails
- Prevents production crashes

**Status badge:** Check GitHub Actions tab

---

## 🔴 Why This Matters

**Without syntax check:**
- ❌ Backend crashes on startup
- ❌ Railway keeps restarting
- ❌ All API endpoints down
- ❌ Frontend broken
- ❌ Users affected

**With syntax check:**
- ✅ Catch errors locally (2 seconds)
- ✅ Never push broken code
- ✅ Production stays stable
- ✅ Users happy

---

## 📋 Quick Reference

**One command before every push:**
```bash
node -c routes/files.js && git push
```

**Chain it:** If syntax check fails, push is blocked automatically!

---

## 🛠️ VS Code Integration (Optional)

Add to `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Syntax Check",
      "type": "shell",
      "command": "node -c routes/files.js",
      "problemMatcher": []
    }
  ]
}
```

Run with: `Ctrl+Shift+B` → Select "Syntax Check"

---

## 📝 Commit Message Template

```
[SYNTAX CHECKED] Your commit message here

✅ node -c routes/files.js passed
```

---

**Remember:** 2 seconds of checking saves hours of debugging! 🎯
