const express = require('express');
const router = express.Router();
const dataStore = require('../dataStore');
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
 * Thống kê tổng quan toàn bộ hệ thống (Hỗ trợ Supabase Cloud & Local)
 */
router.get('/overview', async (req, res) => {
  try {
    const overview = await dataStore.getOverview();
    return res.json(overview);
  } catch (err) {
    console.error('[Dashboard Overview Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/dashboard/projects
 * Danh sách toàn bộ dự án với trạng thái hoạt động
 */
router.get('/projects', async (req, res) => {
  try {
    const projects = await dataStore.getProjects();
    return res.json(projects);
  } catch (err) {
    console.error('[Dashboard Projects Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/dashboard/projects/:id
 * Chi tiết thống kê của 1 dự án cụ thể
 */
router.get('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const detail = await dataStore.getProjectDetail(id);
    if (!detail) {
      return res.status(404).json({ error: 'Project not found' });
    }
    return res.json(detail);
  } catch (err) {
    console.error('[Project Detail Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/dashboard/projects/:id
 * Xóa một dự án và toàn bộ dữ liệu thống kê liên quan
 */
router.delete('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await dataStore.deleteProject(id);
    return res.json({ success, deleted: success });
  } catch (err) {
    console.error('[Delete Project Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
