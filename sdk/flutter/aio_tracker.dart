import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;

/// All-in-One Analytics SDK cho Flutter
/// Sử dụng:
/// ```dart
/// void main() async {
///   WidgetsFlutterBinding.ensureInitialized();
///   await AIOTracker.init(
///     serverUrl: 'http://192.168.1.100:3000',
///     projectId: 'my-flutter-shop',
///     appName: 'My Shop Flutter App',
///   );
///   runApp(MyApp());
/// }
/// ```
class AIOTracker {
  static late String _serverUrl;
  static late String _projectId;
  static late String _appName;
  static String? _sessionId;
  static String? _userId;
  static Timer? _heartbeatTimer;

  static bool _initialized = false;

  /// Khởi tạo Tracker cho Flutter App
  static Future<void> init({
    required String serverUrl,
    required String projectId,
    String? appName,
    String? initialUserId,
  }) async {
    _serverUrl = serverUrl.replaceAll(RegExp(r'/+$'), '');
    _projectId = projectId;
    _appName = appName ?? projectId;
    _userId = initialUserId;
    _sessionId = 'fl_${DateTime.now().millisecondsSinceEpoch}_${(1000 + (DateTime.now().microsecond % 9000))}';

    _initialized = true;

    // Gửi sự kiện mở app đầu tiên
    await trackScreen('AppLaunch');

    // Bắt đầu timer heartbeat mỗi 30s
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (timer) {
      _sendHeartbeat();
    });
  }

  /// Theo dõi Màn hình (Screen View)
  static Future<void> trackScreen(String screenName) async {
    if (!_initialized) return;

    final osName = Platform.isAndroid ? 'Android' : (Platform.isIOS ? 'iOS' : Platform.operatingSystem);
    final platform = Platform.isIOS ? 'mobile_ios' : 'mobile_android';

    await _send('/api/v1/track', {
      'projectId': _projectId,
      'projectName': _appName,
      'sessionId': _sessionId,
      'userId': _userId,
      'platform': platform,
      'eventType': 'screen_view',
      'eventName': 'Screen: $screenName',
      'screen': screenName,
      'os': osName,
      'osVersion': Platform.operatingSystemVersion,
      'browser': 'Flutter Engine',
      'clientSdk': 'flutter',
    });
  }

  /// Theo dõi Sự kiện tùy chọn (Nút bấm, Mua hàng, v.v.)
  static Future<void> trackEvent(String eventName, {Map<String, dynamic>? properties}) async {
    if (!_initialized) return;

    final platform = Platform.isIOS ? 'mobile_ios' : 'mobile_android';

    await _send('/api/v1/track', {
      'projectId': _projectId,
      'sessionId': _sessionId,
      'userId': _userId,
      'platform': platform,
      'eventType': 'custom',
      'eventName': eventName,
      'properties': properties ?? {},
      'clientSdk': 'flutter',
    });
  }

  /// Gửi báo cáo lỗi Crash / Exception
  static Future<void> trackError(dynamic error, dynamic stackTrace, {String? context}) async {
    if (!_initialized) return;

    final platform = Platform.isIOS ? 'mobile_ios' : 'mobile_android';

    await _send('/api/v1/track', {
      'projectId': _projectId,
      'sessionId': _sessionId,
      'platform': platform,
      'eventType': 'error',
      'eventName': 'Flutter Exception',
      'path': context ?? 'Unhandled',
      'error': {
        'message': error.toString(),
        'stack': stackTrace.toString(),
      },
      'clientSdk': 'flutter',
    });
  }

  /// Thiết lập ID người dùng (sau khi đăng nhập)
  static void identify(String userId) {
    _userId = userId;
  }

  static Future<void> _sendHeartbeat() async {
    if (!_initialized) return;
    await _send('/api/v1/heartbeat', {
      'projectId': _projectId,
      'sessionId': _sessionId,
    });
  }

  static Future<void> _send(String endpoint, Map<String, dynamic> data) async {
    try {
      final uri = Uri.parse('$_serverUrl$endpoint');
      await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'X-Platform': Platform.isIOS ? 'mobile_ios' : 'mobile_android',
          'X-Client-Sdk': 'flutter',
        },
        body: jsonEncode(data),
      ).timeout(const Duration(seconds: 4));
    } catch (_) {
      // Âm thầm bỏ qua lỗi kết nối mạng để không ảnh hưởng đến app
    }
  }

  static void dispose() {
    _heartbeatTimer?.cancel();
  }
}
