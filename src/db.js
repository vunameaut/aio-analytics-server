const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    console.warn('[DB] Cannot create dataDir:', e.message);
  }
}

const dbPath = path.join(dataDir, 'analytics.db');

let db = null;
let engineName = 'unknown';

// 1. Thử dùng better-sqlite3 (hiệu năng cao nhất trên máy chủ thông thường)
try {
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  engineName = 'better-sqlite3';
} catch (errBetter) {
  // 2. Thử dùng node:sqlite (tích hợp sẵn trong Node.js 22+, không cần binary C++)
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath);
    db.pragma = (str) => {
      try { db.exec(`PRAGMA ${str};`); } catch (e) {}
    };
    db.pragma('journal_mode = WAL');
    engineName = 'node:sqlite';
  } catch (errNodeSqlite) {
    // 3. Fallback an toàn tuyệt đối (Pure JS In-Memory & File Store) - Đảm bảo chạy 100% trên Wasmer Edge
    const jsonDbPath = path.join(dataDir, 'analytics_store.json');
    let memoryStore = {
      projects: {},
      sessions: {},
      events: [],
      errors: []
    };

    if (fs.existsSync(jsonDbPath)) {
      try {
        memoryStore = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
      } catch (e) {}
    }

    function saveStore() {
      try {
        fs.writeFileSync(jsonDbPath, JSON.stringify(memoryStore, null, 2), 'utf8');
      } catch (e) {}
    }

    db = {
      pragma: () => {},
      exec: () => {},
      prepare: (sql) => {
        const norm = sql.toUpperCase().replace(/\s+/g, ' ').trim();
        return {
          run: (...params) => {
            if (norm.includes('INSERT INTO PROJECTS')) {
              const [id, name, platform_type, platforms_seen, origin_domain, created_at, last_seen_at, total_errors] = params;
              memoryStore.projects[id] = {
                id, name, platform_type, platforms_seen, origin_domain,
                created_at, last_seen_at, total_events: 1, total_sessions: 1, total_errors: total_errors || 0
              };
            } else if (norm.includes('UPDATE PROJECTS SET LAST_SEEN_AT')) {
              const [last_seen_at, platforms_seen, origin_domain, id] = params;
              if (memoryStore.projects[id]) {
                memoryStore.projects[id].last_seen_at = last_seen_at;
                memoryStore.projects[id].total_events = (memoryStore.projects[id].total_events || 0) + 1;
                memoryStore.projects[id].platforms_seen = platforms_seen;
                if (origin_domain) memoryStore.projects[id].origin_domain = origin_domain;
              }
            } else if (norm.includes('UPDATE PROJECTS SET TOTAL_ERRORS')) {
              const [id] = params;
              if (memoryStore.projects[id]) memoryStore.projects[id].total_errors = (memoryStore.projects[id].total_errors || 0) + 1;
            } else if (norm.includes('UPDATE PROJECTS SET TOTAL_SESSIONS')) {
              const [id] = params;
              if (memoryStore.projects[id]) memoryStore.projects[id].total_sessions = (memoryStore.projects[id].total_sessions || 0) + 1;
            } else if (norm.includes('INSERT INTO SESSIONS')) {
              const [session_id, project_id, user_id, ip_hash, platform, device_type, os_name, os_version, browser_name, browser_version, screen_res, country, city, started_at, last_active_at] = params;
              memoryStore.sessions[session_id] = {
                session_id, project_id, user_id, ip_hash, platform, device_type, os_name, os_version, browser_name, browser_version, screen_res, country, city, started_at, last_active_at, duration_seconds: 0
              };
            } else if (norm.includes('UPDATE SESSIONS SET LAST_ACTIVE_AT')) {
              const [last_active_at, nowTime, session_id] = params;
              if (memoryStore.sessions[session_id]) {
                memoryStore.sessions[session_id].last_active_at = last_active_at;
                const start = new Date(memoryStore.sessions[session_id].started_at).getTime();
                const now = new Date(nowTime).getTime();
                memoryStore.sessions[session_id].duration_seconds = Math.max(0, Math.floor((now - start) / 1000));
              }
            } else if (norm.includes('INSERT INTO EVENTS')) {
              const [project_id, session_id, event_type, event_name, path_or_screen, referrer, properties, created_at] = params;
              memoryStore.events.push({
                id: memoryStore.events.length + 1,
                project_id, session_id, event_type, event_name, path_or_screen, referrer, properties, created_at
              });
            } else if (norm.includes('INSERT INTO ERRORS')) {
              const [project_id, session_id, message, stack, line, url_or_screen, platform, created_at] = params;
              memoryStore.errors.push({
                id: memoryStore.errors.length + 1,
                project_id, session_id, message, stack, line, url_or_screen, platform, created_at
              });
            } else if (norm.includes('DELETE FROM PROJECTS WHERE ID')) {
              const [id] = params;
              delete memoryStore.projects[id];
            } else if (norm.includes('DELETE FROM EVENTS WHERE PROJECT_ID')) {
              const [id] = params;
              memoryStore.events = memoryStore.events.filter(e => e.project_id !== id);
            } else if (norm.includes('DELETE FROM ERRORS WHERE PROJECT_ID')) {
              const [id] = params;
              memoryStore.errors = memoryStore.errors.filter(e => e.project_id !== id);
            } else if (norm.includes('DELETE FROM SESSIONS WHERE PROJECT_ID')) {
              const [id] = params;
              Object.keys(memoryStore.sessions).forEach(sid => {
                if (memoryStore.sessions[sid].project_id === id) delete memoryStore.sessions[sid];
              });
            }
            saveStore();
            return { changes: 1, lastInsertRowid: 1 };
          },
          get: (...params) => {
            if (norm.includes('FROM PROJECTS WHERE ID = ?')) {
              const [id] = params;
              return memoryStore.projects[id] || undefined;
            }
            if (norm.includes('FROM SESSIONS WHERE SESSION_ID = ?')) {
              const [sessionId] = params;
              return memoryStore.sessions[sessionId] || undefined;
            }
            if (norm.includes('COUNT(DISTINCT SESSION_ID)') && norm.includes('PROJECT_ID = ?')) {
              const [projectId, timeThreshold] = params;
              const count = Object.values(memoryStore.sessions).filter(s => s.project_id === projectId && s.last_active_at >= timeThreshold).length;
              return { count };
            }
            if (norm.includes('COUNT(DISTINCT SESSION_ID)')) {
              const [timeThreshold] = params;
              const active = Object.values(memoryStore.sessions).filter(s => s.last_active_at >= timeThreshold);
              return { count: active.length };
            }
            if (norm.includes('COUNT(*) AS COUNT FROM PROJECTS') || norm.includes('COUNT(*) FROM PROJECTS')) {
              return { count: Object.keys(memoryStore.projects).length };
            }
            if (norm.includes('COUNT(*) AS COUNT FROM EVENTS') || norm.includes('COUNT(*) FROM EVENTS')) {
              const [timeThreshold] = params;
              const evts = memoryStore.events.filter(e => !timeThreshold || e.created_at >= timeThreshold);
              return { count: evts.length };
            }
            if (norm.includes('COUNT(*) AS COUNT FROM ERRORS') || norm.includes('COUNT(*) FROM ERRORS')) {
              const [timeThreshold] = params;
              const errs = memoryStore.errors.filter(e => !timeThreshold || e.created_at >= timeThreshold);
              return { count: errs.length };
            }
            return undefined;
          },
          all: (...params) => {
            if (norm.includes('PLATFORM') && norm.includes('GROUP BY')) {
              const [timeThreshold] = params;
              const map = {};
              Object.values(memoryStore.sessions).forEach(s => {
                if (!timeThreshold || s.started_at >= timeThreshold) {
                  map[s.platform] = (map[s.platform] || 0) + 1;
                }
              });
              return Object.entries(map).map(([platform, sessions_count]) => ({ platform, sessions_count }));
            }
            if (norm.includes('FROM PROJECTS') && (norm.includes('ORDER BY') || norm.includes('ACTIVE_NOW'))) {
              const [fiveMin] = params;
              return Object.values(memoryStore.projects).map(p => {
                const active_now = Object.values(memoryStore.sessions).filter(s => s.project_id === p.id && (!fiveMin || s.last_active_at >= fiveMin)).length;
                return { ...p, active_now };
              }).sort((a, b) => (b.last_seen_at || '').localeCompare(a.last_seen_at || ''));
            }
            if (norm.includes('SUBSTR(CREATED_AT') || norm.includes('GROUP BY SUBSTR')) {
              const [projectId, sevenDaysAgo] = params;
              const dateMap = {};
              memoryStore.events.filter(e => e.project_id === projectId && (!sevenDaysAgo || e.created_at >= sevenDaysAgo)).forEach(e => {
                const d = e.created_at.substring(0, 10);
                if (!dateMap[d]) dateMap[d] = { date: d, count: 0, visitorsSet: new Set() };
                dateMap[d].count++;
                dateMap[d].visitorsSet.add(e.session_id);
              });
              return Object.values(dateMap).map(v => ({ date: v.date, count: v.count, visitors: v.visitorsSet.size }));
            }
            if (norm.includes('PATH_OR_SCREEN') && norm.includes('GROUP BY')) {
              const [projectId] = params;
              const pageMap = {};
              memoryStore.events.filter(e => e.project_id === projectId && ['pageview', 'screen_view'].includes(e.event_type)).forEach(e => {
                const p = e.path_or_screen || '/';
                pageMap[p] = (pageMap[p] || 0) + 1;
              });
              return Object.entries(pageMap).map(([path_or_screen, views]) => ({ path_or_screen, views })).sort((a, b) => b.views - a.views).slice(0, 10);
            }
            if (norm.includes('DEVICE_TYPE') && norm.includes('GROUP BY')) {
              const [projectId] = params;
              const map = {};
              Object.values(memoryStore.sessions).filter(s => s.project_id === projectId).forEach(s => {
                const k = s.device_type || 'desktop';
                map[k] = (map[k] || 0) + 1;
              });
              return Object.entries(map).map(([device_type, count]) => ({ device_type, count })).sort((a, b) => b.count - a.count);
            }
            if (norm.includes('OS_NAME') && norm.includes('GROUP BY')) {
              const [projectId] = params;
              const map = {};
              Object.values(memoryStore.sessions).filter(s => s.project_id === projectId).forEach(s => {
                const k = s.os_name || 'Unknown';
                map[k] = (map[k] || 0) + 1;
              });
              return Object.entries(map).map(([os_name, count]) => ({ os_name, count })).sort((a, b) => b.count - a.count).slice(0, 6);
            }
            if (norm.includes('BROWSER_NAME') && norm.includes('GROUP BY')) {
              const [projectId] = params;
              const map = {};
              Object.values(memoryStore.sessions).filter(s => s.project_id === projectId).forEach(s => {
                const k = s.browser_name || 'Unknown';
                map[k] = (map[k] || 0) + 1;
              });
              return Object.entries(map).map(([browser_name, count]) => ({ browser_name, count })).sort((a, b) => b.count - a.count).slice(0, 6);
            }
            if (norm.includes('FROM EVENTS WHERE PROJECT_ID = ?')) {
              const [projectId] = params;
              return memoryStore.events.filter(e => e.project_id === projectId).slice(-40).reverse();
            }
            if (norm.includes('FROM ERRORS WHERE PROJECT_ID = ?')) {
              const [projectId] = params;
              return memoryStore.errors.filter(e => e.project_id === projectId).slice(-20).reverse();
            }
            return [];
          }
        };
      }
    };
    engineName = 'pure-js-fallback';
  }
}

console.log(`[Database] Đang sử dụng engine: ${engineName}`);

// Tạo bảng nếu chưa tồn tại
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
    duration_seconds INTEGER DEFAULT 0
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
    created_at TEXT NOT NULL
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
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_projects_last_seen ON projects(last_seen_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_errors_project ON errors(project_id, created_at);
`);

module.exports = db;
