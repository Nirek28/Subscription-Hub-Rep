const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  const SETU_API_URL = process.env.SETU_API_URL || 'https://uat.setu.co';
  const SETU_AUTH_CLIENT_ID = process.env.SETU_AUTH_CLIENT_ID;
  const SETU_AUTH_SECRET = process.env.SETU_AUTH_SECRET;

  try {
    const { endpoint, payload } = req.body;

    const response = await fetch(`${SETU_API_URL}/${endpoint || ''}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': SETU_AUTH_CLIENT_ID,
        'x-client-secret': SETU_AUTH_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Setu Integration Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

module.exports = router;