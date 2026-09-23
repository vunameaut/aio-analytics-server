-- ==============================================================================
-- 🚀 AIO ANALYTICS SERVER - SUPABASE POSTGRESQL SCHEMA
-- Copy & dán toàn bộ đoạn SQL này vào "SQL Editor" trên trang quản trị Supabase
-- rồi nhấn "Run" để tự động tạo bảng, khóa phụ, chỉ mục và quyền truy cập.
-- ==============================================================================

-- 1. Bảng lưu trữ Danh sách Dự án
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform_type TEXT DEFAULT 'web',
  platforms_seen JSONB DEFAULT '[]'::jsonb,
  origin_domain TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  total_events BIGINT DEFAULT 0,
  total_sessions BIGINT DEFAULT 0,
  total_errors BIGINT DEFAULT 0
);

-- 2. Bảng lưu trữ Phiên người dùng (Sessions)
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  duration_seconds INTEGER DEFAULT 0
);

-- 3. Bảng lưu trữ Sự kiện (Events: Pageviews, Clicks, Screenviews, Actions)
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  path_or_screen TEXT,
  referrer TEXT,
  properties JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Bảng lưu trữ Lỗi & Crash (Errors)
CREATE TABLE IF NOT EXISTS errors (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  line TEXT,
  url_or_screen TEXT,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tạo các Chỉ mục (Indexes) để tăng tốc độ truy vấn phân tích
CREATE INDEX IF NOT EXISTS idx_projects_last_seen ON projects(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(project_id, event_type);
CREATE INDEX IF NOT EXISTS idx_errors_project ON errors(project_id, created_at DESC);

-- 6. Thiết lập Row Level Security (RLS) để cho phép Server Analytics ghi/đọc dữ liệu
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to projects" ON projects;
CREATE POLICY "Allow all access to projects" ON projects FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to sessions" ON sessions;
CREATE POLICY "Allow all access to sessions" ON sessions FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to events" ON events;
CREATE POLICY "Allow all access to events" ON events FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to errors" ON errors;
CREATE POLICY "Allow all access to errors" ON errors FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);
