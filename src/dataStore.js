const supabaseStore = require('./supabase');
const localDb = require('./db');
const { detectClientEnvironment } = require('./detector');
const eventHub = require('./eventHub');
const { v4: uuidv4 } = require('uuid');

// Prepared statements for local fallback
const stmtGetProject = localDb.prepare('SELECT * FROM projects WHERE id = ?');
const stmtInsertProject = localDb.prepare(`
  INSERT INTO projects (id, name, platform_type, platforms_seen, origin_domain, created_at, last_seen_at, total_events, total_sessions, total_errors)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
`);
const stmtUpdateProject = localDb.prepare(`
  UPDATE projects 
  SET last_seen_at = ?, 
      total_events = total_events + 1,
      platforms_seen = ?,
      origin_domain = COALESCE(NULLIF(?, ''), origin_domain)
  WHERE id = ?
`);
const stmtIncrementProjectErrors = localDb.prepare(`
  UPDATE projects SET total_errors = total_errors + 1 WHERE id = ?
`);
const stmtIncrementProjectSessions = localDb.prepare(`
  UPDATE projects SET total_sessions = total_sessions + 1 WHERE id = ?
`);

const stmtGetSession = localDb.prepare('SELECT * FROM sessions WHERE session_id = ?');
const stmtInsertSession = localDb.prepare(`
  INSERT INTO sessions (
    session_id, project_id, user_id, ip_hash, platform, device_type,
    os_name, os_version, browser_name, browser_version, screen_res,
    country, city, started_at, last_active_at, duration_seconds
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);
const stmtUpdateSession = localDb.prepare(`
  UPDATE sessions 
  SET last_active_at = ?,
      duration_seconds = MAX(0, CAST((strftime('%s', ?) - strftime('%s', started_at)) AS INTEGER))
  WHERE session_id = ?
`);

const stmtInsertEvent = localDb.prepare(`
  INSERT INTO events (project_id, session_id, event_type, event_name, path_or_screen, referrer, properties, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertError = localDb.prepare(`
  INSERT INTO errors (project_id, session_id, message, stack, line, url_or_screen, platform, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

module.exports = {
  isSupabase: () => supabaseStore.isConfigured(),
  
  async getOverview() {
    if (supabaseStore.isConfigured()) {
      try {
        const res = await supabaseStore.getOverview();
        if (res) return res;
      } catch (err) {
        console.warn('[DataStore] Supabase getOverview error, falling back to local:', err.message);
      }
    }
    // Local fallback
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const activeNowRow = localDb.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      WHERE last_active_at >= ?
    `).get(fiveMinutesAgo);

    const totalProjectsRow = localDb.prepare(`SELECT COUNT(*) as count FROM projects`).get();
    const totalVisitorsRow = localDb.prepare(`SELECT COUNT(DISTINCT session_id) as count FROM sessions`).get();
    const avgDurationRow = localDb.prepare(`
      SELECT AVG(duration_seconds) as avg_duration 
      FROM sessions 
      WHERE duration_seconds > 0
    `).get();

    const events24hRow = localDb.prepare(`
      SELECT COUNT(*) as count 
      FROM events 
      WHERE created_at >= ?
    `).get(twentyFourHoursAgo);

    const errors24hRow = localDb.prepare(`
      SELECT COUNT(*) as count 
      FROM errors 
      WHERE created_at >= ?
    `).get(twentyFourHoursAgo);

    const platformsDistribution = localDb.prepare(`
      SELECT platform, COUNT(DISTINCT session_id) as sessions_count
      FROM sessions
      WHERE started_at >= ?
      GROUP BY platform
    `).all(twentyFourHoursAgo);

    return {
      activeNow: activeNowRow?.count || 0,
      totalProjects: totalProjectsRow?.count || 0,
      totalVisitors: totalVisitorsRow?.count || 0,
      avgDuration: Math.round(avgDurationRow?.avg_duration || 0),
      events24h: events24hRow?.count || 0,
      errors24h: errors24hRow?.count || 0,
      platformsDistribution,
      engine: 'local'
    };
  },

  async getProjects() {
    if (supabaseStore.isConfigured()) {
      try {
        const res = await supabaseStore.getProjects();
        if (res) return res;
      } catch (err) {
        console.warn('[DataStore] Supabase getProjects error, falling back to local:', err.message);
      }
    }
    // Local fallback
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const projects = localDb.prepare(`
      SELECT p.*,
        (SELECT COUNT(DISTINCT s.session_id) 
         FROM sessions s 
         WHERE s.project_id = p.id AND s.last_active_at >= ?) as active_now
      FROM projects p
      ORDER BY p.last_seen_at DESC
    `).all(fiveMinutesAgo);

    return projects.map(p => {
      let status = 'inactive';
      if (p.last_seen_at >= tenMinutesAgo) {
        status = 'active';
      } else if (p.last_seen_at >= oneDayAgo) {
        status = 'idle';
      }

      let platformsSeen = [];
      try {
        platformsSeen = JSON.parse(p.platforms_seen || '[]');
      } catch (e) {
        platformsSeen = [p.platform_type];
      }

      return {
        ...p,
        status,
        platforms_seen: platformsSeen
      };
    });
  },

  async getProjectDetail(id) {
    if (supabaseStore.isConfigured()) {
      try {
        const res = await supabaseStore.getProjectDetail(id);
        if (res) return res;
      } catch (err) {
        console.warn('[DataStore] Supabase getProjectDetail error, falling back to local:', err.message);
      }
    }
    // Local fallback
    const project = localDb.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return null;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const activeNow = localDb.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      WHERE project_id = ? AND last_active_at >= ?
    `).get(id, fiveMinutesAgo)?.count || 0;

    const totalVisitors = localDb.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      WHERE project_id = ?
    `).get(id)?.count || 0;

    const avgDuration = localDb.prepare(`
      SELECT AVG(duration_seconds) as avg_duration 
      FROM sessions 
      WHERE project_id = ? AND duration_seconds > 0
    `).get(id)?.avg_duration || 0;

    const timeline = localDb.prepare(`
      SELECT substr(created_at, 1, 10) as date, COUNT(*) as count, COUNT(DISTINCT session_id) as visitors
      FROM events
      WHERE project_id = ? AND created_at >= ?
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `).all(id, sevenDaysAgo);

    const topPages = localDb.prepare(`
      SELECT path_or_screen, COUNT(*) as views
      FROM events
      WHERE project_id = ? AND event_type IN ('pageview', 'screen_view')
      GROUP BY path_or_screen
      ORDER BY views DESC
      LIMIT 10
    `).all(id);

    const topClicks = localDb.prepare(`
      SELECT event_name, COUNT(*) as count 
      FROM events 
      WHERE project_id = ? AND event_type IN ('click', 'action', 'custom') 
      GROUP BY event_name 
      ORDER BY count DESC 
      LIMIT 10
    `).all(id);

    const devices = localDb.prepare(`
      SELECT device_type, COUNT(*) as count
      FROM sessions
      WHERE project_id = ?
      GROUP BY device_type
      ORDER BY count DESC
    `).all(id);

    const operatingSystems = localDb.prepare(`
      SELECT os_name, COUNT(*) as count
      FROM sessions
      WHERE project_id = ?
      GROUP BY os_name
      ORDER BY count DESC
      LIMIT 6
    `).all(id);

    const browsers = localDb.prepare(`
      SELECT browser_name, COUNT(*) as count
      FROM sessions
      WHERE project_id = ?
      GROUP BY browser_name
      ORDER BY count DESC
      LIMIT 6
    `).all(id);

    const recentEvents = localDb.prepare(`
      SELECT *
      FROM events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 40
    `).all(id);

    const recentErrors = localDb.prepare(`
      SELECT *
      FROM errors
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(id);

    let platformsSeen = [];
    try {
      platformsSeen = JSON.parse(project.platforms_seen || '[]');
    } catch (e) {
      platformsSeen = [project.platform_type];
    }

    return {
      project: {
        ...project,
        platforms_seen: platformsSeen,
        active_now: activeNow,
        total_visitors: totalVisitors,
        avg_duration: Math.round(avgDuration)
      },
      timeline,
      topPages,
      topClicks,
      devices,
      operatingSystems,
      browsers,
      recentEvents,
      recentErrors
    };
  },

  async deleteProject(id) {
    if (supabaseStore.isConfigured()) {
      try {
        const ok = await supabaseStore.deleteProject(id);
        if (ok !== null) return ok;
      } catch (err) {
        console.warn('[DataStore] Supabase deleteProject error, falling back to local:', err.message);
      }
    }
    // Local fallback
    localDb.prepare('DELETE FROM events WHERE project_id = ?').run(id);
    localDb.prepare('DELETE FROM errors WHERE project_id = ?').run(id);
    localDb.prepare('DELETE FROM sessions WHERE project_id = ?').run(id);
    const result = localDb.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async processEvent(req, payload) {
    const now = new Date().toISOString();
    const env = detectClientEnvironment(req, payload);

    let rawProjectId = payload.projectId || payload.project_id || payload.appId || req.headers['x-project-id'] || 'default-project';
    const projectId = String(rawProjectId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const projectName = payload.projectName || payload.appName || projectId;
    const isErrorEvent = payload.eventType === 'error' || Boolean(payload.error);

    let result = null;

    if (supabaseStore.isConfigured()) {
      try {
        result = await supabaseStore.recordEvent(req, payload, env, now);
      } catch (err) {
        console.warn('[DataStore] Supabase recordEvent error, falling back to local:', err.message);
      }
    }

    if (!result) {
      // Local fallback
      let project = stmtGetProject.get(projectId);
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

      result = {
        success: true,
        projectId,
        sessionId,
        platform: env.platformType,
        deviceType: env.deviceType
      };
    }

    // Luôn phát sóng SSE Realtime
    const eventType = payload.eventType || payload.event_type || 'pageview';
    const eventName = payload.eventName || payload.event_name || (eventType === 'pageview' ? 'Page View' : eventType);
    const pathOrScreen = payload.path || payload.screen || payload.url || '/';

    eventHub.broadcast('event', {
      projectId,
      projectName,
      sessionId: result.sessionId,
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

    return result;
  },

  async processHeartbeat(sessionId) {
    if (!sessionId) return;
    if (supabaseStore.isConfigured()) {
      try {
        await supabaseStore.recordHeartbeat(sessionId);
        return;
      } catch (err) {
        console.warn('[DataStore] Supabase recordHeartbeat error:', err.message);
      }
    }
    const now = new Date().toISOString();
    stmtUpdateSession.run(now, now, sessionId);
  }
};
