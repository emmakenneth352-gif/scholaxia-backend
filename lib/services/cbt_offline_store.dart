import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Caches downloaded CBT packs so students can practise offline.
class CbtOfflineStore {
  CbtOfflineStore._();
  static final instance = CbtOfflineStore._();

  static final Map<String, Map<String, dynamic>> _memory = {};

  Future<Directory> _dir() async {
    if (kIsWeb) {
      throw UnsupportedError('Web CBT cache uses in-memory storage.');
    }
    final root = await getApplicationDocumentsDirectory();
    final d = Directory('${root.path}/cbt_offline');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  Future<File> _file(String examId) async {
    final d = await _dir();
    return File('${d.path}/$examId.json');
  }

  Future<void> savePack(String examId, Map<String, dynamic> pack) async {
    // Keep a session cache so peekCached works on every platform.
    _memory[examId] = Map<String, dynamic>.from(pack);
    if (kIsWeb) return;
    final f = await _file(examId);
    await f.writeAsString(jsonEncode(pack));
  }

  Future<Map<String, dynamic>?> loadPack(String examId) async {
    final cached = _memory[examId];
    if (cached != null) return Map<String, dynamic>.from(cached);
    if (kIsWeb) return null;
    final f = await _file(examId);
    if (!await f.exists()) return null;
    try {
      final raw = jsonDecode(await f.readAsString());
      if (raw is Map) {
        final map = Map<String, dynamic>.from(raw);
        _memory[examId] = map;
        return Map<String, dynamic>.from(map);
      }
    } catch (_) {}
    return null;
  }

  /// Synchronous read of the in-memory cache (no I/O).
  /// Only populated after [loadPack] ran for the same key in this session.
  Map<String, dynamic>? peekCached(String examId) {
    final cached = _memory[examId];
    if (cached == null) return null;
    return Map<String, dynamic>.from(cached);
  }

  Future<bool> isDownloaded(String examId) async {
    if (kIsWeb) return _memory.containsKey(examId);
    final f = await _file(examId);
    return f.exists();
  }

  Future<void> deletePack(String examId) async {
    if (kIsWeb) {
      _memory.remove(examId);
      return;
    }
    final f = await _file(examId);
    if (await f.exists()) {
      try {
        await f.delete();
      } catch (_) {}
    }
  }

  Future<Set<String>> downloadedIds() async {
    if (kIsWeb) return _memory.keys.toSet();
    final d = await _dir();
    final out = <String>{};
    await for (final e in d.list()) {
      if (e is File && e.path.endsWith('.json')) {
        out.add(e.uri.pathSegments.last.replaceAll('.json', ''));
      }
    }
    return out;
  }
}
