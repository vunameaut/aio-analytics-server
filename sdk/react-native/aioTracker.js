import { Platform, Dimensions } from 'react-native';

/**
 * All-in-One Analytics SDK cho React Native
 * Cách dùng:
 * ```js
 * import AIOTracker from './aioTracker';
 * AIOTracker.init({
 *   serverUrl: 'http://192.168.1.100:3000',
 *   projectId: 'my-rn-app',
 *   appName: 'My React Native App'
 * });
 * ```
 */
class AIOTrackerClient {
  constructor() {
    this.serverUrl = '';
    this.projectId = '';
    this.appName = '';
    this.sessionId = '';
    this.userId = null;
    this.timer = null;
    this.initialized = false;
  }

  init({ serverUrl, projectId, appName, userId }) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.projectId = projectId;
    this.appName = appName || projectId;
    this.userId = userId || null;
    this.sessionId = 'rn_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    this.initialized = true;

    // Theo dõi màn hình khởi động
    this.trackScreen('AppLaunch');

    // Heartbeat
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.heartbeat(), 30000);
  }

  trackScreen(screenName) {
    if (!this.initialized) return;
    const { width, height } = Dimensions.get('window');
    const platform = Platform.OS === 'ios' ? 'mobile_ios' : 'mobile_android';

    this.send('/api/v1/track', {
      projectId: this.projectId,
      projectName: this.appName,
      sessionId: this.sessionId,
      userId: this.userId,
      platform: platform,
      eventType: 'screen_view',
      eventName: `Screen: ${screenName}`,
      screen: screenName,
      os: Platform.OS === 'ios' ? 'iOS' : 'Android',
      osVersion: String(Platform.Version),
      browser: 'React Native',
      screenRes: `${Math.round(width)}x${Math.round(height)}`,
      clientSdk: 'react-native'
    });
  }

  trackEvent(eventName, properties = {}) {
    if (!this.initialized) return;
    const platform = Platform.OS === 'ios' ? 'mobile_ios' : 'mobile_android';

    this.send('/api/v1/track', {
      projectId: this.projectId,
      sessionId: this.sessionId,
      userId: this.userId,
      platform: platform,
      eventType: 'custom',
      eventName: eventName,
      properties: properties,
      clientSdk: 'react-native'
    });
  }

  trackError(error, context = '') {
    if (!this.initialized) return;
    const platform = Platform.OS === 'ios' ? 'mobile_ios' : 'mobile_android';

    this.send('/api/v1/track', {
      projectId: this.projectId,
      sessionId: this.sessionId,
      platform: platform,
      eventType: 'error',
      eventName: 'React Native Error',
      path: context,
      error: {
        message: error ? error.message || String(error) : 'Unknown error',
        stack: error ? error.stack || '' : ''
      },
      clientSdk: 'react-native'
    });
  }

  identify(userId) {
    this.userId = userId;
  }

  heartbeat() {
    if (!this.initialized) return;
    this.send('/api/v1/heartbeat', {
      projectId: this.projectId,
      sessionId: this.sessionId
    });
  }

  send(endpoint, data) {
    fetch(`${this.serverUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Platform': Platform.OS === 'ios' ? 'mobile_ios' : 'mobile_android',
        'X-Client-Sdk': 'react-native'
      },
      body: JSON.stringify(data)
    }).catch(() => {});
  }
}

const AIOTracker = new AIOTrackerClient();
export default AIOTracker;
