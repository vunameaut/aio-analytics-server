const http = require('http');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = process.env.PORT || 3000;

function sendEvent(headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path: '/api/v1/track',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          resolve(responseBody);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function seed() {
  console.log('🌱 Bắt đầu tạo dữ liệu mẫu từ nhiều nền tảng để kiểm tra nhận diện tự động...\n');

  // 1. Giả lập ứng dụng Web Thương Mại Điện Tử (Chrome / Windows)
  console.log('1. [WEB] Giả lập truy cập từ Website (Chrome Desktop)...');
  const webSession = 's_web_' + Math.random().toString(36).substring(2, 8);
  const webUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  
  await sendEvent({ 'User-Agent': webUa }, {
    projectId: 'shopee-clone-web',
    projectName: 'Shopee Clone Web',
    sessionId: webSession,
    eventType: 'pageview',
    eventName: 'Trang chủ',
    path: '/',
    screenRes: '1920x1080'
  });
  await sleep(100);

  await sendEvent({ 'User-Agent': webUa }, {
    projectId: 'shopee-clone-web',
    sessionId: webSession,
    eventType: 'custom',
    eventName: 'add_to_cart',
    path: '/san-pham/giay-sneaker',
    properties: { product_name: 'Sneaker Retro', price: 650000 }
  });
  await sleep(100);

  // 2. Giả lập ứng dụng Flutter Mobile trên Android
  console.log('2. [MOBILE ANDROID] Giả lập truy cập từ Flutter App (Android 14)...');
  const flutterSession = 'fl_android_' + Math.random().toString(36).substring(2, 8);
  const flutterUa = 'Dart/3.4 (dart:io) Flutter/3.22.0 (Android 14; SM-S928B Build/UP1A.231005.007)';

  await sendEvent({
    'User-Agent': flutterUa,
    'X-Platform': 'mobile_android',
    'X-Client-Sdk': 'flutter'
  }, {
    projectId: 'food-delivery-flutter',
    projectName: 'Food Delivery App (Flutter)',
    sessionId: flutterSession,
    eventType: 'screen_view',
    eventName: 'Screen: RestaurantListScreen',
    screen: 'RestaurantListScreen',
    os: 'Android 14',
    browser: 'Flutter Engine'
  });
  await sleep(100);

  await sendEvent({
    'User-Agent': flutterUa,
    'X-Platform': 'mobile_android',
    'X-Client-Sdk': 'flutter'
  }, {
    projectId: 'food-delivery-flutter',
    sessionId: flutterSession,
    eventType: 'custom',
    eventName: 'place_order',
    screen: 'CheckoutScreen',
    properties: { restaurant: 'Trà Sữa Gong Cha', total_bill: 85000 }
  });
  await sleep(100);

  // 3. Giả lập ứng dụng React Native Mobile trên iOS (iPhone 15)
  console.log('3. [MOBILE IOS] Giả lập truy cập từ React Native iOS (iPhone)...');
  const iosSession = 'rn_ios_' + Math.random().toString(36).substring(2, 8);
  const iosUa = 'FitnessTracker/1.0.2 CFNetwork/1494.0.7 Darwin/23.4.0 (iPhone; iOS 17.4)';

  await sendEvent({
    'User-Agent': iosUa,
    'X-Platform': 'mobile_ios',
    'X-Client-Sdk': 'react-native'
  }, {
    projectId: 'fitness-tracker-app',
    projectName: 'Fitness Tracker iOS',
    sessionId: iosSession,
    eventType: 'screen_view',
    eventName: 'Screen: WorkoutSummary',
    screen: 'WorkoutSummary',
    os: 'iOS 17.4',
    browser: 'React Native'
  });
  await sleep(100);

  // 4. Giả lập Backend API Service (Python / FastAPI)
  console.log('4. [BACKEND API] Giả lập sự kiện từ Backend Service (Python)...');
  const pyUa = 'python-requests/2.31.0 AIO-Backend-Tracker';

  await sendEvent({
    'User-Agent': pyUa,
    'X-Platform': 'backend',
    'X-Client-Sdk': 'python'
  }, {
    projectId: 'payment-gateway-service',
    projectName: 'Payment Gateway API',
    eventType: 'custom',
    eventName: 'webhook_momo_processed',
    path: '/api/v1/webhooks/momo',
    properties: { trans_id: 'MM98124', amount: 1200000, status: 'SUCCESS' }
  });
  await sleep(100);

  // 5. Giả lập báo cáo Lỗi (Crash / JS Error)
  console.log('5. [ERROR LOG] Giả lập ghi nhận lỗi từ ứng dụng...');
  await sendEvent({ 'User-Agent': webUa }, {
    projectId: 'shopee-clone-web',
    sessionId: webSession,
    eventType: 'error',
    eventName: 'JavaScript Exception',
    path: '/thanh-toan',
    error: {
      message: 'Uncaught TypeError: Cannot read properties of undefined (reading "voucherCode")',
      stack: 'TypeError: Cannot read properties of undefined (reading "voucherCode")\n    at checkout.js:142:15\n    at HTMLButtonElement.dispatch (bundle.js:89:12)'
    }
  });

  console.log('\n✅ HOÀN TẤT! Toàn bộ 4 loại nền tảng (Web, Mobile Android, Mobile iOS, Backend) đã được gửi đến server.');
  console.log('👉 Hãy mở trình duyệt truy cập: http://localhost:' + SERVER_PORT + ' để xem Dashboard.');
}

seed().catch(err => {
  console.error('❌ Lỗi khi gửi dữ liệu mẫu (Hãy chắc chắn server đang chạy trước):', err.message);
});
