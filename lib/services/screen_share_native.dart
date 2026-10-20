import 'dart:async';

import 'package:flutter/services.dart';

/// Bridges to the native Android side to run the mediaProjection
/// foreground service required while screen sharing on Android 14+.
///
/// Correct order (enforced by Android 14+):
///  1. [requestConsent] shows the system screen-capture dialog through
///     flutter_webrtc (`FlutterWebRTC.Method/requestCapturePermission`),
///     which also caches the projection data inside the plugin so the
///     dialog is not shown a second time when LiveKit publishes the track.
///  2. [start] launches ScreenShareForegroundService (type mediaProjection).
///  3. LiveKit/webrtc calls `MediaProjectionManager.getMediaProjection()`
///     and the capture begins.
class ScreenShareNative {
  static const MethodChannel _channel = MethodChannel('scholaxia/screen_share');
  static const MethodChannel _webrtcChannel =
      MethodChannel('FlutterWebRTC.Method');

  /// Shows the Android screen-capture consent dialog.
  ///
  /// Returns true when the user accepted (or on platforms where no
  /// consent step is needed, e.g. Windows/web).
  static Future<bool> requestConsent() async {
    try {
      final ok = await _webrtcChannel.invokeMethod<bool>(
        'requestCapturePermission',
        <String, dynamic>{'fullScreenOnly': true},
      );
      return ok ?? false;
    } on MissingPluginException {
      // flutter_webrtc not available on this platform — let the
      // normal LiveKit flow handle consent (Windows/web/desktop).
      return true;
    } on PlatformException {
      return false;
    }
  }

  /// Starts the foreground service. Returns false if the OS refused
  /// (e.g. consent revoked between dialog and start).
  static Future<bool> start() async {
    try {
      return await _channel.invokeMethod<bool>('startScreenShareService') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      // Non-Android platforms (Windows/web) have no such service.
      return true;
    }
  }

  static Future<void> stop() async {
    try {
      await _channel.invokeMethod<void>('stopScreenShareService');
    } on PlatformException {
      // ignore
    } on MissingPluginException {
      // ignore
    }
  }

  static Future<bool> isRunning() async {
    try {
      return await _channel.invokeMethod<bool>('isScreenShareServiceRunning') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
