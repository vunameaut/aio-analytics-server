const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { detectClientEnvironment } = require('../detector');
const eventHub = require('../eventHub');

// Prepared statements for maximum performance
const stmtGetProject = db.prepare('SELECT * FROM projects WHERE id = ?');
const stmtInsertProject = db.prepare(`
  INSERT INTO projects (id, name, platform_type, platforms_seen, origin_domain, created_at, last_seen_at, total_events, total_sessions, total_errors)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
`);
const stmtUpdateProject = db.prepare(`
  UPDATE projects 
  SET last_seen_at = ?, 
      total_events = total_events + 1,
      platforms_seen = ?,
      origin_domain = COALESCE(NULLIF(?, ''), origin_domain)
  WHERE id = ?
`);
const stmtIncrementProjectErrors = db.prepare(`
  UPDATE projects SET total_errors = total_errors + 1 WHERE id = ?
`);
const stmtIncrementProjectSessions = db.prepare(`
  UPDATE projects SET total_sessions = total_sessions + 1 WHERE id = ?
`);

const stmtGetSession = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
const stmtInsertSession = db.prepare(`
  INSERT INTO sessions (
    session_id, project_id, user_id, ip_hash, platform, device_type,
    os_name, os_version, browser_name, browser_version, screen_res,
    country, city, started_at, last_active_at, duration_seconds
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);
const stmtUpdateSession = db.prepare(`
  UPDATE sessions 
  SET last_active_at = ?,
      duration_seconds = MAX(0, CAST((strftime('%s', ?) - strftime('%s', started_at)) AS INTEGER))
  WHERE session_id = ?
`);

const stmtInsertEvent = db.prepare(`
  INSERT INTO events (project_id, session_id, event_type, event_name, path_or_screen, referrer, properties, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertError = db.prepare(`
  INSERT INTO errors (project_id, session_id, message, stack, line, url_or_screen, platform, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Xử lý một sự kiện tracking đơn lẻ
 */
function processEvent(req, payload) {
  const now = new Date().toISOString();
  
  // 1. Tự động nhận diện môi trường & thiết bị
  const env = detectClientEnvironment(req, payload);

  // 2. Định danh dự án (Project ID)
  let rawProjectId = payload.projectId || payload.project_id || payload.appId || req.headers['x-project-id'] || 'default-project';
  const projectId = String(rawProjectId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const projectName = payload.projectName || payload.appName || projectId;

  // 3. Tự động kiểm tra & Đăng ký Dự án (Auto-discovery)
  let project = stmtGetProject.get(projectId);
  const isErrorEvent = payload.eventType === 'error' || Boolean(payload.error);

  if (!project) {
    const initialPlatforms = JSON.stringify([env.platformType]);
    stmtInsertProject.run(
      projectId,
      projectName,
      env.platformType,
      initialPlatforms,
      env.originDomain,
      now,
      now,
      isErrorEvent ? 1 : 0
    );
  } else {
    let platformsSeen = [];
    try {
      platformsSeen = JSON.parse(project.platforms_seen || '[]');
    } catch (e) {
      platformsSeen = [project.platform_type];
    }
    if (!platformsSeen.includes(env.platformType)) {
      platformsSeen.push(env.platformType);
    }
    stmtUpdateProject.run(
      now,
      JSON.stringify(platformsSeen),
      env.originDomain,
      projectId
    );
  }

  // 4. Quản lý Phiên làm việc (Session)
  const sessionId = payload.sessionId || payload.session_id || uuidv4();
  const existingSession = stmtGetSession.get(sessionId);

  if (!existingSession) {
    stmtInsertSession.run(
      sessionId,
      projectId,
      payload.userId || null,
      env.ipHash,
      env.platformType,
      env.deviceType,
      env.osName,
      env.osVersion,
      env.browserName,
      env.browserVersion,
      env.screenRes,
      payload.country || 'VN',
      payload.city || '',
      now,
      now
    );
    if (project) {
      stmtIncrementProjectSessions.run(projectId);
    }
  } else {
    stmtUpdateSession.run(now, now, sessionId);
  }

  // 5. Ghi nhận Sự kiện (Event)
  const eventType = payload.eventType || payload.event_type || 'pageview';
  const eventName = payload.eventName || payload.event_name || (eventType === 'pageview' ? 'Page View' : eventType);
  const pathOrScreen = payload.path || payload.screen || payload.url || '/';
  const referrer = payload.referrer || '';
  const properties = payload.properties ? JSON.stringify(payload.properties) : null;

  stmtInsertEvent.run(
    projectId,
    sessionId,
    eventType,
    eventName,
    pathOrScreen,
    referrer,
    properties,
    now
  );

  // 6. Ghi nhận Lỗi nếu có (Crash / Exception / JS Error)
  if (isErrorEvent) {
    const errorData = payload.error || {};
    stmtInsertError.run(
      projectId,
      sessionId,
      errorData.message || payload.message || 'Unknown error',
      errorData.stack || payload.stack || '',
      errorData.line || payload.line || '',
      pathOrScreen,
      env.platformType,
      now
    );
    stmtIncrementProjectErrors.run(projectId);
  }

  // 7. Phát sóng Real-time tới Dashboard
  eventHub.broadcast('event', {
    projectId,
    projectName,
    sessionId,
    platform: env.platformType,
    deviceType: env.deviceType,
    os: env.osName,
    browser: env.browserName,
    eventType,
    eventName,
    pathOrScreen,
    isError: isErrorEvent,
    timestamp: now
  });

  return {
    success: true,
    projectId,
    sessionId,
    platform: env.platformType,
    deviceType: env.deviceType
  };
}

/**
 * POST /api/v1/track
 * Nhận sự kiện từ Web, Mobile App hoặc Backend
 */
router.post('/track', (req, res) => {
  try {
    const result = processEvent(req, req.body || {});
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
router.post('/heartbeat', (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (sessionId) {
      const now = new Date().toISOString();
      stmtUpdateSession.run(now, now, sessionId);
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
router.post('/batch', (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const results = [];
    for (const evt of events) {
      results.push(processEvent(req, evt));
    }
    return res.status(200).json({ success: true, processed: results.length });
  } catch (err) {
    console.error('[Batch Error]:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

module.exports = router;
