import 'package:flutter/material.dart';
import '../../../api/api_service.dart';
import '../../../services/chat_persistence_service.dart';
import '../../../services/sia_voice_service.dart';
import 'sia_voice_teaching_screen.dart';
import '../../../theme/app_theme.dart';
import '../../../widgets/student_ui.dart';
import 'sia_voice_classroom_screen.dart';

class SiaScreen extends StatefulWidget {
  const SiaScreen({super.key});
  @override
  State<SiaScreen> createState() => _SiaScreenState();
}

class _SiaScreenState extends State<SiaScreen> {
  static const _chatChannel = 'student_sia';

  final _inputCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final _api = ApiService();
  String _subject = 'General';
  List<String> _subjects = ['General', 'Physics', 'Mathematics', 'Biology', 'Chemistry', 'English'];
  String? _educationLevel;
  String _studentName = 'there';
  bool _loading = false;
  bool _voiceOn = false; // read replies aloud only when the student taps 🔊
  List<_Msg> _messages = [];
  String _tutorMode = 'smart'; // smart, friendly, strict, exam_mode

  @override
  void initState() {
    super.initState();
    SiaVoiceService.instance.init();
    _bootstrap();
  }

  @override
  void dispose() {
    SiaVoiceService.instance.stop();
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _speakAi(String text) async {
    if (!_voiceOn || text.trim().isEmpty) return;
    await SiaVoiceService.instance.speak(text);
  }

  /// Full Voice Teaching Mode: AI teacher + board + voice checkpoints.
  void _openVoiceTeaching() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SiaVoiceTeachingScreen(
          studentName: _studentName,
          subjects: _subjects,
          initialSubject: _subject,
          educationLevel: _educationLevel,
        ),
      ),
    );
  }

  void _openVoiceClassroom() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SiaVoiceClassroomScreen(
          studentName: _studentName,
          subjects: _subjects,
          initialSubject: _subject,
          onAsk: (question, subject) async {
            final r = await _api.siaAsk(
              question: question,
              subject: subject,
              educationLevel: _educationLevel,
              conversationHistory: _buildHistory(),
              tutorMode: _tutorMode,
            );
            return SiaVoiceAskResult(board: r.board, speakText: r.sia);
          },
        ),
      ),
    );
  }

  void _showTutorModeSelector() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Choose Tutor Mode'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _TutorModeOption(
              label: 'Smart Mode',
              description: 'Structured, detailed explanations with step-by-step reasoning',
              mode: 'smart',
              currentMode: _tutorMode,
              onTap: () {
                setState(() => _tutorMode = 'smart');
                Navigator.pop(ctx);
              },
            ),
            const SizedBox(height: 8),
            _TutorModeOption(
              label: 'Friendly Mode',
              description: 'Conversational, encouraging, and patient explanations',
              mode: 'friendly',
              currentMode: _tutorMode,
              onTap: () {
                setState(() => _tutorMode = 'friendly');
                Navigator.pop(ctx);
              },
            ),
            const SizedBox(height: 8),
            _TutorModeOption(
              label: 'Strict Mode',
              description: 'Disciplined, exam-focused preparation with rigorous standards',
              mode: 'strict',
              currentMode: _tutorMode,
              onTap: () {
                setState(() => _tutorMode = 'strict');
                Navigator.pop(ctx);
              },
            ),
            const SizedBox(height: 8),
            _TutorModeOption(
              label: 'Exam Mode',
              description: 'WAEC/JAMB/NECO style answers with marking scheme focus',
              mode: 'exam_mode',
              currentMode: _tutorMode,
              onTap: () {
                setState(() => _tutorMode = 'exam_mode');
                Navigator.pop(ctx);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _bootstrap() async {
    final saved = await ChatPersistenceService.instance.load(_chatChannel);
    if (!mounted) return;
    if (saved.isNotEmpty) {
      setState(() {
        _messages = saved
            .map((m) => _Msg(isAi: m.isAi, text: m.text, time: m.time ?? ''))
            .toList();
      });
      _scrollToEnd();
    } else {
      setState(() {
        _messages = [_defaultWelcome()];
      });
    }
    await _loadProfile();
  }

  _Msg _defaultWelcome() => _Msg(
        isAi: true,
        text:
            "Hi $_studentName! I'm Sia, your AI tutor. I can help you with Mathematics, Physics, Chemistry, Biology, English, and more. Choose a tutor mode and ask me anything!",
        time: _now(),
      );

  Future<void> _persistChat() async {
    await ChatPersistenceService.instance.save(
      _chatChannel,
      _messages
          .map((m) => StoredChatMessage(isAi: m.isAi, text: m.text, time: m.time))
          .toList(),
    );
  }

  Future<void> _clearChat() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clear chat?'),
        content: const Text(
          'This will delete your Sia conversation on this device. This cannot be undone.',
        ),
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
    setState(() => _messages = [_defaultWelcome()]);
    await _persistChat();
    await _loadProfile();
  }

  final GlobalKey _lastMsgKey = GlobalKey();

  void _scrollToEnd() {
    // When a new AI reply lands, align its TOP with the top of the screen —
    // the student reads downwards naturally instead of being dropped at the
    // bottom of the reply and forced to scroll back up.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final ctx = _lastMsgKey.currentContext;
      if (ctx != null) {
        Scrollable.ensureVisible(
          ctx,
          alignment: 0.0, // top of the newest message at the top of the view
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      } else if (_scrollCtrl.hasClients) {
        _scrollCtrl.jumpTo(_scrollCtrl.position.maxScrollExtent);
      }
    });
  }

  Future<void> _loadProfile() async {
    try {
      final p = await _api.getStudentProfile();
      if (!mounted) return;
      final subjects = p.subjects.isNotEmpty ? p.subjects : _subjects;
      final level = p.educationLevel;
      final name = p.greetingName;
      setState(() {
        _studentName = name;
        _subjects = subjects;
        if (!subjects.contains(_subject)) {
          // Keep the neutral default unless the student picked a subject
          // themselves — never force their first subject as active.
          _subject = 'General';
        }
        _educationLevel = (level != null && level.isNotEmpty) ? level : null;
        final onlyWelcome = _messages.length == 1 &&
            _messages.first.isAi &&
            (_messages.first.text.contains("I'm Sia") ||
                _messages.first.text.startsWith('Hi '));
        if (onlyWelcome) {
          final subjText = subjects.take(3).join(', ');
          final levelText = _educationLevel != null ? ' ($_educationLevel)' : '';
          _messages[0] = _Msg(
            isAi: true,
            text: subjText.isEmpty
                ? "Hi $name! I'm Sia$levelText. Type a question or tap the mic for voice chat."
                : "Hi $name! I'm Sia$levelText. I know you study $subjText — type or use voice chat (mic icon).",
            time: _now(),
          );
        }
      });
    } catch (_) {}
  }

  Future<void> _send() async {
    final text = _inputCtrl.text.trim();
    if (text.isEmpty || _loading) return;
    final now = _now();
    setState(() {
      _messages.add(_Msg(isAi: false, text: text, time: now));
      _inputCtrl.clear();
      _loading = true;
    });
    await _persistChat();
    try {
      final history = _buildHistory();
      final r = await _api.siaAsk(
        question: text,
        subject: _subject,
        educationLevel: _educationLevel,
        conversationHistory: history,
        tutorMode: _isCasual(text) ? 'friendly' : _tutorMode,
      );
      if (mounted) {
        setState(() {
          _messages.add(_Msg(isAi: true, text: r.sia, time: _now()));
          _loading = false;
        });
        await _persistChat();
        _scrollToEnd();
        await _speakAi(r.sia);
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _messages.add(_Msg(isAi: true, text: 'Sorry, I ran into an issue: ${e.message}', time: _now()));
          _loading = false;
        });
        await _persistChat();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _messages.add(_Msg(
            isAi: true,
            text: e.toString().contains('TimeoutException')
                ? 'Sorry, that took too long. Please try again — tap the ⚡ chip to resend quickly.'
                : 'Something went wrong. Please check your connection and try again.',
            time: _now(),
          ));
          _loading = false;
        });
        await _persistChat();
      }
    }
  }

  /// Casual chat (hi, how are you…) should feel like a friendly tutor, not
  /// a structured lesson dump — DeepSeek handles the rest naturally.
  bool _isCasual(String text) {
    final t = text.trim().toLowerCase();
    if (t.length > 60) return false;
    final words = t.split(RegExp(r'\s+'));
    const casual = {
      'hi', 'hello', 'hey', 'good', 'morning', 'afternoon', 'evening',
      'hola', 'sup', 'yo', 'hiya', 'how', 'are', 'you', 'wassup', 'wasup',
      'sia', 'miss', 'sir', 'teacher', 'am', 'is', 'doing', 'fine',
    };
    return words.every((w) => casual.contains(w.replaceAll(RegExp(r'[^a-z ]'), '')));
  }

  /// Strip markdown symbols the chat bubble can't render (**bold**, #, `),
  /// so the student never sees raw asterisks in a reply.
  String _plainChat(String text) {
    var t = text;
    t = t.replaceAll(RegExp(r'```[\s\S]*?```'), ' (code block) ');
    // Dart's replaceAll does NOT expand "$1" (that's JavaScript) — use
    // replaceAllMapped or the literal "$1" shows up in the chat bubble.
    t = t.replaceAllMapped(RegExp(r'\*\*([^*]+)\*\*'), (m) => m.group(1)!);
    t = t.replaceAllMapped(RegExp(r'\*([^*\n]+)\*'), (m) => m.group(1)!);
    t = t.replaceAll(RegExp(r'^#{1,6}\s*', multiLine: true), '');
    t = t.replaceAll(RegExp(r'^[-*]\s+', multiLine: true), '• ');
    return t.trim();
  }

  String _now() {
    final n = DateTime.now();
    final h = n.hour % 12 == 0 ? 12 : n.hour % 12;
    final m = n.minute.toString().padLeft(2, '0');
    final ampm = n.hour < 12 ? 'AM' : 'PM';
    return '$h:$m $ampm';
  }

  List<Map<String, dynamic>> _buildHistory() {
    final history = <Map<String, dynamic>>[];
    for (final m in _messages) {
      if (m.isAi && m.text.contains("I'm Sia") && _messages.indexOf(m) == 0) continue;
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
      body: SafeArea(
        child: Column(children: [
          _buildHeader(context),
          Expanded(child: _buildMessages(context)),
          if (_loading) _buildThinking(context),
          _buildQuickChips(context),
          _buildInput(context),
        ]),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    final compactIcon = IconButton.styleFrom(
      padding: EdgeInsets.zero,
      minimumSize: const Size(36, 36),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        gradient: AppGradients.hero(context),
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF7C3AED).withOpacity(0.25),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(children: [
        const StudentBackButton(lightOnGradient: true),
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.2),
            borderRadius: BorderRadius.circular(11),
            border: Border.all(color: Colors.white.withOpacity(0.3)),
          ),
          child: const Icon(Icons.auto_awesome_rounded, color: Colors.white, size: 18),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Sia AI Tutor',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      height: 1.2)),
              Text('Text chat — tap mic for voice',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      color: Colors.white.withOpacity(0.85),
                      fontSize: 11,
                      height: 1.2)),
            ],
          ),
        ),
        IconButton(
          style: compactIcon,
          onPressed: _openVoiceTeaching,
          icon: Icon(Icons.mic_rounded, color: Colors.white.withOpacity(0.95), size: 22),
          tooltip: 'Voice Teaching Mode',
        ),
        IconButton(
          style: compactIcon,
          onPressed: _showTutorModeSelector,
          icon: Icon(Icons.psychology_rounded, color: Colors.white.withOpacity(0.9), size: 20),
          tooltip: 'Tutor mode: $_tutorMode',
        ),
        IconButton(
          style: compactIcon,
          onPressed: _messages.length <= 1 ? null : _clearChat,
          icon: Icon(Icons.delete_outline_rounded,
              color: Colors.white.withOpacity(0.9), size: 20),
          tooltip: 'Clear chat',
        ),
        IconButton(
          style: compactIcon,
          onPressed: () => setState(() => _voiceOn = !_voiceOn),
          icon: Icon(
            _voiceOn ? Icons.volume_up_rounded : Icons.volume_off_rounded,
            color: Colors.white.withOpacity(0.9),
            size: 20,
          ),
          tooltip: _voiceOn ? 'Read replies aloud' : 'Mute read-aloud',
        ),
      ]),
    );
  }

  Widget _buildMessages(BuildContext context) {
    // Oldest first, newest at the bottom — answers start at the top of the
    // reply and read downwards like normal chat apps.
    return ListView.builder(
      controller: _scrollCtrl,
      reverse: false,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      itemCount: _messages.length,
      itemBuilder: (_, i) {
        final m = _messages[i];
        final child = m.isAi ? _aiMsg(context, m) : _userMsg(context, m);
        // Tag the newest message so _scrollToEnd can align its top on screen.
        return i == _messages.length - 1
            ? KeyedSubtree(key: _lastMsgKey, child: child)
            : child;
      },
    );
  }

  Widget _aiMsg(BuildContext context, _Msg m) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              gradient: AppGradients.primaryButton,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.auto_awesome_rounded, color: Colors.white, size: 16)),
        const SizedBox(width: 8),
        Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('Sia AI Tutor',
                style: TextStyle(
                    color: context.textColor, fontSize: 12, fontWeight: FontWeight.bold)),
            const SizedBox(width: 4),
            Icon(Icons.bolt, color: context.accentColor, size: 12),
          ]),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: context.cardColor,
              borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(12),
                  bottomLeft: Radius.circular(12),
                  bottomRight: Radius.circular(12)),
              border: Border.all(color: context.borderColor),
            ),
            child: Text(_plainChat(m.text),
                style: TextStyle(color: context.textColor, fontSize: 14, height: 1.5)),
          ),
          const SizedBox(height: 4),
          Row(children: [
            Text(m.time, style: TextStyle(color: context.greyColor, fontSize: 10)),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: () => _speakAi(m.text),
              child: Icon(Icons.volume_up_rounded, size: 14, color: context.accentColor),
            ),
          ]),
        ])),
        const SizedBox(width: 40),
      ]),
    );
  }

  Widget _userMsg(BuildContext context, _Msg m) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16, left: 40),
      child: Align(
        alignment: Alignment.centerRight,
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              gradient: AppGradients.primaryButton,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(16),
                topRight: Radius.circular(16),
                bottomLeft: Radius.circular(16),
              ),
            ),
            child: Text(m.text,
                style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.5)),
          ),
          const SizedBox(height: 4),
          Text(m.time, style: TextStyle(color: context.greyColor, fontSize: 10)),
        ]),
      ),
    );
  }

  Widget _buildThinking(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Row(children: [
        const SizedBox(width: 38),
        Text('••• Sia is thinking...',
            style: TextStyle(color: context.greyColor, fontSize: 12)),
      ]),
    );
  }

  Widget _buildQuickChips(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Row(children: [
        _chip(context, '⚡ Explain simply', () { _inputCtrl.text = 'Explain this simply'; }),
        const SizedBox(width: 8),
        _chip(context, '🧑‍🏫 Voice Teaching Mode', _openVoiceTeaching),
        const SizedBox(width: 8),
        _chip(context, '🎤 Voice chat', _openVoiceClassroom),
      ]),
    );
  }

  Widget _chip(BuildContext context, String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: context.surfColor,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: context.borderColor),
        ),
        child: Text(label, style: TextStyle(color: context.textColor, fontSize: 13)),
      ),
    );
  }

  Widget _buildInput(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      decoration: BoxDecoration(
        color: context.headerColor,
        border: Border(top: BorderSide(color: context.borderColor)),
      ),
      child: Row(children: [
        Expanded(
          child: Container(
            decoration: BoxDecoration(
                color: context.surfColor,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: context.borderColor)),
            child: TextField(
              controller: _inputCtrl,
              style: TextStyle(color: context.textColor, fontSize: 14),
              decoration: InputDecoration(
                hintText: 'Type your question…',
                hintStyle: TextStyle(color: context.greyColor),
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              ),
              onSubmitted: (_) => _send(),
            ),
          ),
        ),
        const SizedBox(width: 8),
        GestureDetector(
          onTap: _loading ? null : _send,
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: _loading 
                  ? context.accentColor.withOpacity(0.5) 
                  : context.accentColor,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Icon(Icons.send_rounded,
                color: context.isDark ? AppColors.background : Colors.white, size: 18),
          ),
        ),
      ]),
    );
  }
}

class _TutorModeOption extends StatelessWidget {
  final String label;
  final String description;
  final String mode;
  final String currentMode;
  final VoidCallback onTap;

  const _TutorModeOption({
    required this.label,
    required this.description,
    required this.mode,
    required this.currentMode,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isSelected = mode == currentMode;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected 
              ? context.accentColor.withOpacity(0.1)
              : context.surfColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? context.accentColor : context.borderColor,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              isSelected ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
              color: isSelected ? context.accentColor : context.greyColor,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      color: context.textColor,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: TextStyle(
                      color: context.greyColor,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Msg {
  final bool isAi;
  final String text, time;
  const _Msg({required this.isAi, required this.text, required this.time});
}
