require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { initSchema } = require('./db/database');

initSchema().then(() => {
  console.log('✅ Database ready');
}).catch(err => {
  console.error('❌ Database init failed:', err.message);
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/files', require('./routes/files'));
app.use('/api/records', require('./routes/records'));
app.use('/api/bob', require('./routes/bob'));
app.use('/api/sales-tracker', require('./routes/sales-tracker'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Health Experts Commission Tracker API`);
  console.log(`   Running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
