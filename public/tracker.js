(function () {
  'use strict';

  // 1. Tự động tìm thẻ script đang load để lấy data-project và URL server
  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var projectId = currentScript ? (currentScript.getAttribute('data-project') || currentScript.getAttribute('data-app') || 'my-website') : 'my-website';
  var scriptSrc = currentScript ? currentScript.src : '';
  var serverUrl = '';

  try {
    if (scriptSrc) {
      var parsedUrl = new URL(scriptSrc);
      serverUrl = parsedUrl.origin;
    }
  } catch (e) {
    serverUrl = window.location.origin;
  }

  // 2. Quản lý Session ID trong sessionStorage
  var SESSION_KEY = 'aio_tracker_session_' + projectId;
  var sessionId = '';
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = 's_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
  } catch (e) {
    sessionId = 's_' + Math.random().toString(36).substring(2, 12);
  }

  var userId = null;

  // 3. Hàm gửi dữ liệu về Server (Fetch / Beacon)
  function sendPayload(endpoint, data) {
    var fullUrl = (serverUrl || '') + endpoint;
    var body = JSON.stringify(data);

    if (navigator.sendBeacon && endpoint === '/api/v1/heartbeat') {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(fullUrl, blob);
        return;
      } catch (e) {}
    }

    fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Platform': 'web'
      },
      body: body,
      keepalive: true
    }).catch(function () {});
  }

  // 4. Theo dõi Lượt xem trang (Pageview)
  function trackPageView(customPath) {
    var path = customPath || window.location.pathname + window.location.search;
    sendPayload('/api/v1/track', {
      projectId: projectId,
      sessionId: sessionId,
      userId: userId,
      platform: 'web',
      eventType: 'pageview',
      eventName: document.title || 'Page View',
      path: path,
      referrer: document.referrer || '',
      screenRes: window.screen.width + 'x' + window.screen.height,
      url: window.location.href
    });
  }

  // 5. Theo dõi Sự kiện tùy chỉnh (Custom Event)
  function trackEvent(eventName, properties) {
    sendPayload('/api/v1/track', {
      projectId: projectId,
      sessionId: sessionId,
      userId: userId,
      platform: 'web',
      eventType: 'custom',
      eventName: eventName,
      path: window.location.pathname,
      properties: properties || {}
    });
  }

  // 6. Theo dõi Lỗi (Error tracking)
  function trackError(message, stack, line) {
    sendPayload('/api/v1/track', {
      projectId: projectId,
      sessionId: sessionId,
      platform: 'web',
      eventType: 'error',
      eventName: 'JavaScript Error',
      path: window.location.pathname,
      error: {
        message: message,
        stack: stack || '',
        line: line || ''
      }
    });
  }

  // 7. Heartbeat định kỳ (mỗi 20 giây) & khi chuyển/đóng tab để đo chính xác thời gian dùng
  function sendHeartbeat() {
    sendPayload('/api/v1/heartbeat', {
      projectId: projectId,
      sessionId: sessionId
    });
  }

  // 8. Tự động theo dõi các nút bấm và tính năng người dùng hay ấn (Auto-Click Tracker)
  function setupAutoClickTracking() {
    document.addEventListener('click', function (e) {
      try {
        var target = e.target;
        if (!target) return;
        var clickable = target.closest('button, a, [data-track], [role="button"], input[type="button"], input[type="submit"]');
        if (!clickable) return;

        var label = '';
        if (clickable.getAttribute('data-track')) {
          label = clickable.getAttribute('data-track');
        } else if (clickable.getAttribute('aria-label')) {
          label = clickable.getAttribute('aria-label');
        } else if (clickable.innerText && clickable.innerText.trim()) {
          label = clickable.innerText.trim().replace(/\s+/g, ' ').substring(0, 50);
        } else if (clickable.getAttribute('title')) {
          label = clickable.getAttribute('title');
        } else if (clickable.id) {
          label = '#' + clickable.id;
        } else if (clickable.tagName && clickable.tagName.toLowerCase() === 'a' && clickable.getAttribute('href')) {
          label = 'Link: ' + clickable.getAttribute('href');
        } else {
          label = clickable.tagName ? clickable.tagName.toLowerCase() : 'element';
        }

        var eventName = 'Nút: ' + label;

        sendPayload('/api/v1/track', {
          projectId: projectId,
          sessionId: sessionId,
          userId: userId,
          platform: 'web',
          eventType: 'click',
          eventName: eventName,
          path: window.location.pathname,
          properties: {
            tag: clickable.tagName ? clickable.tagName.toLowerCase() : '',
            id: clickable.id || '',
            text: label
          }
        });
      } catch (err) {}
    }, true);
  }

  // Tự động kích hoạt khi trang tải xong
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    trackPageView();
    setupAutoClickTracking();
  } else {
    window.addEventListener('DOMContentLoaded', function () {
      trackPageView();
      setupAutoClickTracking();
    });
  }

  // Heartbeat timer
  setInterval(sendHeartbeat, 20000);

  // Ghi nhận thời gian dùng khi người dùng ẩn tab hoặc rời trang
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      sendHeartbeat();
    }
  });
  window.addEventListener('pagehide', sendHeartbeat);
  window.addEventListener('beforeunload', sendHeartbeat);

  // 8. Tự động hỗ trợ SPA Routing (React, Vue, Next.js, Angular, v.v.)
  var lastPathname = window.location.pathname;
  function handleUrlChange() {
    var newPathname = window.location.pathname;
    if (newPathname !== lastPathname) {
      lastPathname = newPathname;
      setTimeout(function () {
        trackPageView();
      }, 50);
    }
  }

  if (window.history && window.history.pushState) {
    var originalPush = window.history.pushState;
    window.history.pushState = function () {
      originalPush.apply(this, arguments);
      handleUrlChange();
    };

    var originalReplace = window.history.replaceState;
    window.history.replaceState = function () {
      originalReplace.apply(this, arguments);
      handleUrlChange();
    };

    window.addEventListener('popstate', handleUrlChange);
  }

  // 9. Bắt lỗi không mong muốn trên trình duyệt (Uncaught JS Errors)
  window.addEventListener('error', function (e) {
    try {
      trackError(
        e.message || 'Script error',
        e.error ? e.error.stack : (e.filename + ':' + e.lineno),
        e.lineno ? String(e.lineno) : ''
      );
    } catch (err) {}
  });

  window.addEventListener('unhandledrejection', function (e) {
    try {
      var reason = e.reason;
      trackError(
        reason && reason.message ? reason.message : 'Unhandled Promise Rejection',
        reason && reason.stack ? reason.stack : String(reason),
        ''
      );
    } catch (err) {}
  });

  // 10. Xuất API toàn cục để lập trình viên sử dụng
  window.AIOTracker = {
    projectId: projectId,
    sessionId: sessionId,
    track: trackEvent,
    page: trackPageView,
    error: trackError,
    identify: function (newUserId) {
      userId = newUserId;
    },
    setServerUrl: function (url) {
      serverUrl = url;
    }
  };
})();
