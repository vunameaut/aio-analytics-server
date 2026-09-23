# 🚀 All-in-One Analytics Server (Hệ Thống Thống Kê Tập Trung Toàn Diện)

Hệ thống máy chủ thống kê tập trung cho tất cả các dự án **Web, Mobile App (Flutter, React Native, iOS, Android), Desktop App và Backend Services**.

**Đặc điểm nổi bật:**
- 🎯 **Tự động nhận diện nền tảng**: Chỉ cần nhúng 1 đoạn mã, server tự động phân tích User-Agent, Headers và Metadata để phân loại sản phẩm là **Web**, **Mobile Android**, **Mobile iOS**, **Desktop App** hay **Backend API**.
- ⚡ **Auto-Discovery (Tự đăng ký)**: Không cần phải vào Dashboard tạo dự án thủ công. Khi dự án mới gửi sự kiện đầu tiên về, hệ thống sẽ tự động tạo dự án mới và vẽ biểu đồ ngay lập tức.
- 🟢 **Real-time Live Stream**: Cập nhật tức thời số người dùng online (Active Now) và dòng sự kiện trực tiếp qua Server-Sent Events (SSE).
- 💾 **Cơ sở dữ liệu SQLite siêu tốc (WAL mode)**: Zero-config, không cần cài MySQL/PostgreSQL, tốc độ xử lý hàng nghìn sự kiện/giây, toàn bộ dữ liệu lưu trữ an toàn trong file `data/analytics.db`.
- 📊 **Dashboard Cyber Glassmorphism**: Giao diện tối màu hiện đại, trực quan, hỗ trợ xem biểu đồ lưu lượng, top trang/màn hình xem nhiều nhất, thiết bị, hệ điều hành và nhật ký lỗi/crash.

---

## 🛠️ Hướng Dẫn Khởi Chạy Server

### 1. Khởi động máy chủ
Trong thư mục dự án, chạy lệnh:
```bash
npm start
```
Server sẽ chạy tại cổng **3000** (hoặc cổng được định nghĩa trong file `.env`):
- 📊 **Dashboard UI**: [http://localhost:3000](http://localhost:3000)
- 📦 **Web Tracker Script**: [http://localhost:3000/tracker.js](http://localhost:3000/tracker.js)
- 📡 **Ingestion API**: [http://localhost:3000/api/v1/track](http://localhost:3000/api/v1/track)

### 2. Chạy thử nghiệm dữ liệu mẫu (Seed Data)
Mở một cửa sổ dòng lệnh khác và chạy:
```bash
npm run seed
```
Lệnh này sẽ tự động giả lập gửi dữ liệu từ 4 nền tảng khác nhau (Web Shopee Clone, App Flutter Android, App React Native iOS, Python Backend API) và báo cáo lỗi mẫu. Bạn sẽ thấy Dashboard lập tức xuất hiện các dự án và số liệu sống động!

---

## 🔌 Hướng Dẫn Nhúng Vào Các Dự Án Của Bạn

### 1. Đối Với Website (HTML, React, Next.js, Vue, WordPress...)
Dán đúng **1 dòng mã duy nhất** vào thẻ `<head>` của trang web:
```html
<script src="http://<IP-HOAC-DOMAIN-SERVER>:3000/tracker.js" data-project="ten-web-cua-ban" async></script>
```
*Tự động thu thập: Pageview, Single Page Application (SPA) URL changes, thời gian xem trang (Session duration qua heartbeat), thiết bị, hệ điều hành, trình duyệt, và bắt lỗi Javascript chưa được xử lý.*

Khi muốn theo dõi sự kiện tùy chỉnh (mua hàng, click nút...):
```js
// Trong code JS của bạn:
window.AIOTracker.track('mua_hang_thanh_cong', { so_tien: 250000, ma_don: 'DH01' });
```

---

### 2. Đối Với Mobile App (Flutter)
1. Thêm dependency vào `pubspec.yaml`:
   ```yaml
   dependencies:
     http: ^1.2.0
   ```
2. Copy file `sdk/flutter/aio_tracker.dart` vào thư mục `lib/` trong dự án Flutter của bạn.
3. Trong hàm `main()`:
   ```dart
   import 'package:flutter/material.dart';
   import 'aio_tracker.dart';

   void main() async {
     WidgetsFlutterBinding.ensureInitialized();
     await AIOTracker.init(
       serverUrl: 'http://<IP-SERVER>:3000',
       projectId: 'app-ban-hang-flutter',
       appName: 'App Bán Hàng Flutter',
     );
     runApp(const MyApp());
   }
   ```
4. Theo dõi màn hình hoặc sự kiện:
   ```dart
   AIOTracker.trackScreen('ManHinhGioHang');
   AIOTracker.trackEvent('click_thanh_toan', properties: {'tong_tien': 150000});
   ```

---

### 3. Đối Với Mobile App (React Native)
1. Copy file `sdk/react-native/aioTracker.js` vào dự án React Native.
2. Khởi tạo trong `App.js`:
   ```js
   import React, { useEffect } from 'react';
   import AIOTracker from './aioTracker';

   export default function App() {
     useEffect(() => {
       AIOTracker.init({
         serverUrl: 'http://<IP-SERVER>:3000',
         projectId: 'my-rn-app',
         appName: 'App React Native'
       });
     }, []);

     return <YourAppView />;
   }
   ```
3. Theo dõi màn hình hoặc sự kiện:
   ```js
   AIOTracker.trackScreen('ProfileScreen');
   AIOTracker.trackEvent('user_rated_5_stars', { stars: 5 });
   ```

---

### 4. Đối Với Backend / Python / Microservices
Copy file `sdk/python/aio_tracker.py` hoặc gọi trực tiếp HTTP:
```python
from aio_tracker import AIOTracker

tracker = AIOTracker("http://<IP-SERVER>:3000", "my-payment-service", "Payment API")
tracker.track_event("giao_dich_thanh_cong", {"amount": 500000, "status": "OK"})
```

---

### 5. Gửi Thử Bằng cURL / Postman
```bash
curl -X POST "http://localhost:3000/api/v1/track" \
  -H "Content-Type: application/json" \
  -H "X-Platform: backend" \
  -d '{
    "projectId": "test-curl-project",
    "projectName": "Dự Án Test cURL",
    "eventType": "custom",
    "eventName": "Manual Ping",
    "properties": { "version": "1.0.0" }
  }'
```

---

## 🗄️ Cấu Trúc Cơ Sở Dữ Liệu
Cơ sở dữ liệu được lưu tự động tại `data/analytics.db` gồm các bảng:
- `projects`: Lưu danh sách các dự án, nền tảng nhận diện (`platforms_seen`), thời điểm hoạt động cuối cùng, tổng số sự kiện, tổng phiên và tổng số lỗi.
- `sessions`: Lưu thông tin từng phiên truy cập của người dùng (OS, Trình duyệt, Thiết bị, Độ phân giải màn hình, IP ẩn danh, Thời lượng truy cập).
- `events`: Lưu mọi hành động (Pageview, Screen view, Custom events, Clicks, v.v.).
- `errors`: Báo cáo chi tiết các lỗi crash, biệt lệ và lỗi JavaScript cùng stack trace.
