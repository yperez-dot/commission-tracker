# Fix Yahoska's Display Name

## Option 1: Browser Console (Easiest)

1. **Log into OliComm** (https://melodic-cendol-e1dc49.netlify.app)
2. **Open browser console** (F12 → Console tab)
3. **Paste and run this:**

```javascript
fetch('https://commission-tracker-production-e4fc.up.railway.app/api/admin-fixes/update-user-name', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + localStorage.getItem('jwt')
  },
  body: JSON.stringify({
    email: 'yperez@healthexps.com',
    newName: 'Yahoska Perez'
  })
})
.then(r => r.json())
.then(data => console.log('✅ Name updated:', data))
.catch(err => console.error('❌ Error:', err));
```

4. **Refresh the page** to see the change

---

## Option 2: Command Line (with JWT token)

```bash
# Get your JWT token from browser localStorage (OliComm → F12 → Application → Local Storage → jwt)
JWT_TOKEN="your-token-here"

curl -X POST https://commission-tracker-production-e4fc.up.railway.app/api/admin-fixes/update-user-name \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "email": "yperez@healthexps.com",
    "newName": "Yahoska Perez"
  }'
```

---

## What it does:
- Changes display name from "Yahoska Test" → "Yahoska Perez"
- Updates the `users` table in PostgreSQL
- Admin-only endpoint (requires valid JWT)
