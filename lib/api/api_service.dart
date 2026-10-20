import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'api_endpoints.dart';
import '../models/sia_board_item.dart';
import '../services/app_prefs.dart';
import '../services/offline_status_service.dart';
import '../services/profile_avatar_cache.dart';

/// Notifies persistent headers when the signed-in user changes their photo.
final ValueNotifier<String?> profilePictureNotifier =
    ValueNotifier<String?>(null);

/// Fired when the API returns 401 (e.g. signed in on another device).
final ValueNotifier<String?> sessionExpiredNotifier =
    ValueNotifier<String?>(null);

// ── Errors ────────────────────────────────────────────────────────────────────

class ApiException implements Exception {
  final int statusCode;
  final String message;
  final String? originalError;
  final bool isNetworkError;
  final bool isTimeout;

  const ApiException(this.statusCode, this.message, {this.originalError, this.isNetworkError = false, this.isTimeout = false});

  /// Convenience when status is unknown (client-side failures).
  const ApiException.message(this.message, {this.originalError, this.isNetworkError = false, this.isTimeout = false}) : statusCode = 0;

  /// Network error constructor
  const ApiException.network(this.message, {this.originalError}) : statusCode = 0, isNetworkError = true, isTimeout = false;

  /// Timeout error constructor
  const ApiException.timeout(this.message, {this.originalError}) : statusCode = 0, isNetworkError = false, isTimeout = true;

  @override
  String toString() => message;
  
  /// User-friendly error message
  String get userMessage {
    if (isNetworkError) {
      return 'Network error. Please check your internet connection and try again.';
    }
    if (isTimeout) {
      return 'Request timed out. Please try again.';
    }
    if (statusCode == 401) {
      return 'Session expired. Please log in again.';
    }
    if (statusCode == 403) {
      return 'Access denied. You don\'t have permission for this action.';
    }
    if (statusCode == 404) {
      return 'Resource not found. It may have been moved or deleted.';
    }
    if (statusCode == 500) {
      return 'Server error. Please try again later.';
    }
    if (statusCode == 503) {
      return 'Service unavailable. Please try again later.';
    }
    return message;
  }
}

// ── API client ──────────────────────────────────────────────────────────────

class ApiService {
  ApiService._();
  static final ApiService _instance = ApiService._();
  factory ApiService() => _instance;

  static const _kAccessToken = 'access_token';
  static const _kRefreshToken = 'refresh_token';
  static const _kUserRole = 'user_role';
  static const _kUserId = 'user_id';
  static const _kSetupComplete = 'setup_complete';
  static const _kOnboardingSeen = 'onboarding_seen';
  static const _kProfilePicture = 'profile_picture_url';

  /// Where to land after app restart: `league` or `student`.
  static const _kAppResumeMode = 'app_resume_mode';
  static const _studentMe = '/api/v1/students/me';

  // ── Token storage ─────────────────────────────────────────────────────────

  Future<String?> getToken() async {
    final prefs = await AppPrefs.instance();
    return prefs.getString(_kAccessToken);
  }

  Future<String?> getRole() async {
    final prefs = await AppPrefs.instance();
    return prefs.getString(_kUserRole);
  }

  Future<String?> getUserId() async {
    final prefs = await AppPrefs.instance();
    return prefs.getString(_kUserId);
  }

  /// Persist last area so restart reopens League or Student home.
  Future<void> setAppResumeMode(String mode) async {
    final prefs = await AppPrefs.instance();
    final m = mode.toLowerCase().trim();
    if (m == 'league' || m == 'student') {
      await prefs.setString(_kAppResumeMode, m);
    }
  }

  Future<String> getAppResumeMode() async {
    final prefs = await AppPrefs.instance();
    return (prefs.getString(_kAppResumeMode) ?? 'student').toLowerCase();
  }

  Future<void> clearTokens() async {
    final prefs = await AppPrefs.instance();
    await prefs.remove(_kAccessToken);
    await prefs.remove(_kRefreshToken);
    await prefs.remove(_kUserRole);
    await prefs.remove(_kUserId);
    await prefs.remove(_kSetupComplete);
    await prefs.remove(_kProfilePicture);
    await prefs.remove(_kAppResumeMode);
    profilePictureNotifier.value = null;
  }

  Future<void> cacheProfilePicture(String? url) async {
    final prefs = await AppPrefs.instance();
    final resolved = resolveMediaUrl(url);
    if (resolved.isEmpty) {
      await prefs.remove(_kProfilePicture);
    } else {
      await prefs.setString(_kProfilePicture, resolved);
    }
  }

  Future<String?> cachedProfilePicture() async {
    final prefs = await AppPrefs.instance();
    final raw = prefs.getString(_kProfilePicture);
    if (raw == null || raw.isEmpty) return null;
    return resolveMediaUrl(raw);
  }

  Future<bool> hasSeenOnboarding() async {
    final prefs = await AppPrefs.instance();
    return prefs.getBool(_kOnboardingSeen) ?? false;
  }

  Future<void> markOnboardingSeen() async {
    final prefs = await AppPrefs.instance();
    await prefs.setBool(_kOnboardingSeen, true);
  }

  Future<void> _saveRole(String role) async {
    final prefs = await AppPrefs.instance();
    await prefs.setString(_kUserRole, role.toLowerCase().trim());
  }

  Future<void> _saveAuth(AuthResponse auth) async {
    final prefs = await AppPrefs.instance();
    await prefs.setString(_kAccessToken, auth.accessToken);
    await prefs.setString(_kRefreshToken, auth.refreshToken);
    await prefs.setString(_kUserRole, auth.role.toLowerCase().trim());
    if (auth.userId != null && auth.userId!.isNotEmpty) {
      await prefs.setString(_kUserId, auth.userId!);
    }
    await markOnboardingSeen();
  }

  /// Resolve role from storage or API (fixes teachers sent to exam setup).
  Future<String?> resolveSessionRole() async {
    var role = (await getRole())?.toLowerCase().trim();
    if (role == 'teacher' || role == 'student' || role == 'kind' || role == 'vendor') {
      return role;
    }

    try {
      await getTeacherMe();
      await _saveRole('teacher');
      return 'teacher';
    } catch (_) {}

    try {
      await getStudentProfile();
      await _saveRole('student');
      return 'student';
    } catch (_) {}

    try {
      await vendorProductsMine();
      await _saveRole('vendor');
      return 'vendor';
    } catch (_) {}

    return role;
  }

