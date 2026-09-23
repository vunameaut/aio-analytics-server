/**
 * Mẫu mã nguồn nhúng thống kê cho từng loại nền tảng
 */
const SnippetGenerator = {
  getSnippet(platform, serverOrigin, projectId) {
    const origin = serverOrigin || window.location.origin;
    const pid = projectId || 'my-project-name';

    switch (platform) {
      case 'web':
        return `<!-- 1. Dán đúng 1 dòng này vào thẻ <head> của bất kỳ trang web nào (HTML, WordPress, v.v.) -->
<script 
  src="${origin}/tracker.js" 
  data-project="${pid}" 
  async>
</script>

<!-- Tự động theo dõi: Lượt xem trang, phiên truy cập, thời lượng, trình duyệt, thiết bị, lỗi JavaScript! -->

<!-- (Tùy chọn) Bắn sự kiện tùy ý bất cứ lúc nào trong mã JavaScript của bạn: -->
<script>
  // window.AIOTracker.track('click_button_mua_hang', { gia_tien: 500000, ma_sp: 'SP01' });
</script>`;

      case 'react':
        return `// Dành cho Next.js, React, Vue, Vite, Nuxt:
// Trong file App.jsx / _app.js / layout.tsx:
import { useEffect } from 'react';

export default function RootLayout({ children }) {
  useEffect(() => {
    // Chỉ cần chèn script 1 lần khi load app
    const script = document.createElement('script');
    script.src = '${origin}/tracker.js';
    script.setAttribute('data-project', '${pid}');
    script.async = true;
    document.head.appendChild(script);
  }, []);

  return <>{children}</>;
}

// Khi muốn theo dõi sự kiện tùy chỉnh (mua hàng, click, v.v.):
// window.AIOTracker?.track('user_signup', { plan: 'pro' });`;

      case 'flutter':
        return `// 1. Thêm gói http vào pubspec.yaml:
// dependencies:
//   http: ^1.2.0

// 2. Tải hoặc copy file 'sdk/flutter/aio_tracker.dart' vào thư mục 'lib/' của bạn.
// 3. Khởi tạo trong hàm main() của app:
import 'package:flutter/material.dart';
import 'aio_tracker.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Khởi tạo tracker
  await AIOTracker.init(
    serverUrl: '${origin}',
    projectId: '${pid}',
    appName: 'Tên App Của Bạn',
  );

  runApp(const MyApp());
}

// 4. Theo dõi màn hình hoặc sự kiện trong App:
// AIOTracker.trackScreen('ManHinhChiTietSanPham');
// AIOTracker.trackEvent('click_nap_tien', properties: {'so_tien': 100000});`;

      case 'react_native':
        return `// 1. Copy file 'sdk/react-native/aioTracker.js' vào dự án React Native của bạn.
// 2. Khởi tạo trong App.js / index.js:
import React, { useEffect } from 'react';
import AIOTracker from './aioTracker';

export default function App() {
  useEffect(() => {
    AIOTracker.init({
      serverUrl: '${origin}',
      projectId: '${pid}',
      appName: 'Tên Ứng Dụng Mobile'
    });
  }, []);

  return (
    // ... giao diện app của bạn
  );
}

// 3. Theo dõi chuyển màn hình hoặc sự kiện:
// AIOTracker.trackScreen('ProfileScreen');
// AIOTracker.trackEvent('order_completed', { orderId: 'HD992' });`;

      case 'python':
        return `# Dành cho Python Backend, FastAPI, Flask, Django, CLI scripts:
import requests

def track_event(event_name, properties=None):
    try:
        requests.post(
            "${origin}/api/v1/track",
            json={
                "projectId": "${pid}",
                "platform": "backend",
                "eventType": "custom",
                "eventName": event_name,
                "properties": properties or {}
            },
            headers={"X-Platform": "backend"},
            timeout=2
        )
    except Exception:
        pass

# Gọi bất cứ khi nào có request hoặc tác vụ chạy xong:
track_event("api_order_created", {"user_id": 1234, "total": 250000})`;

      case 'curl':
        return `# Gửi một sự kiện từ cURL / Terminal / Postman:
curl -X POST "${origin}/api/v1/track" \\
  -H "Content-Type: application/json" \\
  -H "X-Platform: backend" \\
  -d '{
    "projectId": "${pid}",
    "projectName": "My Custom Project",
    "eventType": "custom",
    "eventName": "Manual Ping",
    "properties": { "status": "ok", "version": "1.0.0" }
  }'`;

      default:
        return '';
    }
  }
};
