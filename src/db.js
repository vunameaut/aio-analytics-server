const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'analytics.db');
const db = new Database(dbPath);

// Enable WAL mode for high-concurrency writes
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform_type TEXT DEFAULT 'web',
    platforms_seen TEXT DEFAULT '[]',
    origin_domain TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    total_events INTEGER DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT,
    ip_hash TEXT,
    platform TEXT,
    device_type TEXT,
    os_name TEXT,
    os_version TEXT,
    browser_name TEXT,
    browser_version TEXT,
    screen_res TEXT,
    country TEXT DEFAULT 'VN',
    city TEXT DEFAULT '',
    started_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_name TEXT NOT NULL,
    path_or_screen TEXT,
    referrer TEXT,
    properties TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    session_id TEXT,
    message TEXT NOT NULL,
    stack TEXT,
    line TEXT,
    url_or_screen TEXT,
    platform TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_projects_last_seen ON projects(last_seen_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);
  CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_errors_project ON errors(project_id, created_at);
`);

module.exports = db;
