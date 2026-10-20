import 'package:flutter/material.dart';

import '../../../api/api_service.dart';
import '../../../models/sia_board_item.dart';
import '../../../services/sia_voice_input_service.dart';
import '../../../services/sia_voice_service.dart';
import '../../../theme/app_theme.dart';
import '../../../widgets/sia_board_panel.dart';

/// Result from a voice-classroom question — speak aloud, show key points on board only.
class SiaVoiceAskResult {
  final List<SiaBoardItem> board;
  final String speakText;

  const SiaVoiceAskResult({required this.board, required this.speakText});
}

typedef SiaVoiceAskFn = Future<SiaVoiceAskResult> Function(
  String question,
  String subject,
);

/// Full-screen voice classroom — board + voice replies (like sia-web classroom).
class SiaVoiceClassroomScreen extends StatefulWidget {
  final String title;
  final String studentName;
  final List<String> subjects;
  final String initialSubject;
  final SiaVoiceAskFn onAsk;

  const SiaVoiceClassroomScreen({
    super.key,
    this.title = 'Sia Voice Chat',
    required this.studentName,
    required this.subjects,
    required this.initialSubject,
    required this.onAsk,
  });

  @override
  State<SiaVoiceClassroomScreen> createState() => _SiaVoiceClassroomScreenState();
}

class _SiaVoiceClassroomScreenState extends State<SiaVoiceClassroomScreen> {
  final _voiceInput = SiaVoiceInputService.instance;
  final _boardScroll = ScrollController();
  final _windowsQuestionCtrl = TextEditingController();

  late String _subject;
  late List<SiaBoardItem> _boardItems;
  String _statusLine = '';
  bool _listening = false;
  bool _asking = false;
  bool _isSpeaking = false;

  bool get _useMic => SiaVoiceInputService.isMicSupported;

  @override
  void initState() {
    super.initState();
    _subject = widget.initialSubject.isNotEmpty
        ? widget.initialSubject
        : 'General';
    _boardItems = _welcomeBoard();
  }

  List<SiaBoardItem> _welcomeBoard() {
    final name = widget.studentName.split(' ').first;
    return [
      SiaBoardItem(type: 'heading', content: 'Welcome, $name!'),
      const SiaBoardItem(
        type: 'point',
        content: 'Hold the purple mic and ask your question',
      ),
      const SiaBoardItem(
        type: 'point',
        content: 'Sia speaks the answer — key points appear here',
      ),
    ];
  }

  @override
  void dispose() {
    SiaVoiceService.instance.onSpeakingChanged = null;
    SiaVoiceService.instance.stop();
    SiaVoiceInputService.instance.stop();
    _boardScroll.dispose();
    _windowsQuestionCtrl.dispose();
    super.dispose();
  }

  Future<void> _startListen() async {
    if (!_useMic || _listening || _asking || _isSpeaking) return;

    try {
      await SiaVoiceService.instance.stop();
      final ready = await _voiceInput.ensureReady(context);
      if (!ready || !mounted) return;

      setState(() {
        _listening = true;
        _statusLine = 'Listening… release when done';
      });

      await _voiceInput.startListening(
        onPartial: (words) {
          if (!mounted) return;
          setState(() {
            _statusLine = words.isEmpty ? 'Listening… speak now' : words;
          });
        },
      );
    } catch (_) {
      if (mounted) setState(() => _listening = false);
    }
  }

  Future<void> _stopListenAndAsk() async {
    if (!_listening) return;

    try {
      final text = await _voiceInput.stopAndCapture();
      if (!mounted) return;
      setState(() {
        _listening = false;
        _statusLine = '';
      });
      if (text.isNotEmpty && !_asking) await _askSia(text);
    } catch (_) {
      if (mounted) setState(() => _listening = false);
    }
  }

  Future<void> _askFromField() async {
    final text = _windowsQuestionCtrl.text.trim();
    if (text.isEmpty || _asking) return;
    _windowsQuestionCtrl.clear();
    await _askSia(text);
  }

  String _formatAskError(Object error) {
    if (error is ApiException) {
      if (error.statusCode == 503) {
        final detail = error.message.trim();
        if (detail.isNotEmpty &&
            detail.toLowerCase() != 'internal server error' &&
            !detail.toLowerCase().contains('waking up')) {
          return detail;
        }
        return 'Sia is busy — wait a moment and try again.';
      }
      if (error.statusCode == 401 || error.statusCode == 403) {
        return 'Session expired — log out and sign in again.';
      }
      return error.message;
    }
    final text = error.toString();
    if (text.contains('TimeoutException') || text.contains('timed out')) {
      return 'Sia took too long — try a shorter question.';
    }
    if (text.contains('SocketException') ||
        text.contains('Failed host lookup') ||
        text.contains('Connection refused')) {
      return 'No internet connection. Check your network and try again.';
    }
    return 'Could not reach Sia. Try again in a moment.';
  }

  List<SiaBoardItem> _boardFromResult(SiaVoiceAskResult result) {
    final board = result.board;
    if (board.isNotEmpty) return board;

    final clean = result.speakText
        .split('\n')
        .map((l) => l.trim())
        .firstWhere((l) => l.length > 10, orElse: () => '');
    if (clean.isEmpty) {
      return [
        const SiaBoardItem(type: 'point', content: 'Listen — Sia is answering'),
      ];
    }
    final plain = clean.replaceAll('**', '');
    return [
      SiaBoardItem(
        type: 'point',
        content: plain.length > 120 ? plain.substring(0, 120) : plain,
      ),
    ];
  }

