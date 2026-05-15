const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Simple JSON file storage for manual payments
const STORAGE_FILE = path.join(__dirname, '../data/manual-payments.json');

// Ensure data directory exists
const dataDir = path.dirname(STORAGE_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Load manual payments from file
function loadPayments() {
  if (!fs.existsSync(STORAGE_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(STORAGE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading manual payments:', err);
    return [];
  }
}

// Save manual payments to file
function savePayments(payments) {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(payments, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving manual payments:', err);
    return false;
  }
}

// GET /api/manual-payments - Get all manual payments
router.get('/', (req, res) => {
  try {
    const payments = loadPayments();
    res.json({ payments });
  } catch (err) {
    console.error('Error fetching manual payments:', err);
    res.status(500).json({ error: 'Failed to fetch manual payments' });
  }
});

// POST /api/manual-payments - Add a new manual payment
router.post('/', (req, res) => {
  try {
    const { client_name, agent, carrier, effective_date, payment_date, marked_by } = req.body;
    
    if (!client_name || !agent || !effective_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const payments = loadPayments();
    
    // Check if already exists
    const exists = payments.find(p => 
      p.client_name === client_name && 
      p.agent === agent && 
      p.effective_date === effective_date
    );
    
    if (exists) {
      return res.status(400).json({ error: 'Payment already marked' });
    }
    
    // Add new payment
    const newPayment = {
      id: Date.now().toString(),
      client_name,
      agent,
      carrier,
      effective_date,
      payment_date: payment_date || new Date().toISOString().split('T')[0],
      marked_by: marked_by || 'User',
      marked_at: new Date().toISOString()
    };
    
    payments.push(newPayment);
    
    if (savePayments(payments)) {
      res.json({ success: true, payment: newPayment });
    } else {
      res.status(500).json({ error: 'Failed to save payment' });
    }
  } catch (err) {
    console.error('Error adding manual payment:', err);
    res.status(500).json({ error: 'Failed to add manual payment' });
  }
});

// DELETE /api/manual-payments/:id - Remove a manual payment
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const payments = loadPayments();
    
    const filtered = payments.filter(p => p.id !== id);
    
    if (filtered.length === payments.length) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    if (savePayments(filtered)) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to delete payment' });
    }
  } catch (err) {
    console.error('Error deleting manual payment:', err);
    res.status(500).json({ error: 'Failed to delete manual payment' });
  }
});

module.exports = router;
