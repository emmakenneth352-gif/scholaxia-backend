/// Agora credentials for Scholaxia live classes.
/// 
/// SECURITY WARNING: This file should NOT contain hardcoded credentials.
/// Agora App ID and tokens should be:
/// 1. Stored as environment variables
/// 2. Fetched from a secure backend API
/// 3. Never committed to source control
/// 
/// Current implementation uses LiveKit instead of Agora for video/audio.
/// This file is kept for reference but should be removed or properly secured.
class AgoraConfig {
  AgoraConfig._();

  /// App ID should be fetched from environment variables or backend
  /// Example: String.fromEnvironment('AGORA_APP_ID')
  static String get appId {
    const appId = String.fromEnvironment('AGORA_APP_ID', defaultValue: '');
    if (appId.isEmpty) {
      throw Exception('AGORA_APP_ID environment variable not set');
    }
    return appId;
  }

  /// Token should be fetched from backend API per channel
  /// Never hardcode tokens in source code
  static String? get token => null; // Fetch from backend

  /// Default channel name
  static const String defaultChannel = 'scholaxia-live';
}
