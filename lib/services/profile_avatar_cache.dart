import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Keeps a local copy of the profile photo so it still appears after app restart
/// even if the remote URL is slow or temporarily unavailable.
class ProfileAvatarCache {
  ProfileAvatarCache._();
  static final instance = ProfileAvatarCache._();

  Future<File> _file() async {
    final dir = await getApplicationDocumentsDirectory();
    return File('${dir.path}/scholaxia_profile_avatar.jpg');
  }

  Future<void> saveBytes(List<int> bytes) async {
    final f = await _file();
    await f.writeAsBytes(bytes, flush: true);
  }

  Future<File?> existingFile() async {
    final f = await _file();
    if (await f.exists()) return f;
    return null;
  }

  Future<void> clear() async {
    final f = await _file();
    try {
      if (await f.exists()) await f.delete();
    } on FileSystemException {
      // Windows can keep the JPG open while a screen still displays it.
      // Retry once after the widget tree lets go; if it still fails, leave
      // the stale file — it is only a cached avatar, not session data.
      await Future<void>.delayed(const Duration(milliseconds: 300));
      try {
        if (await f.exists()) await f.delete();
      } catch (_) {}
    }
  }
}
