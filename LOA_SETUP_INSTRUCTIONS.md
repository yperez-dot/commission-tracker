# LOA Statements Feature - Setup Instructions

## ✅ What Was Built

Added a complete LOA (Loan Out Agreement) payment statement system to OliComm.

### Features:
- Create payment statements for LOA agents (like Carolina Robles)
- Add line items (client, carrier, type, amount, notes)
- Generate Excel statements in your exact format
- Track statement status (draft → approved → paid)
- Statement history with download/re-export
- Integrated into existing Payroll page as a new tab

---

## 🚀 How to Deploy

### Step 1: Create Database Tables

Run this SQL on your Railway PostgreSQL database:

\`\`\`sql
CREATE TABLE IF NOT EXISTS loa_statements (
  id SERIAL PRIMARY KEY,
  agent_name VARCHAR(255) NOT NULL,
  payment_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,
  period_label VARCHAR(100),
  total_amount DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'draft',
  commission_structure JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  paid_date DATE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS loa_statement_items (
  id SERIAL PRIMARY KEY,
  statement_id INTEGER REFERENCES loa_statements(id) ON DELETE CASCADE,
  client_name VARCHAR(255),
  carrier VARCHAR(255),
  transaction_type VARCHAR(100),
  amount DECIMAL(10,2),
  note TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_loa_statements_agent ON loa_statements(agent_name);
CREATE INDEX IF NOT EXISTS idx_loa_statements_status ON loa_statements(status);
CREATE INDEX IF NOT EXISTS idx_loa_statement_items_statement ON loa_statement_items(statement_id);
\`\`\`

### Step 2: Deploy Code

The following files were created/updated:

**Backend:**
- ✅ \`routes/loa-statements.js\` - API endpoints (NEW)
- ✅ \`server.js\` - Route registration (UPDATED)
- ✅ \`package.json\` - Added exceljs dependency (UPDATED)

**Frontend:**
- ✅ \`src/components/LOAStatements.js\` - UI component (NEW)
- ✅ \`src/pages/Payroll.js\` - Added LOA tab (UPDATED)

**Deployment steps:**
1. Push code to GitHub
2. Railway will auto-deploy backend
3. Netlify will auto-deploy frontend
4. Run the SQL script above on Railway PostgreSQL

### Step 3: Install Dependencies

If deploying manually:
\`\`\`bash
cd commission-tracker
npm install exceljs
npm run build  # for frontend
\`\`\`

---

## 📝 How to Use

### Creating a Statement:

1. Go to **Payroll** page
2. Click **LOA Statements** tab
3. Click **+ Create Statement**
4. Fill in:
   - Agent: Carolina Robles (or other LOA agent)
   - Payment Date: Today's date
   - Period Label: e.g., "January - April 2026"
5. Add line items:
   - Client name
   - Carrier
   - Type (New to Book / Plan Changes / Medigap)
   - Amount
   - Note (optional)
6. Click **+ Add** for each item
7. Click **Save as Draft** or **Approve & Generate**

### Downloading Statement:

- Click **↓ Excel** button to download the formatted statement
- Format matches your exact Excel template

### Managing Statements:

- **✓ Paid** - Mark as paid (tracks payment date)
- **Delete** - Remove draft statements
- All statements are saved with full history

---

## 📊 Excel Statement Format

Generated Excel files include:
- Company header (THE HEALTH EXPERTS INSURANCE)
- Agent info (name, payment date, period)
- Line items table
- Auto-calculated total
- Commission structure section
- Notes for each client
- Approval footer

**Matches your format exactly!**

---

## 🎯 Next Steps

1. ✅ Deploy to Railway/Netlify
2. ✅ Run SQL setup script
3. ✅ Test creating Carolina's first statement
4. Future: Add more LOA agents if needed
5. Future: Import from commission records option

---

**Files to review before deploying:**
- \`routes/loa-statements.js\` - Backend API
- \`src/components/LOAStatements.js\` - Frontend UI
