const express = require('express');
const router = express.Router();
const db = require('../db');
const eventHub = require('../eventHub');

/**
 * GET /api/v1/dashboard/realtime
 * Đăng ký Server-Sent Events (SSE) để nhận cập nhật trực tiếp
 */
router.get('/realtime', (req, res) => {
  eventHub.subscribe(req, res);
});

/**
 * GET /api/v1/dashboard/overview
 * Thống kê tổng quan toàn bộ hệ thống
 */
router.get('/overview', (req, res) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Số người dùng đang online (hoạt động trong 5 phút qua)
    const activeNowRow = db.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      WHERE last_active_at >= ?
    `).get(fiveMinutesAgo);

    // 2. Tổng số dự án
    const totalProjectsRow = db.prepare(`SELECT COUNT(*) as count FROM projects`).get();

    // 3. Tổng số người dùng duy nhất (Visitors)
    const totalVisitorsRow = db.prepare(`SELECT COUNT(DISTINCT session_id) as count FROM sessions`).get();

    // 4. Thời gian dùng trung bình (giây)
    const avgDurationRow = db.prepare(`
      SELECT AVG(duration_seconds) as avg_duration 
      FROM sessions 
      WHERE duration_seconds > 0
    `).get();

    // 5. Tổng số sự kiện trong 24h qua
    const events24hRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM events 
      WHERE created_at >= ?
    `).get(twentyFourHoursAgo);

    // 6. Tổng số lỗi trong 24h qua
    const errors24hRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM errors 
      WHERE created_at >= ?
    `).get(twentyFourHoursAgo);

    // 7. Phân bổ theo nền tảng
    const platformsDistribution = db.prepare(`
      SELECT platform, COUNT(DISTINCT session_id) as sessions_count
      FROM sessions
      WHERE started_at >= ?
      GROUP BY platform
    `).all(twentyFourHoursAgo);

    return res.json({
      activeNow: activeNowRow?.count || 0,
      totalProjects: totalProjectsRow?.count || 0,
      totalVisitors: totalVisitorsRow?.count || 0,
      avgDuration: Math.round(avgDurationRow?.avg_duration || 0),
      events24h: events24hRow?.count || 0,
      errors24h: errors24hRow?.count || 0,
      platformsDistribution
    });
  } catch (err) {
    console.error('[Dashboard Overview Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/dashboard/projects
 * Danh sách toàn bộ dự án với trạng thái hoạt động
 */
router.get('/projects', (req, res) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const projects = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(DISTINCT s.session_id) 
         FROM sessions s 
         WHERE s.project_id = p.id AND s.last_active_at >= ?) as active_now
      FROM projects p
      ORDER BY p.last_seen_at DESC
    `).all(fiveMinutesAgo);

    const formatted = projects.map(p => {
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

    return res.json(formatted);
  } catch (err) {
    console.error('[Dashboard Projects Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/dashboard/projects/:id
 * Chi tiết thống kê của 1 dự án cụ thể
 */
router.get('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Số người dùng đang online tại dự án này
    const activeNow = db.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      WHERE project_id = ? AND last_active_at >= ?
    `).get(id, fiveMinutesAgo)?.count || 0;

    // 2. Tổng số khách truy cập duy nhất của dự án này
    const totalVisitors = db.prepare(`
      SELECT COUNT(DISTINCT session_id) as count 
      FROM sessions 
      WHERE project_id = ?
    `).get(id)?.count || 0;

    // 3. Thời gian dùng trung bình (giây) của dự án này
    const avgDuration = db.prepare(`
      SELECT AVG(duration_seconds) as avg_duration 
      FROM sessions 
      WHERE project_id = ? AND duration_seconds > 0
    `).get(id)?.avg_duration || 0;

    // 4. Timeline sự kiện 7 ngày qua (theo ngày)
    const timeline = db.prepare(`
      SELECT substr(created_at, 1, 10) as date, COUNT(*) as count, COUNT(DISTINCT session_id) as visitors
      FROM events
      WHERE project_id = ? AND created_at >= ?
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `).all(id, sevenDaysAgo);

    // 5. Top trang / Màn hình xem nhiều nhất
    const topPages = db.prepare(`
      SELECT path_or_screen, COUNT(*) as views
      FROM events
      WHERE project_id = ? AND event_type IN ('pageview', 'screen_view')
      GROUP BY path_or_screen
      ORDER BY views DESC
      LIMIT 10
    `).all(id);

    // 6. Top chức năng & Nút bấm hay ấn nhất (Clicks & Actions)
    const topClicks = db.prepare(`
      SELECT event_name, COUNT(*) as count 
      FROM events 
      WHERE project_id = ? AND event_type IN ('click', 'action', 'custom') 
      GROUP BY event_name 
      ORDER BY count DESC 
      LIMIT 10
    `).all(id);

    // 7. Phân loại thiết bị
    const devices = db.prepare(`
      SELECT device_type, COUNT(*) as count
      FROM sessions
      WHERE project_id = ?
      GROUP BY device_type
      ORDER BY count DESC
    `).all(id);

    // 8. Hệ điều hành
    const operatingSystems = db.prepare(`
      SELECT os_name, COUNT(*) as count
      FROM sessions
      WHERE project_id = ?
      GROUP BY os_name
      ORDER BY count DESC
      LIMIT 6
    `).all(id);

    // 9. Trình duyệt / Client
    const browsers = db.prepare(`
      SELECT browser_name, COUNT(*) as count
      FROM sessions
      WHERE project_id = ?
      GROUP BY browser_name
      ORDER BY count DESC
      LIMIT 6
    `).all(id);

    // 10. Các sự kiện gần nhất (Stream 40 events)
    const recentEvents = db.prepare(`
      SELECT *
      FROM events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 40
    `).all(id);

    // 11. Các lỗi gần nhất (Errors 20 logs)
    const recentErrors = db.prepare(`
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

    return res.json({
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
    });
  } catch (err) {
    console.error('[Project Detail Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/dashboard/projects/:id
 * Xóa một dự án và toàn bộ dữ liệu thống kê liên quan
 */
router.delete('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM events WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM errors WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE project_id = ?').run(id);
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);

    return res.json({ success: true, deleted: result.changes > 0 });
  } catch (err) {
    console.error('[Delete Project Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
