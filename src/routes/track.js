const express = require('express');
const router = express.Router();
const dataStore = require('../dataStore');

/**
 * POST /api/v1/track
 * Nhận sự kiện từ Web, Mobile App hoặc Backend (Supabase Cloud hoặc Local Store)
 */
router.post('/track', async (req, res) => {
  try {
    const result = await dataStore.processEvent(req, req.body || {});
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Track Error]:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

/**
 * POST /api/v1/heartbeat
 * Giữ session sống và tính toán thời gian ở lại trang / app
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (sessionId) {
      await dataStore.processHeartbeat(sessionId);
    }
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(200).json({ status: 'ok' });
  }
});

/**
 * POST /api/v1/batch
 * Nhận danh sách nhiều sự kiện một lúc (hữu ích cho Mobile app offline queue)
 */
router.post('/batch', async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const results = [];
    for (const evt of events) {
      results.push(await dataStore.processEvent(req, evt));
    }
    return res.status(200).json({ success: true, processed: results.length });
  } catch (err) {
    console.error('[Batch Error]:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

module.exports = router;
