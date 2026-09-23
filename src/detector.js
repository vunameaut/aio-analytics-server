const { UAParser } = require('ua-parser-js');
const crypto = require('crypto');

/**
 * Phân tích và tự động nhận diện thiết bị, hệ điều hành và nền tảng ứng dụng
 * @param {import('express').Request} req
 * @param {Object} payload Dữ liệu client gửi kèm (nếu có)
 */
function detectClientEnvironment(req, payload = {}) {
  const ua = req.headers['user-agent'] || payload.userAgent || '';
  const parser = new UAParser(ua);
  const result = parser.getResult();

  // 1. Kiểm tra các header hoặc payload chỉ định nền tảng (nếu SDK gửi kèm)
  const explicitPlatform = (
    payload.platform ||
    req.headers['x-platform'] ||
    req.headers['x-client-platform'] ||
    ''
  ).toLowerCase();

  const clientSdk = (
    payload.clientSdk ||
    req.headers['x-client-sdk'] ||
    ''
  ).toLowerCase();

  const origin = req.headers['origin'] || req.headers['referer'] || payload.url || '';
  let originDomain = '';
  try {
    if (origin && origin.startsWith('http')) {
      const urlObj = new URL(origin);
      originDomain = urlObj.hostname;
    }
  } catch (e) {
    originDomain = '';
  }

  // 2. Phân tích chi tiết OS, Trình duyệt, Thiết bị
  let osName = payload.os || result.os.name || 'Unknown OS';
  let osVersion = payload.osVersion || result.os.version || '';
  let browserName = payload.browser || result.browser.name || '';
  let browserVersion = payload.browserVersion || result.browser.version || '';
  let deviceType = result.device.type || 'desktop';

  // 3. Logic Tự Động Phân Loại Nền Tảng (Platform Type)
  let platformType = 'web'; // Mặc định là web

  if (explicitPlatform) {
    if (explicitPlatform.includes('flutter')) {
      platformType = osName.toLowerCase().includes('ios') ? 'mobile_ios' : 'mobile_android';
      deviceType = 'mobile';
      browserName = browserName || 'Flutter App';
    } else if (explicitPlatform.includes('react-native') || explicitPlatform.includes('react_native')) {
      platformType = osName.toLowerCase().includes('ios') ? 'mobile_ios' : 'mobile_android';
      deviceType = 'mobile';
      browserName = browserName || 'React Native App';
    } else if (explicitPlatform.includes('ios')) {
      platformType = 'mobile_ios';
      deviceType = 'mobile';
      browserName = browserName || 'iOS Native App';
    } else if (explicitPlatform.includes('android')) {
      platformType = 'mobile_android';
      deviceType = 'mobile';
      browserName = browserName || 'Android Native App';
    } else if (['desktop', 'electron', 'tauri', 'wpf', 'macos_app'].includes(explicitPlatform)) {
      platformType = 'desktop';
      deviceType = 'desktop';
    } else if (['backend', 'api', 'server', 'cli', 'python', 'cron'].includes(explicitPlatform)) {
      platformType = 'backend';
      deviceType = 'server';
    } else {
      platformType = explicitPlatform;
    }
  } else {
    // Không có explicitPlatform -> Tự động suy đoán từ User-Agent & Headers
    const uaLower = ua.toLowerCase();

    // Phát hiện Backend / CLI / Scripts
    if (
      uaLower.includes('curl/') ||
      uaLower.includes('postmanruntime') ||
      uaLower.includes('python-requests') ||
      uaLower.includes('axios/') ||
      uaLower.includes('node-fetch') ||
      uaLower.includes('go-http-client') ||
      uaLower.includes('aio-backend-tracker')
    ) {
      platformType = 'backend';
      deviceType = 'server';
      browserName = browserName || 'HTTP Client / API';
    }
    // Phát hiện Flutter / Dart Client
    else if (uaLower.includes('dart/') || uaLower.includes('flutter')) {
      platformType = uaLower.includes('iphone') || uaLower.includes('ios') ? 'mobile_ios' : 'mobile_android';
      deviceType = 'mobile';
      browserName = 'Flutter App';
    }
    // Phát hiện Mobile Native (OkHttp trên Android, CFNetwork / Darwin trên iOS)
    else if (uaLower.includes('okhttp') || uaLower.includes('dalvik')) {
      platformType = 'mobile_android';
      deviceType = 'mobile';
      osName = 'Android';
      browserName = 'Android Native App';
    } else if (uaLower.includes('cfnetwork') || (uaLower.includes('darwin') && !uaLower.includes('safari'))) {
      platformType = 'mobile_ios';
      deviceType = 'mobile';
      osName = 'iOS';
      browserName = 'iOS Native App';
    }
    // Phát hiện Desktop App (Electron, Tauri)
    else if (uaLower.includes('electron') || uaLower.includes('tauri')) {
      platformType = 'desktop';
      deviceType = 'desktop';
      browserName = uaLower.includes('electron') ? 'Electron App' : 'Tauri App';
    }
    // Môi trường Web thông thường
    else {
      platformType = 'web';
      if (!browserName) {
        browserName = 'Web Browser';
      }
      if (['mobile', 'tablet'].includes(result.device.type)) {
        deviceType = result.device.type;
      }
    }
  }

  // 4. Mã hóa IP ẩn danh (bảo vệ quyền riêng tư người dùng)
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const ipHash = crypto.createHash('sha256').update(String(clientIp)).digest('hex').substring(0, 16);

  return {
    platformType,
    clientSdk: clientSdk || platformType,
    osName,
    osVersion,
    browserName,
    browserVersion,
    deviceType,
    originDomain,
    screenRes: payload.screenRes || '',
    ipHash
  };
}

module.exports = {
  detectClientEnvironment
};