  Future<bool> hasValidSession() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────────

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = ApiEndpoints.baseUrl;
    final full = path.startsWith('http')
        ? path
        : (path.startsWith('/') ? '$base$path' : '$base/$path');
    final uri = Uri.parse(full);
    if (query == null || query.isEmpty) return uri;
    return uri.replace(queryParameters: query);
  }

  String resolveMediaUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    var value = url.trim();
    if (value.startsWith('//')) value = 'https:$value';
    if (value.startsWith('http://')) {
      value = 'https://${value.substring(7)}';
    }
    if (value.startsWith('http')) return value;
    return _uri(value.startsWith('/') ? value : '/$value').toString();
  }

  Map<String, String> _jsonHeaders() => {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  Future<Map<String, String>> _authHeaders() async {
    final token = await getToken();
    return {
      ..._jsonHeaders(),
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  Future<String> _offlineCacheKey(Uri uri) async {
    final user = await getUserId() ?? 'anonymous';
    final encoded = base64Url.encode(utf8.encode(uri.toString()));
    return 'offline_get_${user}_$encoded';
  }

  Future<http.Response?> _cachedResponse(Uri uri) async {
    if (!_isOfflineCacheable(uri)) return null;
    final prefs = await AppPrefs.instance();
    final body = prefs.getString(await _offlineCacheKey(uri));
    if (body == null) return null;
    return http.Response(
      body,
      200,
      headers: const {
        'content-type': 'application/json',
        'x-scholaxia-offline-cache': 'true',
      },
    );
  }

  bool _isOfflineCacheable(Uri uri) {
    final path = uri.path.toLowerCase();
    return !path.contains('/download') &&
        !path.contains('/read') &&
        !path.contains('/join') &&
        !path.contains('/stream') &&
        !path.contains('/access') &&
        !path.contains('/token') &&
        !path.contains('/live-class/plans') &&
        !path.contains('/paystack/verify');
  }

  Future<http.Response> _cachedGet(
    Uri uri, {
    Map<String, String>? headers,
    bool trackConnectivity = true,
  }) async {
    try {
      final response = await http
          .get(uri, headers: headers)
          .timeout(const Duration(seconds: 30));
      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (trackConnectivity) OfflineStatusService.instance.markOnline();
        final trimmed = response.body.trimLeft();
        if (_isOfflineCacheable(uri) &&
            response.bodyBytes.length <= 48 * 1024 &&
            (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
            !response.body.contains('\u0000')) {
          final prefs = await AppPrefs.instance();
          await prefs.setString(await _offlineCacheKey(uri), response.body);
        }
        return response;
      }
      // Non-2xx: serve the offline cache on server trouble, else map to a
      // typed error the UI can display properly.
      if (response.statusCode >= 500) {
        final cached = await _cachedResponse(uri);
        if (cached != null) {
          if (trackConnectivity) OfflineStatusService.instance.markOffline();
          return cached;
        }
        throw ApiException(response.statusCode, 'Server error: ${response.statusCode}');
      }
      if (response.statusCode == 401) {
        sessionExpiredNotifier.value = 'Session expired. Please log in again.';
        throw ApiException(response.statusCode, 'Session expired');
      }
      if (response.statusCode == 403) {
        throw ApiException(response.statusCode, 'Access denied');
      }
      if (response.statusCode == 404) {
        throw ApiException(response.statusCode, 'Resource not found');
      }
      throw ApiException(response.statusCode, 'Request failed: ${response.statusCode}');
    } on TimeoutException catch (e) {
      if (trackConnectivity) OfflineStatusService.instance.markOffline();
      throw ApiException.timeout('Request timed out', originalError: e.toString());
    } on SocketException catch (e) {
      if (trackConnectivity) OfflineStatusService.instance.markOffline();
      throw ApiException.network('Network error: ${e.message}', originalError: e.toString());
    } on HttpException catch (e) {
      throw ApiException.message('HTTP error: ${e.message}', originalError: e.toString());
    } catch (e) {
      if (e is ApiException) rethrow;
      if (trackConnectivity) OfflineStatusService.instance.markOffline();
      final cached = await _cachedResponse(uri);
      if (cached != null) return cached;
      throw const ApiException.message(
        'Internet is required for this information. Connect and try again.',
      );
    }
  }

  Future<http.Response> _onlinePost(
    Uri uri, {
    Map<String, String>? headers,
    Object? body,
  }) async {
    try {
      final response = await http
          .post(uri, headers: headers, body: body)
          .timeout(const Duration(seconds: 30));
      OfflineStatusService.instance.markOnline();
      return response;
    } catch (_) {
      OfflineStatusService.instance.markOffline();
      throw const ApiException.message(
        'This action requires internet data. Connect and try again.',
      );
    }
  }

  Future<http.Response> _onlineGet(
    Uri uri, {
    Map<String, String>? headers,
  }) async {
    try {
      final response = await http
          .get(uri, headers: headers)
          .timeout(const Duration(seconds: 30));
      OfflineStatusService.instance.markOnline();
      return response;
    } catch (_) {
      OfflineStatusService.instance.markOffline();
      throw const ApiException.message(
        'This action requires internet data. Connect and try again.',
      );
    }
  }

  Future<http.Response> _onlinePatch(
    Uri uri, {
    Map<String, String>? headers,
    Object? body,
  }) async {
    try {
      final response = await http
          .patch(uri, headers: headers, body: body)
          .timeout(const Duration(seconds: 30));
      OfflineStatusService.instance.markOnline();
      return response;
    } catch (_) {
      OfflineStatusService.instance.markOffline();
      throw const ApiException.message(
        'This action requires internet data. Connect and try again.',
      );
    }
  }

  Future<http.Response> _onlineDelete(
    Uri uri, {
    Map<String, String>? headers,
    Object? body,
  }) async {
    try {
      final response = await http
          .delete(uri, headers: headers, body: body)
          .timeout(const Duration(seconds: 30));
      OfflineStatusService.instance.markOnline();
      return response;
    } catch (_) {
      OfflineStatusService.instance.markOffline();
      throw const ApiException.message(
        'This action requires internet data. Connect and try again.',
      );
    }
  }

  dynamic _parse(http.Response res) {
    final status = res.statusCode;
    dynamic body;
    try {
      body = res.body.isEmpty ? null : jsonDecode(res.body);
    } catch (_) {
      body = res.body;
    }

    if (status >= 200 && status < 300) {
      return body;
    }

    String message = 'Request failed ($status)';
    if (body is Map) {
      final detail = body['detail'];
      if (detail is String) {
        message = detail;
      } else if (detail is Map) {
        message =
            (detail['message'] ?? detail['msg'] ?? detail['detail'] ?? detail)
                .toString();
      } else if (detail is List && detail.isNotEmpty) {
        final first = detail.first;
        message = first is Map
            ? (first['msg'] ?? first['message'] ?? first).toString()
            : first.toString();
      } else if (body['message'] is String) {
        message = body['message'] as String;
      }
    } else if (body is String && body.isNotEmpty) {
      message = body;
    }

    if (status == 401) {
      unawaited(clearTokens());
      sessionExpiredNotifier.value = message;
    }

    throw ApiException(status, message);
  }

  List<dynamic> _parseList(http.Response res) {
    final data = _parse(res);
    if (data is List) return data;
    return [];
  }

  Map<String, dynamic> _parseMap(http.Response res) {
    final data = _parse(res);
    if (data is Map) return Map<String, dynamic>.from(data);
    return {};
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  Future<AuthResponse> login({
    String? email,
    String? phone,
    required String password,
  }) async {
    final body = <String, dynamic>{'password': password};
    if (email != null && email.trim().isNotEmpty) {
      body['email'] = email.trim();
    } else if (phone != null && phone.trim().isNotEmpty) {
      body['phone'] = phone.trim();
    }
    final res = await _onlinePost(
      _uri(ApiEndpoints.login),
      headers: _jsonHeaders(),
      body: jsonEncode(body),
    );
    final auth = AuthResponse.fromJson(
      Map<String, dynamic>.from(_parse(res) as Map),
    );
    await _saveAuth(auth);
    return auth;
  }

  Future<Map<String, dynamic>> signupStart({
    required String email,
    required String password,
    required String fullName,
    String role = 'student',
    String ageGroup = '6-8',
    String? gradeLevel,
    String? parentEmail,
    String? phone,
    String? location,
    String? address,
    List<String>? subjects,
    String? businessName,
    List<String>? categories,
    String? language,
    String? currency,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.signupStart),
      headers: _jsonHeaders(),
      body: jsonEncode({
        'email': email,
        'password': password,
        'full_name': fullName,
        'role': role,
        'age_group': ageGroup,
        if (gradeLevel != null && gradeLevel.isNotEmpty)
          'grade_level': gradeLevel,
        if (parentEmail != null && parentEmail.isNotEmpty)
          'parent_email': parentEmail,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
        if (location != null && location.isNotEmpty) 'location': location,
        if (address != null && address.isNotEmpty) 'address': address,
        if (subjects != null && subjects.isNotEmpty) 'subjects': subjects,
        if (businessName != null && businessName.isNotEmpty)
          'business_name': businessName,
        if (categories != null && categories.isNotEmpty) 'categories': categories,
        if (language != null && language.isNotEmpty) 'language': language,
        if (currency != null && currency.isNotEmpty) 'currency': currency,
      }),
    );
    return _parseMap(res);
  }

  Future<AuthResponse> signupVerify({
    required String email,
    required String otp,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.signupVerify),
      headers: _jsonHeaders(),
      body: jsonEncode({'email': email, 'otp': otp}),
    );
    final auth = AuthResponse.fromJson(
      Map<String, dynamic>.from(_parse(res) as Map),
    );
    await _saveAuth(auth);
    return auth;
  }

  Future<Map<String, dynamic>> sendEmailOtp({
    required String email,
    String purpose = 'signup',
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.otpSend),
      headers: _jsonHeaders(),
      body: jsonEncode({'email': email, 'purpose': purpose}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> resetPassword({
    required String email,
    required String otp,
    required String newPassword,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.passwordReset),
      headers: _jsonHeaders(),
      body: jsonEncode({
        'email': email,
        'otp': otp,
        'new_password': newPassword,
      }),
    );
    return _parseMap(res);
  }

  Future<AuthResponse> firebasePhoneAuth({
    required String idToken,
    required String mode, // login | signup
    String? fullName,
    String? password,
    String role = 'student',
    String ageGroup = '6-8',
    String? gradeLevel,
    String? parentEmail,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.firebaseAuth),
      headers: _jsonHeaders(),
      body: jsonEncode({
        'id_token': idToken,
        'mode': mode,
        'role': role,
        'age_group': ageGroup,
        if (fullName != null && fullName.isNotEmpty) 'full_name': fullName,
        if (password != null && password.isNotEmpty) 'password': password,
        if (gradeLevel != null && gradeLevel.isNotEmpty)
          'grade_level': gradeLevel,
        if (parentEmail != null && parentEmail.isNotEmpty)
          'parent_email': parentEmail,
      }),
    );
    final auth = AuthResponse.fromJson(
      Map<String, dynamic>.from(_parse(res) as Map),
    );
    await _saveAuth(auth);
    return auth;
  }

  Future<AuthResponse> studentSignup({
    required String email,
    required String password,
    required String fullName,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentSignup),
      headers: _jsonHeaders(),
      body: jsonEncode({
        'email': email,
        'password': password,
        'full_name': fullName,
      }),
    );
    final auth = AuthResponse.fromJson(
      Map<String, dynamic>.from(_parse(res) as Map),
    );
    await _saveAuth(auth);
    return auth;
  }

  Future<AuthResponse> kindSignup({
    required String email,
    required String password,
    required String fullName,
    String ageGroup = '6-8',
    String? gradeLevel,
    String? parentEmail,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.kindSignup),
      headers: _jsonHeaders(),
      body: jsonEncode({
        'email': email,
        'password': password,
        'full_name': fullName,
        'age_group': ageGroup,
        if (gradeLevel != null && gradeLevel.isNotEmpty)
          'grade_level': gradeLevel,
        if (parentEmail != null && parentEmail.isNotEmpty)
          'parent_email': parentEmail,
      }),
    );
    final auth = AuthResponse.fromJson(
      Map<String, dynamic>.from(_parse(res) as Map),
    );
    await _saveAuth(auth);
    return auth;
  }

  // ── Kind (young learners) ──────────────────────────────────────────────────

  Future<Map<String, dynamic>> getKindMe() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.kindMe),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<String>> kindSubjects() async {
    final res = await _cachedGet(_uri(ApiEndpoints.kindSubjects));
    final data = _parseMap(res);
    final raw = data['subjects'];
    if (raw is List) return raw.map((e) => e.toString()).toList();
    return ['General', 'Math', 'English', 'Science'];
  }

  /// Admin-authored questions for a kids game (merged with built-in banks).
  Future<List<Map<String, dynamic>>> kindGameQuestions(String gameId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.kindGameQuestions(gameId)),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    final raw = data['questions'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  Future<KindSiaResponse> kindSiaChat({
    required String question,
    String subject = 'General',
    List<Map<String, dynamic>>? conversationHistory,
  }) async {
    final res = await http
        .post(
          _uri(ApiEndpoints.kindSiaChat),
          headers: await _authHeaders(),
          body: jsonEncode({
            'question': question,
            'subject': subject,
            if (conversationHistory != null)
              'conversation_history': conversationHistory,
          }),
        )
        .timeout(const Duration(seconds: 120));
    final data = _parseMap(res);
    return KindSiaResponse(
      text: data['sia_kind']?.toString() ?? 'No reply.',
      board: SiaBoardItem.listFromJson(data['board']),
    );
  }

  Future<String> kindSiaLearn({
    required String topic,
    String subject = 'General',
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.kindSiaLearn),
      headers: await _authHeaders(),
      body: jsonEncode({'topic': topic, 'subject': subject}),
    );
    return _parseMap(res)['sia_kind']?.toString() ?? 'No lesson.';
  }

  /// Interactive kids quiz. Prefers structured `questions`; falls back to text.
  Future<KindQuizResult> kindSiaQuiz({
    required String topic,
    String subject = 'General',
    int numQuestions = 5,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.kindSiaQuiz),
      headers: await _authHeaders(),
      body: jsonEncode({
        'topic': topic,
        'subject': subject,
        'num_questions': numQuestions,
      }),
    );
    final data = _parseMap(res);
    final rawQs = data['questions'];
    final questions = <KindQuizQuestion>[];
    if (rawQs is List) {
      for (final q in rawQs) {
        if (q is! Map) continue;
        final m = Map<String, dynamic>.from(q);
        final optsRaw = m['options'];
        final options = <String, String>{};
        if (optsRaw is Map) {
          for (final e in optsRaw.entries) {
            options[e.key.toString().toUpperCase()] = e.value.toString();
          }
        }
        if (options.isEmpty) continue;
        questions.add(
          KindQuizQuestion(
            id: m['id']?.toString() ?? '${questions.length + 1}',
            question: m['question']?.toString() ?? '',
            options: options,
            correct: (m['correct']?.toString() ?? '').toUpperCase(),
          ),
        );
      }
    }
    // Client-side parse if server only returned plain text.
    if (questions.isEmpty) {
      questions.addAll(
        KindQuizQuestion.parseFromText(data['sia_kind']?.toString() ?? ''),
      );
    }
    return KindQuizResult(
      intro:
          data['intro']?.toString() ??
          data['sia_kind']?.toString() ??
          'Tap an answer for each question!',
      rawText: data['sia_kind']?.toString() ?? '',
      questions: questions,
    );
  }

  // ── Students ───────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> setupExam({
    String? examType,
    List<String>? subjects,
    required String educationLevel,
    bool? enableJamb,
    bool? enableSsce,
    List<String>? jambSubjects,
    String? ssceExamType,
    List<String>? ssceSubjects,
  }) async {
    final body = <String, dynamic>{'education_level': educationLevel};
    if (examType != null) body['exam_type'] = examType;
    if (subjects != null) body['subjects'] = subjects;
    if (enableJamb != null) body['enable_jamb'] = enableJamb;
    if (enableSsce != null) body['enable_ssce'] = enableSsce;
    if (jambSubjects != null) body['jamb_subjects'] = jambSubjects;
    if (ssceExamType != null) body['ssce_exam_type'] = ssceExamType;
    if (ssceSubjects != null) body['ssce_subjects'] = ssceSubjects;
    final res = await _onlinePost(
      _uri(ApiEndpoints.setupExam),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    final data = _parseMap(res);
    final prefs = await AppPrefs.instance();
    await prefs.setBool(_kSetupComplete, true);
    // Primary 6 → kids: server returns new tokens + role.
    final access = data['access_token']?.toString();
    final refresh = data['refresh_token']?.toString();
    final role = data['role']?.toString();
    if (access != null && access.isNotEmpty) {
      await prefs.setString(_kAccessToken, access);
      if (refresh != null && refresh.isNotEmpty) {
        await prefs.setString(_kRefreshToken, refresh);
      }
      if (role != null && role.isNotEmpty) {
        await prefs.setString(_kUserRole, role.toLowerCase().trim());
      }
    }
    return data;
  }

  Future<Map<String, dynamic>> setupStatus() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.setupStatus),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<String>> listAvailableSubjects() async {
    final res = await _cachedGet(_uri(ApiEndpoints.studentSubjects));
    final data = _parseMap(res);
    final raw = data['subjects'];
    if (raw is List) {
      return raw.map((e) => e.toString()).toList();
    }
    return [];
  }

  Future<bool> isSetupComplete() async {
    final prefs = await AppPrefs.instance();
    final cached = prefs.getBool(_kSetupComplete);

    try {
      final data = await setupStatus();
      final complete = data['setup_complete'] == true;
      await prefs.setBool(_kSetupComplete, complete);
      return complete;
    } on ApiException catch (e) {
      // Teachers hit /students/setup-status with 403 — not incomplete setup.
      if (e.statusCode == 403) return true;
      return cached ?? false;
    } catch (_) {
      return cached ?? false;
    }
  }

  /// Triggers GET /students/me so the server auto-creates a profile if missing.
  Future<void> ensureStudentProfile() async {
    try {
      final res = await _cachedGet(
        _uri(_studentMe),
        headers: await _authHeaders(),
      );
      _parse(res);
    } catch (_) {}
  }

  Future<StudentProfile> getStudentProfile() async {
    final res = await _cachedGet(_uri(_studentMe), headers: await _authHeaders());
    final profile = StudentProfile.fromJson(_parseMap(res));
    final fromApi = resolveMediaUrl(profile.profilePicture);
    if (fromApi.isNotEmpty) {
      await cacheProfilePicture(fromApi);
      return profile.copyWith(profilePicture: fromApi);
    }
    // Network/profile missing picture — keep last uploaded URL so restart still shows it.
    final cached = await cachedProfilePicture();
    if (cached != null && cached.isNotEmpty) {
      return profile.copyWith(profilePicture: cached);
    }
    return profile;
  }

  /// Upload an image then save it as the current user's profile picture.
  Future<String> updateProfilePicture(List<int> bytes, String filename) async {
    final uploaded = await communityUpload(bytes, filename);
    var url =
        uploaded['file_url']?.toString() ??
        uploaded['secure_url']?.toString() ??
        uploaded['url']?.toString() ??
        '';
    url = resolveMediaUrl(url);
    if (url.isEmpty) {
      throw ApiException.message('Upload succeeded but no image URL returned.');
    }
    final res = await _onlinePatch(
      _uri(ApiEndpoints.profilePicture),
      headers: await _authHeaders(),
      body: jsonEncode({'profile_picture': url}),
    );
    final data = _parseMap(res);
    final saved = resolveMediaUrl(data['profile_picture']?.toString() ?? url);
    await cacheProfilePicture(saved);
    profilePictureNotifier.value = saved;
    // Keep a local copy so the avatar still shows if the CDN is slow/offline.
    try {
      await ProfileAvatarCache.instance.saveBytes(bytes);
    } catch (_) {}
    return saved.isNotEmpty ? saved : url;
  }

  /// Updates the student's full name and returns the saved value.
  /// Endpoint: PATCH /api/v1/students/me  { "full_name": "..." }
  Future<String> updateStudentName(String fullName) async {
    final trimmed = fullName.trim();
    if (trimmed.isEmpty) {
      throw const ApiException.message('Name cannot be empty.');
    }
    final res = await _onlinePatch(
      _uri(_studentMe),
      headers: await _authHeaders(),
      body: jsonEncode({'full_name': trimmed}),
    );
    final data = _parseMap(res);
    // Server may echo `full_name` directly, or nest it under `profile`.
    final saved = (data['full_name'] ??
            (data['profile'] is Map ? data['profile']['full_name'] : null) ??
            trimmed)
        .toString();
    return saved.isEmpty ? trimmed : saved;
  }

  Future<StudentProfile> getStudentProfileById(String userId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentProfile(userId)),
      headers: await _authHeaders(),
    );
    return StudentProfile.fromJson(_parseMap(res));
  }

  Future<Map<String, dynamic>> walletMe() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.walletMe),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  // ── Scholaxia Intellect League ──────────────────────────────────────────────

  Future<Map<String, dynamic>> silMeta() async {
    final res = await _cachedGet(_uri(ApiEndpoints.silMeta));
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silStatus() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.silStatus),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silRegister(Map<String, dynamic> body) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silRegister),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silFaceVerify({
    required String faceSelfieB64,
    String? matchId,
    bool livenessOk = true,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silFaceVerify),
      headers: await _authHeaders(),
      body: jsonEncode({
        'face_selfie_b64': faceSelfieB64,
        if (matchId != null) 'match_id': matchId,
        'liveness_ok': livenessOk,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silWallet() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.silWallet),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silWalletBuy(String package) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silWalletBuy),
      headers: await _authHeaders(),
      body: jsonEncode({'package': package}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silDashboard() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.silDashboard),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silStartPractice({
    String subject = 'General Knowledge',
    int questionCount = 10,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silPractice),
      headers: await _authHeaders(),
      body: jsonEncode({'subject': subject, 'question_count': questionCount}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silStartAi(int level) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silAi),
      headers: await _authHeaders(),
      body: jsonEncode({'level': level}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silStartStudentChallenge({
    String? opponentGamerTag,
    int betCoins = 100,
    String subject = 'General Knowledge',
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silStudentChallenge),
      headers: await _authHeaders(),
      body: jsonEncode({
        if (opponentGamerTag != null) 'opponent_gamer_tag': opponentGamerTag,
        'bet_coins': betCoins,
        'subject': subject,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silStartClassChallenge() async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silClassChallenge),
      headers: await _authHeaders(),
      body: '{}',
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silStartSchoolChallenge({
    String opponentSchool = 'Rival Academy',
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silSchoolChallenge, {
        'opponent_school': opponentSchool,
      }),
      headers: await _authHeaders(),
      body: '{}',
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silStartFriday() async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silFriday),
      headers: await _authHeaders(),
      body: '{}',
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silFinishMatch(
    String matchId,
    List<Map<String, dynamic>> answers,
  ) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silMatchFinish(matchId)),
      headers: await _authHeaders(),
      body: jsonEncode({'answers': answers}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silAnticheat(
    String matchId,
    String eventType, {
    String? detail,
    Map<String, dynamic>? meta,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silMatchAnticheat(matchId)),
      headers: await _authHeaders(),
      body: jsonEncode({
        'event_type': eventType,
        if (detail != null) 'detail': detail,
        if (meta != null) 'meta': meta,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silHeartbeat(
    String matchId, {
    required bool faceInFrame,
    required int faceCount,
    double? luminance,
    String? detail,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silMatchHeartbeat(matchId)),
      headers: await _authHeaders(),
      body: jsonEncode({
        'face_in_frame': faceInFrame,
        'face_count': faceCount,
        if (luminance != null) 'luminance': luminance,
        if (detail != null) 'detail': detail,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silDeviceReport({
    required bool isEmulator,
    required bool isRooted,
    required bool isJailbroken,
    String? platform,
    String? model,
    String? matchId,
    Map<String, dynamic>? raw,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.silDeviceReport),
      headers: await _authHeaders(),
      body: jsonEncode({
        'is_emulator': isEmulator,
        'is_rooted': isRooted,
        'is_jailbroken': isJailbroken,
        if (platform != null) 'platform': platform,
        if (model != null) 'model': model,
        if (matchId != null) 'match_id': matchId,
        if (raw != null) 'raw': raw,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> silLeaderboard({
    String scope = 'national',
    String? state,
    String? school,
  }) async {
    final query = <String, String>{'scope': scope};
    if (state != null) query['state'] = state;
    if (school != null) query['school'] = school;
    final res = await _cachedGet(
      _uri(ApiEndpoints.silLeaderboard, query),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> silHistory() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.silHistory),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  // ── Library ────────────────────────────────────────────────────────────────

  Future<List<dynamic>> libraryStudentBooks({
    String? subject,
    String? examType,
    String? searchQuery,
    String? category,
  }) async {
    final query = <String, String>{};
    if (subject != null && subject.isNotEmpty) query['subject'] = subject;
    if (examType != null && examType.isNotEmpty) query['exam_type'] = examType;
    if (searchQuery != null && searchQuery.isNotEmpty) {
      query['q'] = searchQuery;
    }
    if (category != null && category.isNotEmpty && category != 'All') {
      query['category'] = category;
    }
    final res = await _cachedGet(
      _uri(ApiEndpoints.libraryStudent, query.isEmpty ? null : query),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> libraryReadBook(String bookId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.libraryRead(bookId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  /// Download library PDF bytes through Scholaxia (Bearer auth).
  /// Do not open Cloudinary URLs in the PDF viewer — Android gets HTTP 401.
  Future<Uint8List> libraryDownloadBook(
    String bookId, {
    bool asAttachment = false,
  }) async {
    final token = await getToken();
    if (token == null || token.isEmpty) {
      throw const ApiException.message('Please sign in again to read this PDF.');
    }
    late http.Response res;
    try {
      res = await http
          .get(
            _uri(ApiEndpoints.libraryFile(bookId, download: asAttachment)),
            headers: {
              'Authorization': 'Bearer $token',
              'Accept': 'application/pdf,application/octet-stream,*/*',
            },
          )
          .timeout(const Duration(seconds: 120));
      OfflineStatusService.instance.markOnline();
    } catch (_) {
      OfflineStatusService.instance.markOffline();
      throw const ApiException.message(
        'Could not download this PDF. Check your internet and try again.',
      );
    }
    if (res.statusCode >= 200 &&
        res.statusCode < 300 &&
        res.bodyBytes.isNotEmpty) {
      final bytes = res.bodyBytes;
      if (bytes.length >= 5 &&
          String.fromCharCodes(bytes.take(5)) == '%PDF-') {
        return bytes;
      }
      // Some gateways prepend junk; still accept if %PDF- appears early.
      final start = bytes.indexOf(0x25); // '%'
      if (start >= 0 &&
          start < 2048 &&
          start + 5 <= bytes.length &&
          String.fromCharCodes(bytes.sublist(start, start + 5)) == '%PDF-') {
        return Uint8List.fromList(bytes.sublist(start));
      }
      throw const ApiException.message('Server did not return a valid PDF.');
    }
    _parse(res); // throws ApiException with detail (e.g. missing on storage)
    throw const ApiException.message('Could not download this PDF.');
  }

  Future<void> libraryUpdateProgress(String bookId, int page) async {
    final res = await _onlinePost(
      _uri('/api/v1/library/$bookId/progress'),
      headers: await _authHeaders(),
      body: jsonEncode({'current_page': page}),
    );
    _parse(res);
  }

  Future<Map<String, dynamic>> initializePaystack({
    required String productType,
    required String productId,
    Map<String, dynamic>? extra,
  }) async {
    final body = <String, dynamic>{
      'product_type': productType,
      'product_id': productId,
      if (extra != null) ...extra,
    };
    final res = await _onlinePost(
      _uri('/api/v1/payments/paystack/initialize'),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> verifyPaystack(String reference) async {
    final res = await _onlinePost(
      _uri('/api/v1/payments/paystack/verify'),
      headers: await _authHeaders(),
      body: jsonEncode({'reference': reference}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> redeemCbtCoupon(String code) async {
    final res = await _onlinePost(
      _uri('/api/v1/cbt/coupons/redeem'),
      headers: await _authHeaders(),
      body: jsonEncode({'code': code}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> cbtCouponAccess() async {
    final res = await _cachedGet(
      _uri('/api/v1/cbt/coupons/access'),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> videoTutorials() async {
    final res = await _cachedGet(
      _uri('/api/v1/videos'),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    return (data['videos'] as List?) ?? const [];
  }

  Future<List<dynamic>> kindVideoTutorials() async {
    final res = await _cachedGet(
      _uri('/api/v1/videos/kind'),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    return (data['videos'] as List?) ?? const [];
  }

  Future<Map<String, dynamic>> cbtPackageAccess() async {
    final res = await _cachedGet(
      _uri('/api/v1/payments/paystack/cbt-access'),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> cbtPackageCatalog() async {
    final res = await _cachedGet(
      _uri('/api/v1/payments/paystack/cbt-packages'),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    return (data['packages'] as List?) ?? const [];
  }

  // ── Marketplace ────────────────────────────────────────────────────────────

  Future<List<dynamic>> marketplaceCategories() async {
    final res = await _cachedGet(_uri(ApiEndpoints.marketplaceCategories));
    final data = _parseMap(res);
    final raw = data['categories'];
    return raw is List ? raw : const [];
  }

  Future<List<dynamic>> marketplaceProducts({String? category}) async {
    final query = <String, String>{};
    if (category != null && category.isNotEmpty && category != 'all') {
      query['category'] = category;
    }
    final res = await _cachedGet(
      _uri(ApiEndpoints.marketplaceProducts, query.isEmpty ? null : query),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> marketplaceProduct(String productId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.marketplaceProduct(productId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> bookMarketplaceProduct({
    required String productId,
    required String fullName,
    required String whatsapp,
    required String phone,
    required String email,
    String? note,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.marketplaceBookProduct(productId)),
      headers: await _authHeaders(),
      body: jsonEncode({
        'full_name': fullName,
        'whatsapp': whatsapp,
        'phone': phone,
        'email': email,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> addToMarketplaceCart({
    required String productId,
    int quantity = 1,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.marketplaceCartAdd),
      headers: await _authHeaders(),
      body: jsonEncode({'product_id': productId, 'quantity': quantity}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> marketplaceCart() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.marketplaceCart),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<void> removeMarketplaceCartItem(String cartItemId) async {
    final res = await _onlineDelete(
      _uri(ApiEndpoints.marketplaceCartItem(cartItemId)),
      headers: await _authHeaders(),
    );
    _parse(res);
  }

  Future<Map<String, dynamic>> checkoutMarketplaceCart({
    required String deliveryAddress,
    required String contactPhone,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.marketplaceCheckout),
      headers: await _authHeaders(),
      body: jsonEncode({
        'delivery_address': deliveryAddress,
        'contact_phone': contactPhone,
      }),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> marketplaceOrdersMine() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.marketplaceOrdersMine),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> vendorUploadProductImage(
    List<int> bytes,
    String filename,
  ) async {
    final token = await getToken();
    final request = http.MultipartRequest(
      'POST',
      _uri(ApiEndpoints.vendorMarketplaceUploadImage),
    );
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.files.add(
      http.MultipartFile.fromBytes(
        'file',
        bytes,
        filename: filename,
        contentType: _communityUploadMime(filename),
      ),
    );
    try {
      final streamed =
          await request.send().timeout(const Duration(seconds: 60));
      OfflineStatusService.instance.markOnline();
      final res = await http.Response.fromStream(streamed);
      return _parseMap(res);
    } catch (e) {
      if (e is ApiException) rethrow;
      OfflineStatusService.instance.markOffline();
      throw const ApiException.message(
        'Uploading requires internet data. Connect and try again.',
      );
    }
  }

  Future<Map<String, dynamic>> vendorCreateProduct({
    required String title,
    required String category,
    required double price,
    required String imageUrl,
    String? description,
    int stockQty = 0,
    bool isAvailable = true,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.vendorMarketplaceProducts),
      headers: await _authHeaders(),
      body: jsonEncode({
        'title': title,
        'category': category,
        'price': price,
        'image_url': imageUrl,
        'description': description,
        'stock_qty': stockQty,
        'is_available': isAvailable,
      }),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> vendorProductsMine() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.vendorMarketplaceProducts),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> vendorUpdateProduct({
    required String productId,
    String? title,
    String? description,
    String? category,
    double? price,
    String? imageUrl,
    int? stockQty,
    bool? isAvailable,
    bool? isActive,
  }) async {
    final body = <String, dynamic>{};
    if (title != null) body['title'] = title;
    if (description != null) body['description'] = description;
    if (category != null) body['category'] = category;
    if (price != null) body['price'] = price;
    if (imageUrl != null) body['image_url'] = imageUrl;
    if (stockQty != null) body['stock_qty'] = stockQty;
    if (isAvailable != null) body['is_available'] = isAvailable;
    if (isActive != null) body['is_active'] = isActive;
    final res = await _onlinePatch(
      _uri(ApiEndpoints.vendorMarketplaceProduct(productId)),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> vendorDeleteProduct(String productId) async {
    final res = await _onlineDelete(
      _uri(ApiEndpoints.vendorMarketplaceProduct(productId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> vendorOrders() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.vendorMarketplaceOrders),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<List<dynamic>> vendorBookings() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.vendorMarketplaceBookings),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> vendorUpdateBookingStatus({
    required String bookingId,
    required String status,
  }) async {
    final res = await _onlinePatch(
      _uri(
        ApiEndpoints.vendorMarketplaceBookingStatus(bookingId),
        {'status': status},
      ),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> vendorGetKyc() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.vendorMarketplaceKyc),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> vendorAccountStatus() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.vendorMarketplaceStatus),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> vendorSubmitKyc({
    required String fullName,
    required String location,
    required String address,
    required String nin,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.vendorMarketplaceKyc),
      headers: await _authHeaders(),
      body: jsonEncode({
        'full_name': fullName,
        'location': location,
        'address': address,
        'nin': nin,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> vendorUpdateOrderTracking({
    required String orderItemId,
    required String trackingStatus,
    String? trackingNote,
  }) async {
    final query = <String, String>{'tracking_status': trackingStatus};
    if (trackingNote != null && trackingNote.trim().isNotEmpty) {
      query['tracking_note'] = trackingNote.trim();
    }
    final res = await _onlinePatch(
      _uri(ApiEndpoints.vendorMarketplaceOrderTracking(orderItemId), query),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<void> vendorDeleteOrderItem(String orderItemId) async {
    final res = await _onlineDelete(
      _uri(ApiEndpoints.vendorMarketplaceOrderItem(orderItemId)),
      headers: await _authHeaders(),
    );
    _parse(res);
  }

  // ── Teacher ────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getTeacherMe() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.teacherMe),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> updateTeacherProfile({
    String? bio,
    List<String>? subjects,
  }) async {
    final body = <String, dynamic>{};
    if (bio != null) body['bio'] = bio;
    if (subjects != null) body['subjects'] = subjects;

    final res = await _onlinePatch(
      _uri(ApiEndpoints.teacherMe),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    return _parseMap(res);
  }

  // ── Sia ──────────────────────────────────────────────────────────────────────

  Future<SiaResponse> siaAsk({
    required String question,
    required String subject,
    String language = 'english',
    String? educationLevel,
    List<Map<String, dynamic>>? conversationHistory,
    String tutorMode = 'smart',
  }) async {
    final res = await http
        .post(
          _uri(ApiEndpoints.siaAsk),
          headers: await _authHeaders(),
          body: jsonEncode({
            'question': question,
            'subject': subject,
            'language': language,
            if (educationLevel != null) 'education_level': educationLevel,
            if (conversationHistory != null)
              'conversation_history': conversationHistory,
            'tutor_mode': tutorMode,
          }),
        )
        .timeout(const Duration(seconds: 120));
    return SiaResponse.fromJson(_parseMap(res));
  }

  // ── CBT practice attempts (JAMB / WAEC / NECO board engine) ───────────────

  /// Board-first home: exam types with access flags, profile subjects, settings.
  Future<Map<String, dynamic>> cbtPracticeHome() async {
    final res = await http
        .get(
          _uri('/api/v1/cbt/practice/home'),
          headers: await _authHeaders(),
        )
        .timeout(const Duration(seconds: 30));
    return _parseMap(res);
  }

  /// Voice Teaching Mode: one round of structured teaching steps
  /// (voice + board lines + wait-checkpoints) animated on a teaching board.
  Future<Map<String, dynamic>> siaTeachStep({
    required String question,
    String subject = 'General',
    String? educationLevel,
    String language = 'english',
    String? studentReply,
    List<Map<String, dynamic>> lessonHistory = const [],
  }) async {
    final res = await http
        .post(
          _uri('/api/v1/sia/teach-step'),
          headers: await _authHeaders(),
          body: jsonEncode({
            'question': question,
            'subject': subject,
            if (educationLevel != null) 'education_level': educationLevel,
            'language': language,
            if (studentReply != null) 'student_reply': studentReply,
            'lesson_history': lessonHistory,
          }),
        )
        .timeout(const Duration(seconds: 90));
    return _parseMap(res);
  }

  /// Register (and lock) subjects for a board WITHOUT starting an exam.
  /// WAEC/NECO: pick up to 9 subjects → CONTINUE. Throws ApiException 409
  /// when subjects are already locked (then use requestSubjectChange).
  Future<Map<String, dynamic>> cbtRegisterSubjects(
    String examType,
    List<String> subjects,
  ) async {
    final res = await http
        .post(
          _uri('/api/v1/cbt/practice/register-subjects'),
          headers: await _authHeaders(),
          body: jsonEncode({'exam_type': examType, 'subjects': subjects}),
        )
        .timeout(const Duration(seconds: 30));
    return _parseMap(res);
  }

  /// Start a practice attempt for a board (JAMB/WAEC/NECO/COMMON_ENTRANCE).
  /// Throws ApiException with status 402 when the board package is locked.
  Future<Map<String, dynamic>> cbtPracticeStart(
    String examType,
    List<String> subjects,
  ) async {
    final res = await http
        .post(
          _uri('/api/v1/cbt/practice/start'),
          headers: await _authHeaders(),
          body: jsonEncode({'exam_type': examType, 'subjects': subjects}),
        )
        .timeout(const Duration(seconds: 90));
    return _parseMap(res);
  }

  /// Load one subject section (builds questions server-side on first open).
  Future<Map<String, dynamic>> cbtPracticeSection(
    String attemptId,
    int sectionIndex,
  ) async {
    final res = await http
        .get(
          _uri('/api/v1/cbt/practice/attempts/$attemptId/sections/$sectionIndex'),
          headers: await _authHeaders(),
        )
        .timeout(const Duration(seconds: 60));
    return _parseMap(res);
  }

  Future<void> cbtPracticeSaveAnswers(
    String attemptId,
    Map<String, String> answers, {
    int? sectionIndex,
  }) async {
    await http
        .post(
          _uri('/api/v1/cbt/practice/attempts/$attemptId/answers'),
          headers: await _authHeaders(),
          body: jsonEncode({
            'answers': answers,
            if (sectionIndex != null) 'section_index': sectionIndex,
          }),
        )
        .timeout(const Duration(seconds: 30));
  }

  Future<Map<String, dynamic>> cbtPracticeSubmit(
    String attemptId,
    Map<String, String> answers,
  ) async {
    final res = await http
        .post(
          _uri('/api/v1/cbt/practice/attempts/$attemptId/submit'),
          headers: await _authHeaders(),
          body: jsonEncode({'answers': answers}),
        )
        .timeout(const Duration(seconds: 60));
    return _parseMap(res);
  }

  /// Send admin a request to change locked CBT subjects.
  Future<Map<String, dynamic>> requestSubjectChange(
    String board,
    List<String> newSubjects, {
    String? reason,
  }) async {
    final res = await http
        .post(
          _uri('/api/v1/cbt/subject-change-requests'),
          headers: await _authHeaders(),
          body: jsonEncode({
            'board': board,
            'new_subjects': newSubjects,
            if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
          }),
        )
        .timeout(const Duration(seconds: 30));
    return _parseMap(res);
  }

  Future<List<dynamic>> mySubjectChangeRequests() async {
    final res = await http
        .get(
          _uri('/api/v1/cbt/subject-change-requests/mine'),
          headers: await _authHeaders(),
        )
        .timeout(const Duration(seconds: 30));
    final data = _parseMap(res);
    return (data['requests'] as List?) ?? [];
  }

  /// Fetch MP3 audio for Sia / Kind / Teacher AI voice playback.
  Future<Uint8List?> fetchVoiceAudio(
    String text, {
    String language = 'english',
  }) async {
    final role = (await getRole())?.toLowerCase();
    final endpoint = role == 'teacher'
        ? ApiEndpoints.teacherAiSpeak
        : ApiEndpoints.siaSpeak;
    try {
      final res = await http
          .post(
            _uri(endpoint),
            headers: await _authHeaders(),
            body: jsonEncode({'text': text, 'language': language}),
          )
          .timeout(const Duration(seconds: 90));
      if (res.statusCode != 200) {
        debugPrint('fetchVoiceAudio HTTP ${res.statusCode}: ${res.body}');
        return null;
      }
      if (res.bodyBytes.isEmpty) return null;
      return res.bodyBytes;
    } catch (e) {
      debugPrint('fetchVoiceAudio error: $e');
      return null;
    }
  }

  /// Upload a recorded voice clip and get the transcript (server Whisper).
  /// Works with .m4a/.wav/.mp3 clips from the `record` plugin.
  Future<String> transcribeVoiceFile(File file) async {
    final token = await getToken();
    final request = http.MultipartRequest(
      'POST',
      _uri(ApiEndpoints.siaTranscribe),
    );
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.files.add(
      await http.MultipartFile.fromPath('audio', file.path),
    );
    request.fields['language'] = 'en';
    final streamed = await request.send().timeout(const Duration(seconds: 60));
    final res = await http.Response.fromStream(streamed);
    final data = _parseMap(res);
    return (data['text'] ?? '').toString();
  }

  // ── Teacher AI ─────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> teacherAiAsk({
    required String task,
    required String subject,
    required String educationLevel,
    required String details,
    List<Map<String, dynamic>>? conversationHistory,
  }) async {
    final res = await http
        .post(
          _uri(ApiEndpoints.teacherAiAsk),
          headers: await _authHeaders(),
          body: jsonEncode({
            'task': task,
            'subject': subject,
            'education_level': educationLevel,
            'details': details,
            if (conversationHistory != null)
              'conversation_history': conversationHistory,
          }),
        )
        .timeout(const Duration(seconds: 120));
    return _parseMap(res);
  }

  // ── CBT ─────────────────────────────────────────────────────────────────────

  Future<CbtSession> cbtStartSession(String examId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.cbtStartSession(examId)),
      headers: await _authHeaders(),
    );
    return CbtSession.fromJson(_parseMap(res));
  }

  Future<CbtResult> cbtSubmit({
    required String sessionId,
    required Map<String, String> answers,
    bool isAutoSubmit = false,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.cbtSubmitSession),
      headers: await _authHeaders(),
      body: jsonEncode({
        'session_id': sessionId,
        'answers': answers,
        'is_auto_submit': isAutoSubmit,
      }),
    );
    return CbtResult.fromJson(_parseMap(res));
  }

  Future<List<dynamic>> cbtExams({String? examType, String? subject}) async {
    final query = <String, String>{};
    if (examType != null && examType.isNotEmpty) {
      query['exam_type'] = examType;
    }
    if (subject != null && subject.isNotEmpty) query['subject'] = subject;

    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtExams, query.isEmpty ? null : query),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> cbtExamsForMe({
    String paperKind = 'cbt_practice',
  }) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtExamsForMe, {'paper_kind': paperKind}),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<CbtQuestion>> cbtDownloadExam(String examId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtExamDownload(examId)),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    final raw = data['questions'];
    if (raw is! List) return [];
    return raw
        .whereType<Map>()
        .map((q) => CbtQuestion.fromJson(Map<String, dynamic>.from(q)))
        .toList();
  }

  Future<CbtResult> cbtSessionResult(String sessionId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtSessionResult(sessionId)),
      headers: await _authHeaders(),
    );
    return CbtResult.fromJson(_parseMap(res));
  }

  Future<Map<String, dynamic>> cbtSessionReview(String sessionId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtSessionReview(sessionId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  /// Answer-key review for a board practice attempt (JAMB/WAEC/NECO).
  /// Returns full_review: every question with correct key, your answer and
  /// explanation. Only works after the attempt has been submitted.
  Future<Map<String, dynamic>> cbtPracticeReview(String attemptId) async {
    final res = await http
        .get(
          _uri('/api/v1/cbt/practice/attempts/$attemptId/review'),
          headers: await _authHeaders(),
        )
        .timeout(const Duration(seconds: 60));
    return _parseMap(res);
  }

  /// Full offline pack for an exam (metadata + questions, no answers). Used to
  /// cache internal exams locally so they can be taken offline.
  Future<Map<String, dynamic>> cbtDownloadExamRaw(String examId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtExamDownload(examId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  // ── Internal exams (downloadable, offline, routed to subject teachers) ──────

  Future<List<dynamic>> internalExamsForMe() async {
    final res = await _cachedGet(
      _uri('/api/v1/cbt/internal-exams/for-me'),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    final raw = data['exams'];
    return raw is List ? raw : const [];
  }

  Future<CbtResult> submitInternalExam({
    required String examId,
    required Map<String, String> answers,
    bool isAutoSubmit = false,
  }) async {
    final res = await _onlinePost(
      _uri('/api/v1/cbt/internal-exams/$examId/submit'),
      headers: await _authHeaders(),
      body: jsonEncode({'answers': answers, 'is_auto_submit': isAutoSubmit}),
    );
    return CbtResult.fromJson(_parseMap(res));
  }

  Future<List<dynamic>> teacherInternalSubmissions() async {
    final res = await _cachedGet(
      _uri('/api/v1/cbt/internal-exams/submissions'),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    final raw = data['submissions'];
    return raw is List ? raw : const [];
  }

  Future<Map<String, dynamic>> getAppVersion() async {
    // Quiet probe — must not flip the global offline banner on login screens.
    final res = await _cachedGet(
      _uri('/api/v1/app/version'),
      headers: _jsonHeaders(),
      trackConnectivity: false,
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> initSkillEnrollment(
    String skillId, {
    required String fullName,
    required String phone,
    String? email,
    String? location,
    String? preferredStart,
    String? notes,
    String paymentMode = 'half',
    int installment = 1,
  }) async {
    final res = await _onlinePost(
      _uri('/api/v1/payments/flutterwave/skills/$skillId/init'),
      headers: await _authHeaders(),
      body: jsonEncode({
        'full_name': fullName,
        'phone': phone,
        if (email != null && email.isNotEmpty) 'email': email,
        if (location != null && location.isNotEmpty) 'location': location,
        if (preferredStart != null && preferredStart.isNotEmpty)
          'preferred_start': preferredStart,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        'payment_mode': paymentMode,
        'installment': installment,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> verifyFlutterwaveSkill({
    required String transactionId,
    required String skillId,
    String? txRef,
  }) async {
    final res = await _onlinePost(
      _uri('/api/v1/payments/flutterwave/verify'),
      headers: await _authHeaders(),
      body: jsonEncode({
        'transaction_id': transactionId,
        'skill_id': skillId,
        if (txRef != null && txRef.isNotEmpty) 'tx_ref': txRef,
      }),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> skillEnrollments() async {
    final res = await _cachedGet(
      _uri('/api/v1/payments/flutterwave/skills/enrollments'),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    final list = data['enrollments'];
    return list is List ? list : const [];
  }

  Future<List<dynamic>> cbtMySessions() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtMySessions),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  /// Upload a PDF/DOCX/JSON and preview extracted questions before publishing.
  Future<Map<String, dynamic>> previewSchoolExamFile(
    List<int> bytes,
    String filename,
  ) async {
    final token = await getToken();
    final request = http.MultipartRequest(
      'POST',
      _uri('${ApiEndpoints.cbtSchoolExamsCreate}/import-preview'),
    );
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.files.add(
      http.MultipartFile.fromBytes('file', bytes, filename: filename),
    );
    final streamed = await request.send().timeout(const Duration(seconds: 120));
    final res = await http.Response.fromStream(streamed);
    return _parseMap(res);
  }

  Future<List<dynamic>> teacherSchoolExams() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtSchoolExamsMine),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> createSchoolExam({
    required String title,
    required String subject,
    required int durationMinutes,
    required DateTime scheduledStart,
    required DateTime scheduledEnd,
    required List<Map<String, dynamic>> questions,
    bool cameraRequired = false,
    bool aiLocked = false,
    bool blockMinimize = false,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.cbtSchoolExamsCreate),
      headers: await _authHeaders(),
      body: jsonEncode({
        'title': title,
        'subject': subject,
        'duration_minutes': durationMinutes,
        'scheduled_start': scheduledStart.toUtc().toIso8601String(),
        'scheduled_end': scheduledEnd.toUtc().toIso8601String(),
        'questions': questions,
        'camera_required': cameraRequired,
        'ai_locked': aiLocked,
        'block_minimize': blockMinimize,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> schoolExamResults(String examId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.cbtSchoolExamResults(examId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  // ── Community ───────────────────────────────────────────────────────────────

  Future<List<dynamic>> communityChannels() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.communityChannels),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<List<dynamic>> getMessages({
    required String channelId,
    int limit = 100,
    int offset = 0,
  }) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.communityMessages, {
        'channel_id': channelId,
        'limit': '$limit',
        'offset': '$offset',
      }),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> sendMessage({
    required String channelId,
    required String content,
    String? mediaUrl,
    String? mediaType,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.communityMessages),
      headers: await _authHeaders(),
      body: jsonEncode({
        'channel_id': channelId,
        'content': content,
        if (mediaUrl != null) 'media_url': mediaUrl,
        if (mediaType != null) 'media_type': mediaType,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> joinChannel({required String channelId}) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.communityJoin),
      headers: await _authHeaders(),
      body: jsonEncode({'channel_id': channelId}),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> communityUpload(
    List<int> bytes,
    String filename,
  ) async {
    final token = await getToken();
    final request = http.MultipartRequest(
      'POST',
      _uri(ApiEndpoints.communityUpload),
    );
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.files.add(
      http.MultipartFile.fromBytes(
        'file',
        bytes,
        filename: filename,
        contentType: _communityUploadMime(filename),
      ),
    );

    try {
      final streamed =
          await request.send().timeout(const Duration(seconds: 60));
      OfflineStatusService.instance.markOnline();
      final res = await http.Response.fromStream(streamed);
      return _parseMap(res);
    } catch (e) {
      if (e is ApiException) rethrow;
      OfflineStatusService.instance.markOffline();
      throw const ApiException.message(
        'Uploading requires internet data. Connect and try again.',
      );
    }
  }

  Future<List<dynamic>> listTeacherAnnouncements() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.communityAnnouncements),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<List<dynamic>> listPublicTeachers() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.teachersList),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> submitAssignment({
    required String channelId,
    required String teacherId,
    required String fileUrl,
    String? caption,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.communityAssignments),
      headers: await _authHeaders(),
      body: jsonEncode({
        'channel_id': channelId,
        'tagged_teacher_id': teacherId,
        'file_url': fileUrl,
        'file_type': 'pdf',
        if (caption != null && caption.trim().isNotEmpty)
          'caption': caption.trim(),
      }),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> myAssignmentSubmissions() async {
    final res = await _cachedGet(
      _uri('${ApiEndpoints.communityAssignments}/mine'),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  MediaType? _communityUploadMime(String filename) {
    final lower = filename.toLowerCase();
    if (lower.endsWith('.m4a') || lower.endsWith('.aac')) {
      return MediaType('audio', 'mp4');
    }
    if (lower.endsWith('.mp3')) return MediaType('audio', 'mpeg');
    if (lower.endsWith('.webm')) return MediaType('audio', 'webm');
    if (lower.endsWith('.ogg')) return MediaType('audio', 'ogg');
    if (lower.endsWith('.wav')) return MediaType('audio', 'wav');
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return MediaType('image', 'jpeg');
    }
    if (lower.endsWith('.png')) return MediaType('image', 'png');
    if (lower.endsWith('.webp')) return MediaType('image', 'webp');
    if (lower.endsWith('.pdf')) return MediaType('application', 'pdf');
    return null;
  }

  Future<List<dynamic>> listPosts({
    required String channelId,
    int limit = 30,
    int offset = 0,
  }) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.communityPosts, {
        'channel_id': channelId,
        'limit': '$limit',
        'offset': '$offset',
      }),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> createPost({
    required String channelId,
    required String content,
    bool isAnonymous = false,
    String visibility = 'everyone',
    String? mediaUrl,
    String? mediaType,
    String? cbtExamId,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.communityPosts),
      headers: await _authHeaders(),
      body: jsonEncode({
        'channel_id': channelId,
        'content': content,
        'is_anonymous': isAnonymous,
        'visibility': visibility,
        if (mediaUrl != null) 'media_url': mediaUrl,
        if (mediaType != null) 'media_type': mediaType,
        if (cbtExamId != null) 'cbt_exam_id': cbtExamId,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> updateCommunityPost({
    required String postId,
    required String content,
  }) async {
    final res = await _onlinePatch(
      _uri(ApiEndpoints.communityPostUpdate(postId)),
      headers: await _authHeaders(),
      body: jsonEncode({'content': content}),
    );
    return _parseMap(res);
  }

  Future<void> deleteCommunityPost(String postId) async {
    final res = await _onlineDelete(
      _uri(ApiEndpoints.communityPostDelete(postId)),
      headers: await _authHeaders(),
    );
    if (res.statusCode >= 400) _parseMap(res);
  }

  Future<Map<String, dynamic>> startGroupVoiceCall(String groupId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentGroupCallStart(groupId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>?> getActiveGroupCall(String groupId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentGroupCallActive(groupId)),
      headers: await _authHeaders(),
    );
    if (res.statusCode == 204 || res.body.isEmpty) return null;
    final data = _parseMap(res);
    if (data['active'] == false) return null;
    return data;
  }

  Future<Map<String, dynamic>> joinGroupVoiceCall(String groupId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentGroupCallJoin(groupId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<void> endGroupVoiceCall(String groupId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentGroupCallEnd(groupId)),
      headers: await _authHeaders(),
    );
    if (res.statusCode >= 400) _parseMap(res);
  }

  Future<void> declineGroupVoiceCall(String groupId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentGroupCallDecline(groupId)),
      headers: await _authHeaders(),
    );
    if (res.statusCode >= 400) _parseMap(res);
  }

  Future<Map<String, dynamic>> toggleLike(String postId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.communityPostLike(postId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> getPinnedPosts(String channelId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.communityChannelPinned(channelId)),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<List<dynamic>> getPostComments({
    required String postId,
    required String channelId,
    int limit = 200,
    int offset = 0,
  }) async {
    final all = await listAllPostComments(channelId: channelId, limit: limit);
    final prefix = '@post:$postId';
    return all.where((item) {
      if (item is! Map) return false;
      final content = item['content']?.toString() ?? '';
      return content.startsWith('$prefix ') || content == prefix;
    }).toList();
  }

  Future<List<dynamic>> listAllPostComments({
    required String channelId,
    int limit = 300,
    int offset = 0,
  }) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.communityPostComments, {
        'channel_id': channelId,
        'limit': '$limit',
        'offset': '$offset',
      }),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> addPostComment({
    required String postId,
    required String channelId,
    required String content,
    bool isAnonymous = false,
    String visibility = 'everyone',
  }) async {
    final trimmed = content.trim();
    final body = trimmed.isEmpty ? '@post:$postId' : '@post:$postId $trimmed';
    return createPost(
      channelId: channelId,
      content: body,
      isAnonymous: isAnonymous,
      visibility: visibility,
    );
  }

  String parseCommentText(String raw) {
    final match = RegExp(r'^@post:[^\s]+\s*').firstMatch(raw);
    if (match != null) {
      return raw.substring(match.end).trim();
    }
    return raw.trim();
  }

  // ── Live classes ────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> createLiveClass({
    required String subject,
    required String title,
    String? description,
    String? startTime,
    String? endTime,
    int? durationMinutes,
    bool goLiveNow = false,
    String visibility = 'public',
    List<String> invitedStudentIds = const [],
    List<String> invitedStudentEmails = const [],
    String? schoolGroupId,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassCreate),
      headers: await _authHeaders(),
      body: jsonEncode({
        'subject': subject,
        'title': title,
        if (description != null) 'description': description,
        if (startTime != null) 'start_time': startTime,
        if (endTime != null) 'end_time': endTime,
        if (durationMinutes != null) 'duration_minutes': durationMinutes,
        'go_live_now': goLiveNow,
        'visibility': visibility,
        if (visibility == 'private') 'invited_student_ids': invitedStudentIds,
        if (visibility == 'private')
          'invited_student_emails': invitedStudentEmails,
        if (visibility == 'school_group' && schoolGroupId != null)
          'school_group_id': schoolGroupId,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> startLiveClass(String classId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassStart(classId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> joinLiveClass(String classId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassJoin(classId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  /// Join a live class by ID and return a full token payload (same shape as join-by-code).
  /// This is used when the student taps "Join Live" on a card that already shows the class id.
  Future<Map<String, dynamic>> joinLiveClassById(String classId) async {
    // POST /{classId}/join returns the same token payload as join-by-code
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassJoin(classId)),
      headers: await _authHeaders(),
    );
    final data = _parseMap(res);
    // Also fetch a fresh token so we always have livekit_token + livekit_url
    if ((data['livekit_token'] ?? '').toString().isEmpty) {
      try {
        final tok = await getLiveClassToken(classId);
        data.addAll(tok);
      } catch (_) {}
    }
    return data;
  }

  Future<Map<String, dynamic>> getLiveClassToken(String classId) async {
    // Always fresh — stale JWTs break publish grants / A/V between teacher & student.
    final res = await _onlineGet(
      _uri(ApiEndpoints.liveClassToken(classId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> listLiveClasses({
    String? subject,
    String? status,
    int limit = 50,
    int offset = 0,
  }) async {
    final query = <String, String>{'limit': '$limit', 'offset': '$offset'};
    if (subject != null && subject.isNotEmpty) query['subject'] = subject;
    if (status != null && status.isNotEmpty) query['status'] = status;

    final res = await _cachedGet(
      _uri(ApiEndpoints.liveClassList, query),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> getLiveClassDetail(String classId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.liveClassDetail(classId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> getLiveClassPresence(String classId) async {
    final res = await _onlineGet(
      _uri(ApiEndpoints.liveClassPresence(classId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> endLiveClass(String classId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassEnd(classId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> leaveLiveClass(String classId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassLeave(classId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> listLiveClassStudents(String classId) async {
    final res = await _onlineGet(
      _uri(ApiEndpoints.liveClassStudents(classId)),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<void> unmuteLiveClassStudent(String classId, String studentId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassUnmute(classId, studentId)),
      headers: await _authHeaders(),
    );
    _parse(res);
  }

  Future<void> muteLiveClassStudent(String classId, String studentId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassMute(classId, studentId)),
      headers: await _authHeaders(),
    );
    _parse(res);
  }

  Future<void> allowLiveClassCamera(String classId, String studentId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassAllowCamera(classId, studentId)),
      headers: await _authHeaders(),
    );
    _parse(res);
  }

  Future<void> revokeLiveClassCamera(String classId, String studentId) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassRevokeCamera(classId, studentId)),
      headers: await _authHeaders(),
    );
    _parse(res);
  }

  Future<List<dynamic>> listSchoolGroups() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.schoolGroupsMine),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> getSchoolGroup(String groupId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.schoolGroup(groupId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> createSchoolGroup({
    required String schoolName,
    required String name,
    List<String> studentIds = const [],
    List<String> studentEmails = const [],
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.schoolGroupsCreate),
      headers: await _authHeaders(),
      body: jsonEncode({
        'school_name': schoolName,
        'name': name,
        'student_ids': studentIds,
        'student_emails': studentEmails,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> updateSchoolGroup(
    String groupId, {
    String? schoolName,
    String? name,
    List<String>? studentIds,
    List<String>? studentEmails,
  }) async {
    final body = <String, dynamic>{};
    if (schoolName != null) body['school_name'] = schoolName;
    if (name != null) body['name'] = name;
    if (studentIds != null) body['student_ids'] = studentIds;
    if (studentEmails != null) body['student_emails'] = studentEmails;
    final res = await _onlinePatch(
      _uri(ApiEndpoints.schoolGroup(groupId)),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> getLiveKitStatus() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.liveClassLivekitStatus),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> listLiveSessionRequests({
    String? status,
    int limit = 50,
    int offset = 0,
  }) async {
    final role = await getRole();
    final path = (role == 'student' || role == 'kind')
        ? ApiEndpoints.liveClassRequestsMine
        : ApiEndpoints.liveClassRequests;

    final query = <String, String>{'limit': '$limit', 'offset': '$offset'};
    if (status != null && status.isNotEmpty) query['status'] = status;

    final res = await _cachedGet(
      _uri(path, query),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  /// Book a live one-on-one session (student or kids).
  Future<Map<String, dynamic>> createLiveSessionRequest({
    required String subject,
    String? topic,
    String? message,
    String? preferredTime,
  }) async {
    final body = <String, dynamic>{
      'subject': subject,
      if (topic != null && topic.trim().isNotEmpty) 'topic': topic.trim(),
      if (message != null && message.trim().isNotEmpty)
        'message': message.trim(),
    };
    // Preferred time as ISO if parseable, otherwise keep in message only.
    if (preferredTime != null && preferredTime.trim().isNotEmpty) {
      final parsed = DateTime.tryParse(preferredTime.trim());
      if (parsed != null) {
        body['preferred_time'] = parsed.toUtc().toIso8601String();
      }
    }
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassRequests),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> myAccessCodes() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.liveClassAccessCodesMine),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<void> markAccessCodesRead() async {
    await _onlinePost(
      _uri(ApiEndpoints.liveClassAccessCodesMarkRead),
      headers: await _authHeaders(),
    );
  }

  Future<Map<String, dynamic>> joinPreviewByCode(String code) async {
    final normalized = code.trim().toUpperCase();
    final res = await _cachedGet(
      _uri(ApiEndpoints.liveClassJoinPreview, {'code': normalized}),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> joinLiveClassByCode(String code) async {
    final normalized = code.trim().toUpperCase();
    final res = await _onlinePost(
      _uri(ApiEndpoints.liveClassJoinByCode),
      headers: await _authHeaders(),
      body: jsonEncode({'code': normalized}),
    );
    return _parseMap(res);
  }

  /// Active live-class subscription / plan status (after Subscription payment).
  Future<Map<String, dynamic>> getLiveClassPlans() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.liveClassPlans),
      headers: await _authHeaders(),
      trackConnectivity: false,
    );
    return _parseMap(res);
  }

  /// Whether the signed-in student can join a specific live class.
  Future<Map<String, dynamic>> getLiveClassAccess(String classId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.liveClassAccess(classId)),
      headers: await _authHeaders(),
      trackConnectivity: false,
    );
    return _parseMap(res);
  }

  // ── Student groups ──────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> createStudentGroup({
    required String name,
    String? description,
    bool isPublic = true,
    bool isCommunityListed = true,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentGroups),
      headers: await _authHeaders(),
      body: jsonEncode({
        'name': name.trim(),
        if (description != null && description.trim().isNotEmpty)
          'description': description.trim(),
        'is_public': isPublic,
        'is_community_listed': isCommunityListed,
      }),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> updateStudentGroup(
    String groupId, {
    String? name,
    String? description,
    String? imageUrl,
  }) async {
    final body = <String, dynamic>{};
    if (name != null) body['name'] = name.trim();
    if (description != null) body['description'] = description.trim();
    if (imageUrl != null) body['image_url'] = imageUrl.trim();
    final res = await _onlinePatch(
      _uri(ApiEndpoints.studentGroup(groupId)),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    return _parseMap(res);
  }

  /// Upload a photo then save it as the group image (admins/creators).
  Future<String> updateStudentGroupImage(
    String groupId,
    List<int> bytes,
    String filename,
  ) async {
    final uploaded = await communityUpload(bytes, filename);
    final raw =
        uploaded['file_url']?.toString() ??
        uploaded['url']?.toString() ??
        uploaded['secure_url']?.toString() ??
        '';
    final url = resolveMediaUrl(raw);
    if (url.isEmpty) {
      throw const ApiException.message(
        'Upload failed — no image URL returned.',
      );
    }
    final updated = await updateStudentGroup(groupId, imageUrl: url);
    final saved = resolveMediaUrl(updated['image_url']?.toString() ?? url);
    if (saved.isEmpty) {
      throw const ApiException.message(
        'Photo uploaded but server did not save it. Redeploy API / check image_url column.',
      );
    }
    return saved;
  }

  Future<List<dynamic>> myStudentGroups() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentGroupsMine),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<List<dynamic>> discoverStudentGroups() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentGroupsDiscover),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<List<dynamic>> communityListedGroups() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentGroupsCommunityListed),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> getStudentGroup(String groupId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentGroup(groupId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<Map<String, dynamic>> requestJoinStudentGroup(
    String groupId, {
    String? message,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentGroupJoinRequest(groupId)),
      headers: await _authHeaders(),
      body: jsonEncode({
        if (message != null && message.trim().isNotEmpty)
          'message': message.trim(),
      }),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> listGroupMembers(String groupId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentGroupMembers(groupId)),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<List<dynamic>> listGroupMessages(
    String groupId, {
    int limit = 120,
  }) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentGroupMessages(groupId), {'limit': '$limit'}),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> sendGroupMessage(
    String groupId,
    String content,
  ) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentGroupMessages(groupId)),
      headers: await _authHeaders(),
      body: jsonEncode({'content': content.trim()}),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> listGroupJoinRequests(String groupId) async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.studentGroupJoinRequests(groupId)),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> approveGroupJoinRequest(
    String groupId,
    String requestId,
  ) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.studentGroupApproveJoinRequest(groupId, requestId)),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  Future<List<dynamic>> mySchoolGroups() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.schoolGroupsStudentMine),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  // ── Materials ───────────────────────────────────────────────────────────────

  Future<List<dynamic>> teacherMaterials() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.materialsMine),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> createMaterial({
    required String title,
    required String subject,
    required String fileUrl,
    String materialType = 'pdf',
    String? description,
    bool isFree = true,
    double price = 0,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.materialsCreate),
      headers: await _authHeaders(),
      body: jsonEncode({
        'title': title,
        'subject': subject,
        'material_type': materialType,
        'file_url': fileUrl,
        if (description != null) 'description': description,
        'is_free': isFree,
        'price': price,
      }),
    );
    return _parseMap(res);
  }

  // ── Grading ─────────────────────────────────────────────────────────────────

  Future<List<dynamic>> teacherPendingAssignments() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.communityAssignmentsPending),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> postAssignmentResult({
    required String submissionId,
    required String resultText,
    String? resultScore,
    String? resultFeedback,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.communityAssignmentResult(submissionId)),
      headers: await _authHeaders(),
      body: jsonEncode({
        'result_text': resultText,
        if (resultScore != null) 'result_score': resultScore,
        if (resultFeedback != null) 'result_feedback': resultFeedback,
      }),
    );
    return _parseMap(res);
  }

  // ── Notifications ───────────────────────────────────────────────────────────

  Future<List<dynamic>> notifications() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.notifications),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<void> markAllNotificationsRead() async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.notificationsReadAll),
      headers: await _authHeaders(),
    );
    _parse(res);
  }

  Future<int> unreadNotificationCount() async {
    try {
      final items = await notifications();
      return items.where((n) {
        if (n is! Map) return false;
        return n['is_read'] != true;
      }).length;
    } catch (_) {
      return 0;
    }
  }

  Future<int> unreadCommunityCount() async {
    try {
      final items = await notifications();
      return items.where((n) {
        if (n is! Map || n['is_read'] == true) return false;
        final t = (n['type']?.toString() ?? '').toLowerCase();
        return t.contains('announcement') ||
            t.contains('community') ||
            t.contains('mention');
      }).length;
    } catch (_) {
      return 0;
    }
  }

  Future<void> registerDeviceToken({
    required String token,
    required String platform,
  }) async {
    final res = await _onlinePost(
      _uri(ApiEndpoints.notificationsDeviceToken),
      headers: await _authHeaders(),
      body: jsonEncode({'token': token, 'platform': platform}),
    );
    _parse(res);
  }

  // ── Home ────────────────────────────────────────────────────────────────────

  Future<List<dynamic>> getRecommendationsFeed({
    String? subject,
    String? examType,
    int limit = 20,
    int offset = 0,
  }) async {
    final query = <String, String>{'limit': '$limit', 'offset': '$offset'};
    if (subject != null && subject.isNotEmpty) query['subject'] = subject;
    if (examType != null && examType.isNotEmpty) query['exam_type'] = examType;

    final res = await _cachedGet(
      _uri(ApiEndpoints.recommendationsFeed, query),
      headers: await _authHeaders(),
    );
    return _parseList(res);
  }

  Future<Map<String, dynamic>> getHomeFeed() async {
    final res = await _cachedGet(
      _uri(ApiEndpoints.homeFeed),
      headers: await _authHeaders(),
    );
    return _parseMap(res);
  }

  // ── Past Questions Shop ─────────────────────────────────────────────────────

  /// Public catalog — no login required. Returns {items: [...], total: N}.
  Future<Map<String, dynamic>> getPastQuestionsCatalog({
    String? examType,
    String? subject,
  }) async {
    final params = <String, String>{};
    if (examType != null && examType.isNotEmpty && examType != 'ALL') {
      params['exam_type'] = examType;
    }
    if (subject != null && subject.isNotEmpty) {
      params['subject'] = subject;
    }
    final uri = Uri.parse('${ApiEndpoints.baseUrl}/api/v1/past-questions/catalog')
        .replace(queryParameters: params.isEmpty ? null : params);
    final res = await _cachedGet(uri, trackConnectivity: false);
    return _parseMap(res);
  }

  /// Start a guest Paystack payment for a past questions PDF (no account needed).
  Future<Map<String, dynamic>> initPastQuestionGuestPayment({
    required String bookId,
    required String email,
    String? fullName,
  }) async {
    final body = <String, dynamic>{
      'book_id': bookId,
      'email': email,
    };
    if (fullName != null && fullName.isNotEmpty) body['full_name'] = fullName;
    final res = await _onlinePost(
      Uri.parse('${ApiEndpoints.baseUrl}/api/v1/payments/paystack/guest/past-question/initialize'),
      body: jsonEncode(body),
    );
    return _parseMap(res);
  }
}

// ── Models ────────────────────────────────────────────────────────────────────

class AuthResponse {
  final String accessToken;
  final String refreshToken;
  final String role;
  final String? userId;

  const AuthResponse({
    required this.accessToken,
    required this.refreshToken,
    required this.role,
    this.userId,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) {
    final user = json['user'];
    return AuthResponse(
      accessToken: json['access_token'] as String? ?? '',
      refreshToken: json['refresh_token'] as String? ?? '',
      role:
          (json['role']?.toString() ??
                  (user is Map ? user['role']?.toString() : null) ??
                  'student')
              .toLowerCase()
              .trim(),
      userId: user is Map ? user['id']?.toString() : null,
    );
  }
}

class StudentProfile {
  final String fullName;
  final String email;
  final String? examType;
  final String? educationLevel;
  final List<String> subjects;
  final List<String> jambSubjects;
  final List<String> ssceSubjects;
  final String? ssceExamType;
  final bool hasActiveSubscription;
  final String? profilePicture;

  const StudentProfile({
    required this.fullName,
    required this.email,
    this.examType,
    this.educationLevel,
    this.subjects = const [],
    this.jambSubjects = const [],
    this.ssceSubjects = const [],
    this.ssceExamType,
    this.hasActiveSubscription = false,
    this.profilePicture,
  });

  factory StudentProfile.fromJson(Map<String, dynamic> json) {
    final rawSubjects = json['selected_subjects'];
    final jamb = json['jamb_subjects'];
    final ssce = json['ssce_subjects'];
    return StudentProfile(
      fullName: json['full_name'] as String? ?? '',
      email: json['email'] as String? ?? '',
      examType: json['exam_type'] as String?,
      educationLevel: json['education_level'] as String?,
      subjects: rawSubjects is List
          ? rawSubjects.map((e) => e.toString()).toList()
          : const [],
      jambSubjects: jamb is List
          ? jamb.map((e) => e.toString()).toList()
          : const [],
      ssceSubjects: ssce is List
          ? ssce.map((e) => e.toString()).toList()
          : const [],
      ssceExamType: json['ssce_exam_type'] as String?,
      hasActiveSubscription: json['has_active_subscription'] == true,
      profilePicture: json['profile_picture'] as String?,
    );
  }

  /// Friendly display name for UI — never returns empty or "Student".
  /// Use on the profile header, cards, comments, etc.
  String get displayName {
    final raw = fullName.trim();
    if (raw.isEmpty) return 'Your Name';
    if (raw.toLowerCase() == 'student') return 'Your Name';
    return raw;
  }

  /// First-name style greeting (e.g. "Ada"), falling back to "there".
  /// Use for "Hello, {greetingName}".
  String get greetingName {
    final raw = fullName.trim();
    if (raw.isEmpty) return 'there';
    if (raw.toLowerCase() == 'student') return 'there';
    return raw.split(RegExp(r'\s+')).firstWhere(
          (w) => w.isNotEmpty,
          orElse: () => raw,
        );
  }

  StudentProfile copyWith({
    String? fullName,
    String? email,
    String? profilePicture,
  }) {
    return StudentProfile(
      fullName: fullName ?? this.fullName,
      email: email ?? this.email,
      examType: examType,
      educationLevel: educationLevel,
      subjects: subjects,
      jambSubjects: jambSubjects,
      ssceSubjects: ssceSubjects,
      ssceExamType: ssceExamType,
      hasActiveSubscription: hasActiveSubscription,
      profilePicture: profilePicture ?? this.profilePicture,
    );
  }
}

class SiaResponse {
  final String sia;
  final List<SiaBoardItem> board;
  final String? student;
  final String? level;

  const SiaResponse({
    required this.sia,
    this.board = const [],
    this.student,
    this.level,
  });

  factory SiaResponse.fromJson(Map<String, dynamic> json) => SiaResponse(
    sia: json['sia']?.toString() ?? '',
    board: SiaBoardItem.listFromJson(json['board']),
    student: json['student'] as String?,
    level: json['level'] as String?,
  );
}

class KindSiaResponse {
  final String text;
  final List<SiaBoardItem> board;

  const KindSiaResponse({required this.text, this.board = const []});
}

class KindQuizQuestion {
  final String id;
  final String question;
  final Map<String, String> options;
  final String correct;

  const KindQuizQuestion({
    required this.id,
    required this.question,
    required this.options,
    this.correct = '',
  });

  bool get hasAnswerKey =>
      correct == 'A' || correct == 'B' || correct == 'C' || correct == 'D';

  /// Parse plain-text quizzes shaped like Q1. ... A) ... B) ...
  static List<KindQuizQuestion> parseFromText(String text) {
    if (text.trim().isEmpty) return const [];
    final out = <KindQuizQuestion>[];
    final blocks = text.split(RegExp(r'(?=\n?\s*Q\d+[\.\)\:])'));
    for (final block in blocks) {
      final qm = RegExp(
        r'Q(\d+)[\.\)\:]\s*(.+?)(?=\n\s*[A-D][\.\)])',
        caseSensitive: false,
        dotAll: true,
      ).firstMatch(block);
      if (qm == null) continue;
      final options = <String, String>{};
      for (final letter in ['A', 'B', 'C', 'D']) {
        final om = RegExp(
          '$letter[\\.\\)]\\s*(.+?)(?=\\n\\s*[A-D][\\.\\)]|\\n\\s*Q\\d+|\\Z)',
          caseSensitive: false,
          dotAll: true,
        ).firstMatch(block);
        if (om != null) {
          options[letter] = om.group(1)!.trim();
        }
      }
      if (options.length < 2) continue;
      out.add(
        KindQuizQuestion(
          id: qm.group(1)!,
          question: qm.group(2)!.trim(),
          options: options,
        ),
      );
    }
    return out;
  }
}

class KindQuizResult {
  final String intro;
  final String rawText;
  final List<KindQuizQuestion> questions;

  const KindQuizResult({
    required this.intro,
    this.rawText = '',
    this.questions = const [],
  });

  bool get isInteractive => questions.isNotEmpty;
}

class CbtSession {
  final String sessionId;
  final String examId;
  final int durationMinutes;
  final int totalQuestions;

  const CbtSession({
    required this.sessionId,
    required this.examId,
    required this.durationMinutes,
    required this.totalQuestions,
  });

  factory CbtSession.fromJson(Map<String, dynamic> json) => CbtSession(
    sessionId: json['session_id']?.toString() ?? '',
    examId: json['exam_id']?.toString() ?? '',
    durationMinutes: (json['duration_minutes'] as num?)?.toInt() ?? 60,
    totalQuestions: (json['total_questions'] as num?)?.toInt() ?? 0,
  );
}

class CbtQuestion {
  final String id;
  final String text;
  final List<String> options;
  final String? topic;
  final String? imageUrl;

  /// Present in offline practice packs for local scoring (never shown in UI).
  final String? correctOption;

  const CbtQuestion({
    required this.id,
    required this.text,
    required this.options,
    this.topic,
    this.imageUrl,
    this.correctOption,
  });

  bool get hasImage => imageUrl != null && imageUrl!.isNotEmpty;

  factory CbtQuestion.fromJson(Map<String, dynamic> json) {
    final options = <String>[
      json['option_a']?.toString() ?? '',
      json['option_b']?.toString() ?? '',
      json['option_c']?.toString() ?? '',
      json['option_d']?.toString() ?? '',
    ].where((o) => o.isNotEmpty).toList();

    final image =
        json['image_url']?.toString() ??
        json['imageUrl']?.toString() ??
        json['diagram_url']?.toString() ??
        json['diagram']?.toString() ??
        json['image']?.toString();

    final correct =
        json['correct_option']?.toString() ??
        json['correctOption']?.toString() ??
        json['answer']?.toString();

    return CbtQuestion(
      id: json['id']?.toString() ?? '',
      text: json['question_text'] as String? ?? json['text'] as String? ?? '',
      options: options,
      topic: json['topic']?.toString(),
      imageUrl: image != null && image.isNotEmpty ? image : null,
      correctOption: correct != null && correct.isNotEmpty
          ? correct.toUpperCase().substring(0, 1)
          : null,
    );
  }
}

class CbtResult {
  final double score;
  final double percentage;
  final int totalCorrect;
  final int totalWrong;
  final List<String> weakTopics;
  // Percentage-scale reporting (e.g. "220 / 400" for JAMB, or 78 / 100 for
  // WAEC subjects) plus the motivational rating from the server.
  final String? scoreDisplay;
  final String? rating;
  final String? ratingMessage;
  final Map<String, double> perSubjectScores;

  const CbtResult({
    required this.score,
    required this.percentage,
    required this.totalCorrect,
    required this.totalWrong,
    this.weakTopics = const [],
    this.scoreDisplay,
    this.rating,
    this.ratingMessage,
    this.perSubjectScores = const {},
  });

  factory CbtResult.fromJson(Map<String, dynamic> json) => CbtResult(
    score: (json['score'] as num?)?.toDouble() ?? 0,
    percentage: (json['percentage'] as num?)?.toDouble() ?? 0,
    totalCorrect: (json['total_correct'] as num?)?.toInt() ?? 0,
    totalWrong: (json['total_wrong'] as num?)?.toInt() ?? 0,
    weakTopics: json['weak_topics'] is List
        ? (json['weak_topics'] as List).map((e) => e.toString()).toList()
        : const [],
    scoreDisplay: json['score_display']?.toString(),
    rating: json['rating']?.toString(),
    ratingMessage: json['rating_message']?.toString(),
    perSubjectScores: json['per_subject_scores'] is Map
        ? (json['per_subject_scores'] as Map).map(
            (k, v) => MapEntry(k.toString(), (v as num?)?.toDouble() ?? 0),
          )
        : const {},
  );
}