const { createClient } = require('@supabase/supabase-js');

// Hỗ trợ linh hoạt mọi tên biến môi trường mà người dùng / nền tảng có thể đặt
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                    process.env.SUPABASE_SERVICE_KEY || 
                    process.env.SUPABASE_KEY || 
                    process.env.SUPABASE_ANON_KEY || 
                    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase = null;
let isConfigured = false;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    isConfigured = true;
    console.log('[Database] ✅ Đã kết nối Supabase Cloud Database:', supabaseUrl);
  } catch (err) {
    console.error('[Database] ❌ Lỗi khởi tạo Supabase client:', err.message);
  }
} else {
  console.log('[Database] ℹ️ Chưa có SUPABASE_URL & SUPABASE_KEY. Đang dùng local fallback store.');
}

module.exports = {
  supabase,
  isConfigured: () => isConfigured,
  getEngineName: () => (isConfigured ? 'supabase' : null),

  // 1. Overview
  async getOverview() {
    if (!isConfigured) return null;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: activeNow },
      { count: totalProjects },
      { count: totalVisitors },
      { count: events24h },
      { count: errors24h },
      { data: durationRows },
      { data: platformRows }
    ] = await Promise.all([
      supabase.from('sessions').select('*', { count: 'exact', head: true }).gte('last_active_at', fiveMinutesAgo),
      supabase.from('projects').select('*', { count: 'exact', head: true }),
      supabase.from('sessions').select('*', { count: 'exact', head: true }),
      supabase.from('events').select('*', { count: 'exact', head: true }).gte('created_at', twentyFourHoursAgo),
      supabase.from('errors').select('*', { count: 'exact', head: true }).gte('created_at', twentyFourHoursAgo),
      supabase.from('sessions').select('duration_seconds').gt('duration_seconds', 0).limit(2000),
      supabase.from('sessions').select('platform').gte('started_at', twentyFourHoursAgo).limit(5000)
    ]);

    const avgDuration = durationRows && durationRows.length
      ? Math.round(durationRows.reduce((sum, r) => sum + (r.duration_seconds || 0), 0) / durationRows.length)
      : 0;

    const distMap = {};
    (platformRows || []).forEach(r => {
      const plat = r.platform || 'web';
      distMap[plat] = (distMap[plat] || 0) + 1;
    });
    const platformsDistribution = Object.entries(distMap).map(([platform, sessions_count]) => ({
      platform,
      sessions_count
    }));

    return {
      activeNow: activeNow || 0,
      totalProjects: totalProjects || 0,
      totalVisitors: totalVisitors || 0,
      avgDuration,
      events24h: events24h || 0,
      errors24h: errors24h || 0,
      platformsDistribution,
      engine: 'supabase'
    };
  },

  // 2. Danh sách dự án
  async getProjects() {
    if (!isConfigured) return null;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ data: projects }, { data: activeSessions }] = await Promise.all([
      supabase.from('projects').select('*').order('last_seen_at', { ascending: false }),
      supabase.from('sessions').select('project_id').gte('last_active_at', fiveMinutesAgo)
    ]);

    const activeMap = {};
    (activeSessions || []).forEach(s => {
      activeMap[s.project_id] = (activeMap[s.project_id] || 0) + 1;
    });

    return (projects || []).map(p => {
      let status = 'inactive';
      if (p.last_seen_at >= tenMinutesAgo) {
        status = 'active';
      } else if (p.last_seen_at >= oneDayAgo) {
        status = 'idle';
      }

      let platformsSeen = [];
      try {
        platformsSeen = typeof p.platforms_seen === 'string' ? JSON.parse(p.platforms_seen) : (p.platforms_seen || []);
      } catch (e) {
        platformsSeen = [p.platform_type];
      }

      return {
        ...p,
        status,
        active_now: activeMap[p.id] || 0,
        platforms_seen: platformsSeen
      };
    });
  },

  // 3. Chi tiết dự án
  async getProjectDetail(id) {
    if (!isConfigured) return null;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: project } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
    if (!project) return null;

    const [
      { count: activeNow },
      { count: totalVisitors },
      { data: durationRows },
      { data: timelineEvents },
      { data: pageEvents },
      { data: clickEvents },
      { data: sessionRows },
      { data: recentEvents },
      { data: recentErrors }
    ] = await Promise.all([
      supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('project_id', id).gte('last_active_at', fiveMinutesAgo),
      supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('project_id', id),
      supabase.from('sessions').select('duration_seconds').eq('project_id', id).gt('duration_seconds', 0),
      supabase.from('events').select('created_at, session_id').eq('project_id', id).gte('created_at', sevenDaysAgo).limit(10000),
      supabase.from('events').select('path_or_screen').eq('project_id', id).in('event_type', ['pageview', 'screen_view']).limit(5000),
      supabase.from('events').select('event_name').eq('project_id', id).in('event_type', ['click', 'action', 'custom']).limit(5000),
      supabase.from('sessions').select('device_type, os_name, browser_name').eq('project_id', id).limit(5000),
      supabase.from('events').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(40),
      supabase.from('errors').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(20)
    ]);

    const avgDuration = durationRows && durationRows.length
      ? Math.round(durationRows.reduce((a, b) => a + (b.duration_seconds || 0), 0) / durationRows.length)
      : 0;

    // Timeline 7 ngày
    const dateMap = {};
    (timelineEvents || []).forEach(e => {
      const d = String(e.created_at).substring(0, 10);
      if (!dateMap[d]) dateMap[d] = { date: d, count: 0, visitorsSet: new Set() };
      dateMap[d].count++;
      if (e.session_id) dateMap[d].visitorsSet.add(e.session_id);
    });
    const timeline = Object.values(dateMap)
      .map(v => ({ date: v.date, count: v.count, visitors: v.visitorsSet.size }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top Pages
    const pageMap = {};
    (pageEvents || []).forEach(e => {
      const p = e.path_or_screen || '/';
      pageMap[p] = (pageMap[p] || 0) + 1;
    });
    const topPages = Object.entries(pageMap)
      .map(([path_or_screen, views]) => ({ path_or_screen, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // Top Clicks
    const clickMap = {};
    (clickEvents || []).forEach(e => {
      const name = e.event_name || 'Action';
      clickMap[name] = (clickMap[name] || 0) + 1;
    });
    const topClicks = Object.entries(clickMap)
      .map(([event_name, count]) => ({ event_name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Breakdown Thiết bị, OS, Trình duyệt
    const devMap = {};
    const osMap = {};
    const brMap = {};
    (sessionRows || []).forEach(s => {
      devMap[s.device_type || 'desktop'] = (devMap[s.device_type || 'desktop'] || 0) + 1;
      osMap[s.os_name || 'Unknown'] = (osMap[s.os_name || 'Unknown'] || 0) + 1;
      brMap[s.browser_name || 'Unknown'] = (brMap[s.browser_name || 'Unknown'] || 0) + 1;
    });

    const devices = Object.entries(devMap).map(([device_type, count]) => ({ device_type, count })).sort((a, b) => b.count - a.count);
    const operatingSystems = Object.entries(osMap).map(([os_name, count]) => ({ os_name, count })).sort((a, b) => b.count - a.count).slice(0, 6);
    const browsers = Object.entries(brMap).map(([browser_name, count]) => ({ browser_name, count })).sort((a, b) => b.count - a.count).slice(0, 6);

    let platformsSeen = [];
    try {
      platformsSeen = typeof project.platforms_seen === 'string' ? JSON.parse(project.platforms_seen) : (project.platforms_seen || []);
    } catch (e) {
      platformsSeen = [project.platform_type];
    }

    return {
      project: {
        ...project,
        platforms_seen: platformsSeen,
        active_now: activeNow || 0,
        total_visitors: totalVisitors || 0,
        avg_duration: avgDuration
      },
      timeline,
      topPages,
      topClicks,
      devices,
      operatingSystems,
      browsers,
      recentEvents: recentEvents || [],
      recentErrors: recentErrors || []
    };
  },

  // 4. Xóa dự án
  async deleteProject(id) {
    if (!isConfigured) return null;
    await supabase.from('events').delete().eq('project_id', id);
    await supabase.from('errors').delete().eq('project_id', id);
    await supabase.from('sessions').delete().eq('project_id', id);
    const { error } = await supabase.from('projects').delete().eq('id', id);
    return !error;
  },

  // 5. Ghi nhận sự kiện Tracking
  async recordEvent(req, payload, env, now) {
    if (!isConfigured) return null;

    let rawProjectId = payload.projectId || payload.project_id || payload.appId || req.headers['x-project-id'] || 'default-project';
    const projectId = String(rawProjectId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const projectName = payload.projectName || payload.appName || projectId;
    const isErrorEvent = payload.eventType === 'error' || Boolean(payload.error);

    // Kiểm tra & cập nhật dự án
    const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();

    if (!project) {
      await supabase.from('projects').insert({
        id: projectId,
        name: projectName,
        platform_type: env.platformType,
        platforms_seen: [env.platformType],
        origin_domain: env.originDomain,
        created_at: now,
        last_seen_at: now,
        total_events: 1,
        total_sessions: 1,
        total_errors: isErrorEvent ? 1 : 0
      });
    } else {
      let platformsSeen = Array.isArray(project.platforms_seen) ? project.platforms_seen : [];
      if (!platformsSeen.includes(env.platformType)) {
        platformsSeen.push(env.platformType);
      }
      await supabase.from('projects').update({
        last_seen_at: now,
        total_events: (project.total_events || 0) + 1,
        total_errors: (project.total_errors || 0) + (isErrorEvent ? 1 : 0),
        platforms_seen: platformsSeen,
        origin_domain: env.originDomain || project.origin_domain
      }).eq('id', projectId);
    }

    // Quản lý Phiên làm việc (Session)
    const { v4: uuidv4 } = require('uuid');
    const sessionId = payload.sessionId || payload.session_id || uuidv4();
    const { data: existingSession } = await supabase.from('sessions').select('*').eq('session_id', sessionId).maybeSingle();

    if (!existingSession) {
      await supabase.from('sessions').insert({
        session_id: sessionId,
        project_id: projectId,
        user_id: payload.userId || null,
        ip_hash: env.ipHash,
        platform: env.platformType,
        device_type: env.deviceType,
        os_name: env.osName,
        os_version: env.osVersion,
        browser_name: env.browserName,
        browser_version: env.browserVersion,
        screen_res: env.screenRes,
        country: payload.country || 'VN',
        city: payload.city || '',
        started_at: now,
        last_active_at: now,
        duration_seconds: 0
      });
      if (project) {
        await supabase.from('projects').update({
          total_sessions: (project.total_sessions || 0) + 1
        }).eq('id', projectId);
      }
    } else {
      const startMs = new Date(existingSession.started_at).getTime();
      const nowMs = new Date(now).getTime();
      const durationSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      await supabase.from('sessions').update({
        last_active_at: now,
        duration_seconds: durationSeconds
      }).eq('session_id', sessionId);
    }

    // Ghi nhận sự kiện (Event)
    const eventType = payload.eventType || payload.event_type || 'pageview';
    const eventName = payload.eventName || payload.event_name || (eventType === 'pageview' ? 'Page View' : eventType);
    const pathOrScreen = payload.path || payload.screen || payload.url || '/';
    const referrer = payload.referrer || '';
    const properties = payload.properties || null;

    await supabase.from('events').insert({
      project_id: projectId,
      session_id: sessionId,
      event_type: eventType,
      event_name: eventName,
      path_or_screen: pathOrScreen,
      referrer: referrer,
      properties: properties,
      created_at: now
    });

    // Ghi nhận Lỗi nếu có
    if (isErrorEvent) {
      const errorData = payload.error || {};
      await supabase.from('errors').insert({
        project_id: projectId,
        session_id: sessionId,
        message: errorData.message || payload.message || 'Unknown error',
        stack: errorData.stack || payload.stack || '',
        line: errorData.line || payload.line || '',
        url_or_screen: pathOrScreen,
        platform: env.platformType,
        created_at: now
      });
    }

    return {
      success: true,
      projectId,
      sessionId,
      platform: env.platformType,
      deviceType: env.deviceType
    };
  },

  // 6. Ghi nhận Heartbeat
  async recordHeartbeat(sessionId) {
    if (!isConfigured || !sessionId) return;
    const { data: session } = await supabase.from('sessions').select('started_at').eq('session_id', sessionId).maybeSingle();
    if (session) {
      const now = new Date().toISOString();
      const startMs = new Date(session.started_at).getTime();
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      await supabase.from('sessions').update({
        last_active_at: now,
        duration_seconds: durationSeconds
      }).eq('session_id', sessionId);
    }
  }
};
