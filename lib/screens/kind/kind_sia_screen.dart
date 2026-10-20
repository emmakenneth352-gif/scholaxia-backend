import 'package:flutter/material.dart';
import '../../api/api_service.dart';
import '../../services/chat_persistence_service.dart';
import '../../services/sia_voice_service.dart';
import '../../theme/app_theme.dart';
import '../student/sia/sia_voice_classroom_screen.dart';

class KindSiaScreen extends StatefulWidget {
  const KindSiaScreen({super.key});

  @override
  State<KindSiaScreen> createState() => _KindSiaScreenState();
}

class _KindSiaScreenState extends State<KindSiaScreen> {
  static const _chatChannel = 'kind_sia';

  final _api = ApiService();
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _messages = <_Msg>[];
  bool _loading = false;
  bool _voiceOn = false; // kids tap 🔊 to hear a reply — no auto-read
  String _subject = 'General';
  List<String> _subjects = ['General'];
  String _childName = 'Friend';

  final GlobalKey _lastMsgKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    SiaVoiceService.instance.init();
    _bootstrap();
  }

  Future<void> _speakAi(String text) async {
    if (!_voiceOn || text.trim().isEmpty) return;
    await SiaVoiceService.instance.speak(text);
  }

  void _openVoiceClassroom() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SiaVoiceClassroomScreen(
          title: 'Sia Voice Chat',
          studentName: _childName,
          subjects: _subjects,
          initialSubject: _subject,
          onAsk: (question, subject) async {
            final r = await _api.kindSiaChat(
              question: question,
              subject: subject,
              conversationHistory: _buildHistory(),
            );
            return SiaVoiceAskResult(board: r.board, speakText: r.text);
          },
        ),
      ),
    );
  }

  Future<void> _bootstrap() async {
    final saved = await ChatPersistenceService.instance.load(_chatChannel);
    if (!mounted) return;
    if (saved.isNotEmpty) {
      setState(() {
        _messages
          ..clear()
          ..addAll(saved.map((m) => _Msg(isAi: m.isAi, text: m.text)));
      });
      _scrollToBottom();
    } else {
      setState(() {
        _messages.add(_defaultWelcome());
      });
    }
    _loadSubjects();
  }

  _Msg _defaultWelcome() => const _Msg(
        isAi: true,
        text:
            "Hi! I'm Sia — your friendly learning buddy. Type here or tap the mic for voice chat with the board!",
      );

  Future<void> _persistChat() async {
    await ChatPersistenceService.instance.save(
      _chatChannel,
      _messages
          .map((m) => StoredChatMessage(isAi: m.isAi, text: m.text))
          .toList(),
    );
  }

  Future<void> _clearChat() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clear chat?'),
        content: const Text('Delete your Sia chat on this device?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Clear', style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await ChatPersistenceService.instance.clear(_chatChannel);
    setState(() {
      _messages
        ..clear()
        ..add(_defaultWelcome());
    });
    await _persistChat();
  }

  @override
  void dispose() {
    SiaVoiceService.instance.stop();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _loadSubjects() async {
    try {
      final me = await _api.getKindMe();
      final name = (me['full_name'] ?? me['first_name'] ?? me['name'])?.toString().trim();
      if (mounted && name != null && name.isNotEmpty) {
        setState(() => _childName = name.split(' ').first);
      }
    } catch (_) {}
    try {
      final subs = await _api.kindSubjects();
      if (mounted && subs.isNotEmpty) setState(() => _subjects = subs);
    } catch (_) {}
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _loading) return;
    setState(() {
      _messages.add(_Msg(isAi: false, text: text));
      _loading = true;
    });
    _input.clear();
    _scrollToBottom();
    await _persistChat();
    try {
      final reply = await _api.kindSiaChat(
        question: text,
        subject: _subject,
        conversationHistory: _buildHistory(),
      );
      if (mounted) {
        setState(() => _messages.add(_Msg(isAi: true, text: reply.text)));
        _scrollToBottom();
        await _persistChat();
        await _speakAi(reply.text);
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _messages.add(_Msg(isAi: true, text: e.message)));
        await _persistChat();
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _scrollToBottom() {
    // When a new AI reply lands, align its TOP with the top of the screen —
    // the child reads downwards naturally instead of landing at the bottom
    // of the reply.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final ctx = _lastMsgKey.currentContext;
      if (ctx != null) {
        Scrollable.ensureVisible(
          ctx,
          alignment: 0.0,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      } else if (_scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  List<Map<String, dynamic>> _buildHistory() {
    final history = <Map<String, dynamic>>[];
    for (final m in _messages) {
      if (m.isAi && m.text.contains('friendly learning buddy')) continue;
      history.add({
        'role': m.isAi ? 'assistant' : 'user',
        'content': m.text,
      });
    }
    if (history.length > 14) {
      return history.sublist(history.length - 14);
    }
    return history;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      body: Column(
        children: [
          Container(
            width: double.infinity,
            decoration: BoxDecoration(
              gradient: AppGradients.hero(context),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF7C3AED).withOpacity(0.25),
                  blurRadius: 16,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(Icons.auto_awesome_rounded,
                          color: Colors.white, size: 24),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Sia Kids',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            'Text chat — tap mic for voice classroom',
                            style: TextStyle(
                              color: Colors.white.withOpacity(0.8),
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: _openVoiceClassroom,
                      icon: Icon(Icons.mic_rounded,
                          color: Colors.white.withOpacity(0.95), size: 26),
                      tooltip: 'Voice chat',
                    ),
                    if (_messages.length > 1)
                      IconButton(
                        onPressed: _clearChat,
                        icon: Icon(Icons.delete_outline_rounded,
                            color: Colors.white.withOpacity(0.9)),
                        tooltip: 'Clear chat',
                      ),
                    IconButton(
                      onPressed: () => setState(() => _voiceOn = !_voiceOn),
                      icon: Icon(
                        _voiceOn ? Icons.volume_up_rounded : Icons.volume_off_rounded,
                        color: Colors.white.withOpacity(0.9),
                      ),
                      tooltip: _voiceOn ? 'Read replies aloud' : 'Mute',
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              itemCount: _messages.length,
              // Tag the newest message so _scrollToBottom aligns its top.
              itemBuilder: (_, i) {
                final child = _bubble(context, _messages[i]);
                return i == _messages.length - 1
                    ? KeyedSubtree(key: _lastMsgKey, child: child)
                    : child;
              },
            ),
          ),
          if (_loading)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text('Sia is thinking…',
                  style: TextStyle(color: context.greyColor, fontSize: 12)),
            ),
          Container(
            padding: EdgeInsets.fromLTRB(
                12, 10, 12, MediaQuery.of(context).padding.bottom + 12),
            decoration: BoxDecoration(
              color: context.headerColor,
              border: Border(top: BorderSide(color: context.borderColor)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    style: TextStyle(color: context.textColor),
                    decoration: InputDecoration(
                      hintText: 'Type a question…',
                      hintStyle: TextStyle(color: context.greyLColor),
                      filled: true,
                      fillColor: context.surfColor,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 18, vertical: 12),
                    ),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                const SizedBox(width: 10),
                GestureDetector(
                  onTap: _loading ? null : _send,
                  child: Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      gradient: AppGradients.primaryButton,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.send_rounded,
                        color: Colors.white, size: 20),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _bubble(BuildContext context, _Msg m) {
    final isAi = m.isAi;
    return Align(
      alignment: isAi ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.78,
        ),
        decoration: BoxDecoration(
          gradient: isAi
              ? LinearGradient(
                  colors: [
                    context.accentColor.withOpacity(0.15),
                    context.accentColor.withOpacity(0.08),
                  ],
                )
              : null,
          color: isAi ? null : context.cardColor,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: isAi
                ? context.accentColor.withOpacity(0.25)
                : context.borderColor,
          ),
        ),
        child: Text(
          m.text,
          style: TextStyle(
            color: context.textColor,
            fontSize: 14,
            height: 1.45,
          ),
        ),
      ),
    );
  }
}

class _Msg {
  final bool isAi;
  final String text;
  const _Msg({required this.isAi, required this.text});
}
