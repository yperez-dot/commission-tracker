// Get auth token for Yahoska's account
const fetch = require('node-fetch');

const RAILWAY_URL = 'https://commission-tracker-production-e4fc.up.railway.app';

async function login() {
  try {
    // Try logging in with Yahoska's credentials
    const response = await fetch(`${RAILWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'yperez@healthexps.com',
        password: 'temp123'  // Default password from user creation
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.token) {
      console.log('✅ Login successful!');
      console.log('Token:', data.token);
      console.log('\nUse this in curl:');
      console.log(`  -H "Authorization: Bearer ${data.token}"`);
    } else {
      console.log('❌ Login failed:', data);
      console.log('\nTrying to register new test user...');
      
      // Try registering a test user
      const registerResponse = await fetch(`${RAILWAY_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'test@healthexps.com',
          password: 'test123',
          name: 'Test User'
        })
      });
      
      const registerData = await registerResponse.json();
      
      if (registerResponse.ok && registerData.token) {
        console.log('✅ Registration successful!');
        console.log('Token:', registerData.token);
      } else {
        console.log('❌ Registration failed:', registerData);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

login();
