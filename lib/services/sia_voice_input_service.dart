import 'dart:io';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../api/api_endpoints.dart';
import '../api/api_service.dart';

/// Handles microphone permission + speech-to-text for Sia voice chat.
///
/// Platform strategy:
///  - Android/iOS/macOS: on-device speech_to_text (fast, live partials).
///  - Windows/Linux (and when on-device STT is unavailable): record with the
///    `record` plugin and transcribe on the server (/api/v1/sia/transcribe —
///    Groq/OpenAI Whisper). This is what makes the mic button actually work
///    in the Windows/desktop builds instead of doing nothing.
class SiaVoiceInputService {
  SiaVoiceInputService._();
  static final instance = SiaVoiceInputService._();

  /// Web has no dart:io Platform (throws) and Windows on-device STT plugin
  /// crashes the app (native thread bug). Web is excluded too.
  static bool get isMicSupported => !kIsWeb;

  final _speech = SpeechToText();
  final _recorder = AudioRecorder();
  bool _initialized = false;
  bool _onDeviceBroken = false; // set when initialize() keeps failing
  String _lastWords = '';
  int _session = 0;
  String? _recordingPath;

  String get lastWords => _lastWords;

  /// On-device speech recognition is only available on these platforms.
  static bool get _onDeviceAvailable =>
      !kIsWeb && !Platform.isWindows && !Platform.isLinux;

  /// True when speech goes through server transcription (Windows/Linux) —
  /// callers show a static "Listening…" because there are no live partials.
  static bool get serverStt => kIsWeb || !_onDeviceAvailable;

  Future<bool> ensureReady(BuildContext context) async {
    if (isMicSupported == false) return false;

    final perm = await Permission.microphone.request();
    if (!perm.isGranted) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Allow microphone access to use voice chat.'),
          ),
        );
      }
      return false;
    }

    if (_onDeviceAvailable && !_onDeviceBroken) {
      if (!_initialized) {
        try {
          _initialized = await _speech.initialize(
            onError: (_) {},
            onStatus: (_) {},
          );
        } catch (_) {
          _initialized = false;
        }
        // Windows: the plugin reports available but crashes on real use —
        // never trust it there. Other platforms: remember a hard failure.
        if (!_initialized && !Platform.isWindows) _onDeviceBroken = true;
      }
      if (_initialized) return true;
    }

    // Fallback: server transcription only needs mic permission + record.
    if (!_onDeviceAvailable || _onDeviceBroken) return true;

    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Voice input is not available on this device. Type your question instead.',
          ),
        ),
      );
    }
    return false;
  }

  void _runOnUi(void Function() fn) {
    SchedulerBinding.instance.scheduleFrameCallback((_) => fn());
  }

  Future<void> startListening({
    required void Function(String partial) onPartial,
    void Function(String finalText)? onFinal,
  }) async {
    if (!isMicSupported) return;

    _session++;
    final session = _session;
    _lastWords = '';

    if (_onDeviceAvailable && !_onDeviceBroken && _initialized) {
      if (_speech.isListening) {
        await _speech.stop();
        await Future.delayed(const Duration(milliseconds: 200));
      }
      await _speech.listen(
        onResult: (result) {
          if (session != _session) return;
          _runOnUi(() {
            if (session != _session) return;
            final words = result.recognizedWords.trim();
            if (words.isNotEmpty) {
              _lastWords = words;
              onPartial(words);
            }
            if (onFinal != null && result.finalResult && words.isNotEmpty) {
              onFinal(words);
            }
          });
        },
        listenOptions: SpeechListenOptions(
          listenMode: ListenMode.dictation,
          partialResults: true,
          pauseFor: const Duration(seconds: 5),
          listenFor: const Duration(seconds: 60),
          localeId: 'en_US',
          cancelOnError: false,
        ),
      );
      return;
    }

    // Server-STT fallback: record to a temp file; "partials" show a hint.
    _recordingPath =
        '${(await getTemporaryDirectory()).path}/sia_voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 96000),
      path: _recordingPath!,
    );
    _runOnUi(() {
      if (session == _session) onPartial('Listening…');
    });
  }

  /// Stops listening and returns the recognised text ('' when nothing heard).
  Future<String> stopAndCapture() async {
    if (!isMicSupported) return '';

    if (_onDeviceAvailable && !_onDeviceBroken && _initialized) {
      if (_speech.isListening) {
        await _speech.stop();
      }
      _session++;
      await Future.delayed(const Duration(milliseconds: 400));
      return _lastWords.trim();
    }

    // Server fallback: stop the recorder and send the clip to Whisper.
    final path = await _recorder.stop();
    _session++;
    if (path == null) return '';
    final file = File(path);
    if (!await file.exists()) return '';
    if (await file.length() < 1500) {
      try { await file.delete(); } catch (_) {}
      return '';
    }
    try {
      final text = await ApiService().transcribeVoiceFile(file);
      try { await file.delete(); } catch (_) {}
      return text.trim();
    } catch (_) {
      try { await file.delete(); } catch (_) {}
      return '';
    }
  }

  Future<void> stop() async {
    _session++;
    if (_onDeviceAvailable && _initialized && _speech.isListening) {
      await _speech.stop();
    }
    try {
      if (await _recorder.isRecording()) await _recorder.stop();
    } catch (_) {}
  }

  bool get isListening => _onDeviceAvailable && _initialized && _speech.isListening;
}
