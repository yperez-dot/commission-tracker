const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { requireAuth } = require('./auth');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN env var is required');
const SALES_TRACKER_DB = 'dce5f374-c877-4280-b5be-3b922b4ff210';
const NOTION_VERSION = '2022-06-28';

// Helper to fetch from Notion
async function notionRequest(endpoint, options = {}) {
  const response = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${error}`);
  }
  
  return response.json();
}

// Extract value from Notion property
function getPropValue(properties, key) {
  const prop = properties[key] || {};
  const type = prop.type;
  
  if (type === 'title') {
    const titles = prop.title || [];
    return titles[0]?.plain_text || '';
  } else if (type === 'rich_text') {
    const rich = prop.rich_text || [];
    return rich[0]?.plain_text || '';
  } else if (type === 'select') {
    return prop.select?.name || '';
  } else if (type === 'date') {
    return prop.date?.start || null;
  } else if (type === 'checkbox') {
    return prop.checkbox || false;
  }
  return null;
}

// Fetch all sales from Notion Sales Tracker
router.get('/', requireAuth, async (req, res) => {
  try {
    const sales = [];
    let hasMore = true;
    let startCursor = null;
    
    while (hasMore) {
      const params = { page_size: 100 };
      if (startCursor) params.start_cursor = startCursor;
      
      const response = await notionRequest(`databases/${SALES_TRACKER_DB}/query`, {
        method: 'POST',
        body: JSON.stringify(params)
      });
      
      for (const page of response.results || []) {
        const props = page.properties;
        const clientName = getPropValue(props, 'Name');
        
        // Skip empty rows
        if (!clientName) continue;
        
        sales.push({
          id: page.id,
          client_name: clientName,
          agent: getPropValue(props, 'Agent'),
          carrier: getPropValue(props, 'Carrier'),
          effective_date: getPropValue(props, 'Effective Date'),
          enrollment_date: getPropValue(props, 'Enrollment Date'),
          plan_name: getPropValue(props, 'Plan Name'),
          plan_type: getPropValue(props, 'Plan Type'),
          status: getPropValue(props, 'Status')
        });
      }
      
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }
    
    res.json({ sales, count: sales.length });
  } catch (err) {
    console.error('Error fetching sales from Notion:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
