const express = require('express');
const router = express.Router();

// Test GHL API connection
router.get('/test', async (req, res) => {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  const baseUrl = process.env.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com';

  if (!token || !locationId) {
    return res.status(500).json({
      error: 'GHL credentials not configured',
      hasToken: !!token,
      hasLocation: !!locationId
    });
  }

  try {
    const response = await fetch(`${baseUrl}/opportunities/search?location_id=${locationId}&limit=5`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({
        error: 'GHL API error',
        status: response.status,
        message: error
      });
    }

    const data = await response.json();
    
    res.json({
      success: true,
      totalOpportunities: data.meta?.total || 0,
      sampleSize: data.opportunities?.length || 0,
      message: 'GHL API connection verified! ✅'
    });
  } catch (err) {
    res.status(500).json({
      error: 'Connection failed',
      message: err.message
    });
  }
});

module.exports = router;
