const supabaseStore = require('./supabase');
const localDb = require('./db');
const { detectClientEnvironment } = require('./detector');
const eventHub = require('./eventHub');
const { getTimeRange } = require('./timeHelper');
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
  
  async getOverview(period = '7d') {
    if (supabaseStore.isConfigured()) {
      try {
        const res = await supabaseStore.getOverview(period);
        if (res) return res;
      } catch (err) {
        console.warn('[DataStore] Supabase getOverview error, falling back to local:', err.message);
      }
    }

    // Local fallback hỗ trợ khoảng thời gian
    const { startDate, endDate, label } = getTimeRange(period);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const activeNowRow = localDb.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      WHERE last_active_at >= ?
    `).get(fiveMinutesAgo);

    const totalProjectsRow = localDb.prepare(`SELECT COUNT(*) as count FROM projects`).get();

    // Query các bản ghi theo khoảng thời gian
    let timeWhereEvents = '';
    let timeWhereSessions = '';
    let timeWhereErrors = '';
    let paramsEvents = [];
    let paramsSessions = [];
    let paramsErrors = [];

    if (startDate && endDate) {
      timeWhereEvents = 'WHERE created_at >= ? AND created_at <= ?';
      timeWhereSessions = 'WHERE started_at >= ? AND started_at <= ?';
      timeWhereErrors = 'WHERE created_at >= ? AND created_at <= ?';
      paramsEvents = [startDate, endDate];
      paramsSessions = [startDate, endDate];
      paramsErrors = [startDate, endDate];
    } else if (startDate) {
      timeWhereEvents = 'WHERE created_at >= ?';
      timeWhereSessions = 'WHERE started_at >= ?';
      timeWhereErrors = 'WHERE created_at >= ?';
      paramsEvents = [startDate];
      paramsSessions = [startDate];
      paramsErrors = [startDate];
    }

    const eventsCountRow = localDb.prepare(`SELECT COUNT(*) as count FROM events ${timeWhereEvents}`).get(...paramsEvents);
    const errorsCountRow = localDb.prepare(`SELECT COUNT(*) as count FROM errors ${timeWhereErrors}`).get(...paramsErrors);
    const totalVisitorsRow = localDb.prepare(`SELECT COUNT(DISTINCT session_id) as count FROM sessions ${timeWhereSessions}`).get(...paramsSessions);
    
    const durWhere = timeWhereSessions ? `${timeWhereSessions} AND duration_seconds > 0` : 'WHERE duration_seconds > 0';
    const avgDurationRow = localDb.prepare(`SELECT AVG(duration_seconds) as avg_duration FROM sessions ${durWhere}`).get(...paramsSessions);

    const platWhere = timeWhereSessions ? `${timeWhereSessions}` : '';
    const platformsDistribution = localDb.prepare(`
      SELECT platform, COUNT(DISTINCT session_id) as sessions_count
      FROM sessions
      ${platWhere}
      GROUP BY platform
    `).all(...paramsSessions);

    return {
      activeNow: activeNowRow?.count || 0,
      totalProjects: totalProjectsRow?.count || 0,
      totalVisitors: totalVisitorsRow?.count || 0,
      avgDuration: Math.round(avgDurationRow?.avg_duration || 0),
      events24h: eventsCountRow?.count || 0,
      errors24h: errorsCountRow?.count || 0,
      platformsDistribution,
      period,
      periodLabel: label,
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

  async getProjectDetail(id, period = '7d') {
    if (supabaseStore.isConfigured()) {
      try {
        const res = await supabaseStore.getProjectDetail(id, period);
        if (res) return res;
      } catch (err) {
        console.warn('[DataStore] Supabase getProjectDetail error, falling back to local:', err.message);
      }
    }

    // Local fallback
    const project = localDb.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return null;

    const { startDate, endDate, label, isHourly } = getTimeRange(period);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const activeNow = localDb.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      WHERE project_id = ? AND last_active_at >= ?
    `).get(id, fiveMinutesAgo)?.count || 0;

    let timeEventClause = 'WHERE project_id = ?';
    let timeSessionClause = 'WHERE project_id = ?';
    let pEvent = [id];
    let pSession = [id];

    if (startDate && endDate) {
      timeEventClause += ' AND created_at >= ? AND created_at <= ?';
      timeSessionClause += ' AND started_at >= ? AND started_at <= ?';
      pEvent.push(startDate, endDate);
      pSession.push(startDate, endDate);
    } else if (startDate) {
      timeEventClause += ' AND created_at >= ?';
      timeSessionClause += ' AND started_at >= ?';
      pEvent.push(startDate);
      pSession.push(startDate);
    }

    const totalVisitors = localDb.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      ${timeSessionClause}
    `).get(...pSession)?.count || 0;

    const totalEvents = localDb.prepare(`
      SELECT COUNT(*) as count 
      FROM events 
      ${timeEventClause}
    `).get(...pEvent)?.count || 0;

    const totalErrors = localDb.prepare(`
      SELECT COUNT(*) as count 
      FROM errors 
      ${timeEventClause}
    `).get(...pEvent)?.count || 0;

    const avgDuration = localDb.prepare(`
      SELECT AVG(duration_seconds) as avg_duration 
      FROM sessions 
      ${timeSessionClause} AND duration_seconds > 0
    `).get(...pSession)?.avg_duration || 0;

    // Timeline: nếu isHourly thì group theo giờ, nếu không thì theo ngày
    const timeGroupBy = isHourly ? "substr(created_at, 12, 2) || ':00'" : "substr(created_at, 1, 10)";
    const timeline = localDb.prepare(`
      SELECT ${timeGroupBy} as date, COUNT(*) as count, COUNT(DISTINCT session_id) as visitors
      FROM events
      ${timeEventClause}
      GROUP BY ${timeGroupBy}
      ORDER BY date ASC
    `).all(...pEvent);

    const topPages = localDb.prepare(`
      SELECT path_or_screen, COUNT(*) as views
      FROM events
      ${timeEventClause} AND event_type IN ('pageview', 'screen_view')
      GROUP BY path_or_screen
      ORDER BY views DESC
      LIMIT 10
    `).all(...pEvent);

    const topClicks = localDb.prepare(`
      SELECT event_name, COUNT(*) as count 
      FROM events 
      ${timeEventClause} AND event_type IN ('click', 'action', 'custom') 
      GROUP BY event_name 
      ORDER BY count DESC 
      LIMIT 10
    `).all(...pEvent);

    const devices = localDb.prepare(`
      SELECT device_type, COUNT(*) as count
      FROM sessions
      ${timeSessionClause}
      GROUP BY device_type
      ORDER BY count DESC
    `).all(...pSession);

    const operatingSystems = localDb.prepare(`
      SELECT os_name, COUNT(*) as count
      FROM sessions
      ${timeSessionClause}
      GROUP BY os_name
      ORDER BY count DESC
      LIMIT 6
    `).all(...pSession);

    const browsers = localDb.prepare(`
      SELECT browser_name, COUNT(*) as count
      FROM sessions
      ${timeSessionClause}
      GROUP BY browser_name
      ORDER BY count DESC
      LIMIT 6
    `).all(...pSession);

    const recentEvents = localDb.prepare(`
      SELECT *
      FROM events
      ${timeEventClause}
      ORDER BY created_at DESC
      LIMIT 40
    `).all(...pEvent);

    const recentErrors = localDb.prepare(`
      SELECT *
      FROM errors
      ${timeEventClause}
      ORDER BY created_at DESC
      LIMIT 20
    `).all(...pEvent);

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
        total_events: totalEvents,
        total_errors: totalErrors,
        avg_duration: Math.round(avgDuration)
      },
      timeline,
      topPages,
      topClicks,
      devices,
      operatingSystems,
      browsers,
      recentEvents,
      recentErrors,
      period,
      periodLabel: label,
      isHourly
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
