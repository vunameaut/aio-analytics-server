require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const trackRoutes = require('./routes/track');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*', // Cho phép mọi website / app gửi sự kiện thống kê về
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Platform', 'X-Client-Sdk', 'X-Project-Id']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Phục vụ file tĩnh (Dashboard UI & tracker.js)
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/v1', trackRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// Fallback route cho Single Page Application (SPA Dashboard)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && req.path !== '/tracker.js') {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

// Khởi chạy server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ==============================================================
   🚀 ALL-IN-ONE ANALYTICS SERVER ĐANG CHẠY!
  ==============================================================
   📊 Dashboard UI:       http://localhost:${PORT}
   📦 Web Tracker Script: http://localhost:${PORT}/tracker.js
   📡 Ingestion API:      http://localhost:${PORT}/api/v1/track
   ⚡ Database:           SQLite WAL mode (data/analytics.db)
  ==============================================================
  `);
});