  Future<void> _askSia(String question) async {
    if (_asking) return;
    setState(() {
      _asking = true;
      _isSpeaking = false;
      _boardItems = [
        const SiaBoardItem(type: 'point', content: 'Sia is thinking…'),
      ];
    });

    SiaVoiceAskResult? result;
    String? askError;

    try {
      result = await widget.onAsk(question, _subject);
    } catch (e) {
      askError = _formatAskError(e);
    }

    if (!mounted) return;

    final answer = result;
    if (askError != null || answer == null) {
      setState(() {
        _asking = false;
        _boardItems = [
          const SiaBoardItem(type: 'heading', content: 'Could not get an answer'),
          SiaBoardItem(
            type: 'point',
            content: askError ?? 'Try again in a moment.',
          ),
          ..._welcomeBoard().skip(1),
        ];
      });
      return;
    }

    setState(() {
      _asking = false;
      _boardItems = _boardFromResult(answer);
    });

    if (!mounted) return;
    setState(() => _isSpeaking = true);
    await SiaVoiceService.instance.speak(answer.speakText);
    if (mounted) setState(() => _isSpeaking = false);
  }

  void _clearBoard() {
    setState(() => _boardItems = _welcomeBoard());
  }

  @override
  Widget build(BuildContext context) {
    final accent = context.accentColor;
    final subs = widget.subjects.isNotEmpty ? widget.subjects : ['General'];

    return Scaffold(
      backgroundColor: context.bgColor,
      body: SafeArea(
        child: Column(
          children: [
            _topBar(context, accent),
            Expanded(child: _board(context)),
            if (_isSpeaking) _speakingBar(context, accent),
            if (_listening) _listeningOverlay(context, accent),
            _bottomControls(context, accent, subs),
          ],
        ),
      ),
    );
  }

  Widget _topBar(BuildContext context, Color accent) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        gradient: AppGradients.hero(context),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
          ),
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _isSpeaking ? Colors.white : accent,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              widget.title,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
                fontSize: 16,
              ),
            ),
          ),
          Text(
            widget.studentName.split(' ').first,
            style: TextStyle(color: Colors.white.withOpacity(0.85), fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _board(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 8),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.borderColor),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF7C3AED).withOpacity(0.12),
            blurRadius: 20,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: SiaBoardPanel(
        items: _boardItems,
        embedded: true,
        purpleTheme: true,
        scrollController: _boardScroll,
      ),
    );
  }

  Widget _speakingBar(BuildContext context, Color accent) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: accent.withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accent.withOpacity(0.5)),
      ),
      child: Row(
        children: [
          Icon(Icons.graphic_eq_rounded, color: accent, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Sia is speaking… listen',
              style: TextStyle(color: context.textColor, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  Widget _listeningOverlay(BuildContext context, Color accent) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: accent.withOpacity(0.12),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent),
      ),
      child: Column(
        children: [
          Icon(Icons.mic_rounded, color: accent, size: 36),
          const SizedBox(height: 8),
          Text(
            _statusLine.isEmpty ? 'Listening…' : _statusLine,
            textAlign: TextAlign.center,
            style: TextStyle(color: context.textColor, fontSize: 15),
          ),
        ],
      ),
    );
  }

  Widget _bottomControls(BuildContext context, Color accent, List<String> subs) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      decoration: BoxDecoration(
        color: context.headerColor,
        border: Border(top: BorderSide(color: context.borderColor)),
      ),
      child: Column(
        children: [
          // Text field is available on every platform — the mic now works
          // everywhere too, but typing is still handy (and required if the
          // mic is denied).
          TextField(
            controller: _windowsQuestionCtrl,
            style: TextStyle(color: context.textColor),
            decoration: InputDecoration(
              hintText: 'Ask Sia anything…',
              hintStyle: TextStyle(color: context.greyColor),
              filled: true,
              fillColor: context.surfColor,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(color: context.borderColor),
              ),
            ),
            onSubmitted: (_) => _askFromField(),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              TextButton.icon(
                onPressed: _clearBoard,
                icon: Icon(Icons.delete_outline, color: context.greyColor),
                label: Text('Clear board',
                    style: TextStyle(color: context.greyColor)),
              ),
              if (_useMic) ...[
                const SizedBox(width: 24),
                Listener(
                  onPointerDown: (_) => _startListen(),
                  onPointerUp: (_) => _stopListenAndAsk(),
                  onPointerCancel: (_) => _stopListenAndAsk(),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    width: 88,
                    height: 88,
                    decoration: BoxDecoration(
                      gradient: _listening ? null : AppGradients.primaryButton,
                      color: _listening ? accent.withOpacity(0.25) : null,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: _listening ? accent : Colors.transparent,
                        width: 2,
                      ),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          _listening ? Icons.mic_rounded : Icons.mic_none_rounded,
                          color: _listening ? accent : Colors.white,
                          size: 32,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _listening ? 'Release' : 'Hold',
                          style: TextStyle(
                            color: _listening ? accent : Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ] else ...[
                const SizedBox(width: 12),
                GestureDetector(
                  onTap: _asking ? null : _askFromField,
                  child: Container(
                    height: 48,
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    decoration: BoxDecoration(
                      gradient: AppGradients.primaryButton,
                      borderRadius: BorderRadius.circular(24),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                        const SizedBox(width: 8),
                        Text(
                          _asking ? 'Wait…' : 'Ask Sia',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Hold mic → speak → release, or type above. Sia answers with voice.',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.greyColor, fontSize: 11),
          ),
        ],
      ),
    );
  }
}
