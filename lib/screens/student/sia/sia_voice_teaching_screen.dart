import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../api/api_service.dart';
import '../../../services/sia_voice_input_service.dart';
import '../../../services/sia_voice_service.dart';
import '../../../theme/app_theme.dart';

/// One teaching step returned by /sia/teach-step.
class TeachStep {
  final String voice;
  final List<String> board;
  final int? highlight; // 1-based board line to point at
  final bool wait; // checkpoint: wait for the student's voice answer
  final String teacher; // point | write | think | encourage

  const TeachStep({
    required this.voice,
    required this.board,
    this.highlight,
    this.wait = false,
    this.teacher = 'write',
  });

  factory TeachStep.fromJson(Map<String, dynamic> j) => TeachStep(
        voice: (j['voice'] ?? '').toString(),
        board: ((j['board'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
        highlight: j['highlight'] is int ? j['highlight'] as int : null,
        wait: j['wait'] == true,
        teacher: (j['teacher'] ?? 'write').toString(),
      );
}

/// Scholaxia Voice Teaching Mode — the AI is a real teacher:
/// it SPEAKS the explanation while WRITING the important work on the board,
/// pauses to check the student's understanding, and listens for the answer.
class SiaVoiceTeachingScreen extends StatefulWidget {
  final String studentName;
  final List<String> subjects;
  final String initialSubject;
  final String? educationLevel;

  const SiaVoiceTeachingScreen({
    super.key,
    required this.studentName,
    required this.subjects,
    required this.initialSubject,
    this.educationLevel,
  });

  @override
  State<SiaVoiceTeachingScreen> createState() => _SiaVoiceTeachingScreenState();
}

class _TeacherPose {
  final double lean; // radians
  final double lift; // px
  const _TeacherPose(this.lean, this.lift);
}

class _SiaVoiceTeachingScreenState extends State<SiaVoiceTeachingScreen>
    with TickerProviderStateMixin {
  final _api = ApiService();
  final _voiceInput = SiaVoiceInputService.instance;
  final _boardCtrl = ScrollController();
  final _typedCtrl = TextEditingController();

  late String _subject;

  // Lesson state
  final List<TeachStep> _lesson = []; // steps already taught
  final List<String> _boardLines = []; // everything written so far
  String _request = ''; // the student's original ask ("teach me limits")
  bool _awaitingReply = false; // teacher asked "are you following?"
  bool _done = false;

  // Playback state
  bool _speaking = false;
  bool _thinking = false;
  bool _listening = false;
  String _heard = '';
  // What Sia is saying RIGHT NOW — shown live under the board while the
  // voice plays, so the student can read along.
  String _caption = '';
  String _statusLine = 'Ask me anything — I will teach it step by step.';

  // Animations
  late final AnimationController _breathe = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  )..repeat(reverse: true);
  late final AnimationController _point = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );
  late final AnimationController _write = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 700),
  );

  bool get _micOk => SiaVoiceInputService.isMicSupported;

  @override
  void initState() {
    super.initState();
    _subject = widget.initialSubject.isNotEmpty ? widget.initialSubject : 'General';
    SiaVoiceService.instance.onSpeakingChanged = (speaking) {
      if (mounted) setState(() => _speaking = speaking);
    };
  }

  @override
  void dispose() {
    SiaVoiceService.instance.onSpeakingChanged = null;
    SiaVoiceService.instance.stop();
    SiaVoiceInputService.instance.stop();
    _breathe.dispose();
    _point.dispose();
    _write.dispose();
    _boardCtrl.dispose();
    _typedCtrl.dispose();
    super.dispose();
  }

  // ── Lesson flow ──────────────────────────────────────────────────────────

  Future<void> _startLesson(String question) async {
    if (_thinking || _speaking) return;
    _request = question;
    _lesson.clear();
    _boardLines.clear();
    _done = false;
    await _fetchSteps(question, studentReply: null);
  }

  Future<void> _answerCheckpoint(String reply) async {
    if (_thinking || _speaking) return;
    _awaitingReply = false;
    await _fetchSteps(_request, studentReply: reply);
  }

  Future<void> _fetchSteps(String question, {String? studentReply}) async {
    setState(() {
      _thinking = true;
      _statusLine = studentReply == null ? 'Preparing the lesson…' : 'Thinking…';
    });
    Map<String, dynamic> res;
    try {
      res = await _api.siaTeachStep(
        question: question,
        subject: _subject,
        educationLevel: widget.educationLevel,
        studentReply: studentReply,
        lessonHistory: _lesson
            .map((s) => {
                  'voice': s.voice,
                  'board': s.board,
                  'wait': s.wait,
                })
            .toList(),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _thinking = false;
        _statusLine = 'Could not reach Sia — check your connection and try again.';
      });
      return;
    }
    if (!mounted) return;

    final steps = ((res['steps'] as List?) ?? const [])
        .whereType<Map>()
        .map((m) => TeachStep.fromJson(Map<String, dynamic>.from(m)))
        .toList();
    final done = res['done'] == true;
    setState(() {
      _thinking = false;
      _done = done;
    });
    if (steps.isEmpty) {
      setState(() => _statusLine = 'Tap the mic and ask again.');
      return;
    }
    await _playSteps(steps);
  }

  /// Speak each step while its board lines appear one by one (teacher writing).
  Future<void> _playSteps(List<TeachStep> steps) async {
    for (final step in steps) {
      if (!mounted) return;
      if (step.teacher == 'point') {
        _point.forward(from: 0);
      } else {
        _write.forward(from: 0);
      }

      // Board lines appear progressively, like a teacher writing on a board.
      for (var i = 0; i < step.board.length; i++) {
        if (!mounted) return;
        setState(() {
          _boardLines.add(step.board[i]);
          _statusLine = step.wait ? 'Waiting for your answer…' : 'Teaching…';
        });
        _write.forward(from: 0.2);
        await Future.delayed(const Duration(milliseconds: 420));
        _scrollBoardToBottom();
      }

      // Speak this step's explanation while the board settles. The caption
      // shows exactly what is being said, following the voice.
      if (step.voice.isNotEmpty) {
        setState(() {
          _speaking = true;
          _caption = step.voice;
        });
        await SiaVoiceService.instance.speak(step.voice);
        if (!mounted) return;
        setState(() {
          _speaking = false;
          _caption = '';
        });
      }

      _lesson.add(step);

      if (step.wait) {
        setState(() {
          _awaitingReply = true;
          _statusLine = 'Your turn — answer out loud or tap a reply.';
        });
        if (_micOk) await _listen(autoSubmit: true);
        return; // stop until the student answers
      }
    }

    if (_done) {
      setState(() => _statusLine = 'Lesson complete — ask me another topic!');
    } else {
      setState(() => _statusLine = 'Tap the mic to continue or ask a question.');
    }
  }

  void _scrollBoardToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_boardCtrl.hasClients) {
        _boardCtrl.animateTo(
          _boardCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOut,
        );
      }
    });
  }

  // ── Voice input ──────────────────────────────────────────────────────────

  Future<void> _listen({bool autoSubmit = false}) async {
    if (!_micOk || _listening || _thinking || _speaking) return;
    try {
      await SiaVoiceService.instance.stop();
      final ready = await _voiceInput.ensureReady(context);
      if (!ready || !mounted) {
        setState(() => _statusLine = 'Type your question below instead.');
        return;
      }
      setState(() {
        _listening = true;
        _heard = '';
        _statusLine = 'Listening…';
      });
      // Checkpoint answers: submit as soon as the student finishes speaking
      // (final result), with a fallback timer if no final result fires.
      var submitted = false;
      Future<void> finishUp() async {
        if (submitted || !mounted || !_listening) return;
        submitted = true;
        await _stopAndHandle();
      }
      await _voiceInput.startListening(
        onPartial: (words) {
          if (!mounted) return;
          setState(() => _heard = words);
        },
        onFinal: autoSubmit ? (_) => finishUp() : null,
      );
      if (!autoSubmit) return;
      // Server-STT (Windows) has no live "final result" — give it a longer
      // window since transcription happens after release anyway.
      Future.delayed(
        Duration(seconds: SiaVoiceInputService.serverStt ? 15 : 7),
        finishUp,
      );
    } catch (_) {
      if (mounted) setState(() => _listening = false);
    }
  }

  Future<void> _stopAndHandle() async {
    if (!_listening) return;
    try {
      final text = await _voiceInput.stopAndCapture();
      if (!mounted) return;
      setState(() => _listening = false);
      final heard = text.trim();
      if (heard.isEmpty) {
        setState(() => _statusLine =
            "I didn't catch that — tap the mic again or type below.");
        return;
      }
      if (_awaitingReply) {
        await _answerCheckpoint(heard);
      } else {
        await _startLesson(heard);
      }
    } catch (_) {
      if (mounted) setState(() => _listening = false);
    }
  }

  void _submitTyped() {
    final t = _typedCtrl.text.trim();
    if (t.isEmpty || _thinking || _speaking) return;
    _typedCtrl.clear();
    if (_awaitingReply) {
      _answerCheckpoint(t);
    } else {
      _startLesson(t);
    }
  }

  void _quickReply(String reply) {
    if (_awaitingReply) _answerCheckpoint(reply);
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final accent = context.accentColor;
    return Scaffold(
      backgroundColor: context.bgColor,
      body: SafeArea(
        child: Column(
          children: [
            _header(context, accent),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                child: LayoutBuilder(
                  builder: (ctx, cons) {
                    // One classroom: the teacher stays in a SMALL corner of
                    // the board so the written work is always readable.
                    return Column(children: [
                      Expanded(
                        child: _board(
                          context,
                          accent,
                          teacher: _teacherOverlay(
                            height: math.min(cons.maxHeight * 0.2, 92.0),
                          ),
                        ),
                      ),
                      if (_caption.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        _speechCaption(context, accent),
                      ],
                    ]);
                  },
                ),
              ),
            ),
            _statusBar(context, accent),
            _controls(context, accent),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context, Color accent) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: BoxDecoration(
        gradient: AppGradients.hero(context),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(children: [
        IconButton(
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
        ),
        const Expanded(
          child: Text(
            'Voice Teaching Mode',
            style: TextStyle(
                color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16),
          ),
        ),
        PopupMenuButton<String>(
          icon: const Icon(Icons.school_rounded, color: Colors.white),
          tooltip: 'Subject',
          onSelected: (s) => setState(() => _subject = s),
          itemBuilder: (_) => (widget.subjects.isNotEmpty ? widget.subjects : ['General'])
              .map((s) => PopupMenuItem(
                  value: s,
                  child: Text(s,
                      style: TextStyle(
                          color: s == _subject ? accent : null,
                          fontWeight: s == _subject ? FontWeight.w700 : null))))
              .toList(),
        ),
      ]),
    );
  }

  /// The teacher image, tucked into a small bottom-right corner of the board
  /// so it never covers the written work.
  Widget _teacherOverlay({double height = 220}) {
    final pose = _currentPose();
    return AnimatedBuilder(
      animation: Listenable.merge([_breathe, _point, _write]),
      builder: (ctx, _) {
        final lean = pose.lean + math.sin(_breathe.value * math.pi) * 0.02;
        final lift = pose.lift + math.sin(_breathe.value * math.pi * 2) * 2;
        return SizedBox(
          height: height,
          child: Stack(
            alignment: Alignment.bottomCenter,
            fit: StackFit.loose,
            clipBehavior: Clip.hardEdge,
            children: [
              Transform.translate(
                offset: Offset(0, lift),
                child: Transform.rotate(
                  angle: lean,
                  child: Image.asset(
                    'asset/images/sia_teacher.png',
                    height: height,
                    fit: BoxFit.contain,
                    alignment: Alignment.bottomCenter,
                    errorBuilder: (_, __, ___) => _teacherFallback(),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _teacherFallback() {
    return Container(
      decoration: BoxDecoration(
        gradient: AppGradients.primaryButton,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(_awaitingReply
                  ? Icons.hearing_rounded
                  : _speaking
                      ? Icons.campaign_rounded
                      : Icons.menu_book_rounded,
              color: Colors.white, size: 34),
          const SizedBox(height: 6),
          Text(
            _awaitingReply
                ? 'Waiting for you…'
                : _speaking
                    ? 'Teaching…'
                    : 'Ready to teach',
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
        ]),
      ),
    );
  }

  _TeacherPose _currentPose() {
    if (_thinking) return const _TeacherPose(-0.04, -4); // thinking tilt
    if (_awaitingReply) return const _TeacherPose(0.0, 0); // waiting, natural
    if (_speaking) return const _TeacherPose(0.05, -2); // pointing at the board
    return const _TeacherPose(0.0, 0);
  }

  Widget _board(BuildContext context, Color accent, {Widget? teacher}) {
    final hlIndex = _currentHighlight();
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A), // blackboard
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: accent.withOpacity(0.4), width: 2),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Board header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: accent.withOpacity(0.12),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
          ),
          child: Row(children: [
            Icon(Icons.edit_rounded, size: 14, color: accent),
            const SizedBox(width: 6),
            Text('$_subject · Board',
                style: TextStyle(
                    color: Colors.white.withOpacity(0.85),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.6)),
          ]),
        ),
        Expanded(
          child: _boardLines.isEmpty
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.draw_rounded,
                        size: 34, color: Colors.white.withOpacity(0.25)),
                    const SizedBox(height: 8),
                    Text(
                      'The board fills in as I teach.\nAsk me a topic below.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color: Colors.white.withOpacity(0.4), fontSize: 13, height: 1.5),
                    ),
                  ]),
                )
              : ListView.builder(
                  controller: _boardCtrl,
                  padding: const EdgeInsets.all(14),
                  itemCount: _boardLines.length,
                  itemBuilder: (_, i) {
                    final isHl = hlIndex != null && hlIndex - 1 == i;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 350),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: isHl ? accent.withOpacity(0.22) : Colors.transparent,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: isHl ? accent : Colors.transparent,
                            width: 1,
                          ),
                        ),
                        child: Row(children: [
                          Text('${i + 1}.',
                              style: TextStyle(
                                  color: Colors.white.withOpacity(0.35), fontSize: 11)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _boardLines[i],
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 15,
                                height: 1.45,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ),
                        ]),
                      ),
                    );
                  },
                ),
        ),
          ]),
          // The teacher stands in front of the board, bottom-right corner.
          if (teacher != null)
            Positioned(right: 0, bottom: 0, child: teacher),
        ]),
      ),
    );
  }

  int? _currentHighlight() {
    for (final s in _lesson.reversed) {
      if (s.highlight != null) return s.highlight;
    }
    return null;
  }

  /// Live "Sia is saying" bubble under the board — reads along with the voice.
  Widget _speechCaption(BuildContext context, Color accent) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: accent.withOpacity(0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: accent.withOpacity(0.45)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.graphic_eq_rounded, color: accent, size: 18),
        const SizedBox(width: 10),
        Expanded(
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 300),
            child: Text(
              _caption,
              key: ValueKey(_caption),
              style: TextStyle(
                  color: context.textColor, fontSize: 13.5, height: 1.45),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _statusBar(BuildContext context, Color accent) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Row(children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _listening
                ? Colors.redAccent
                : _thinking
                    ? Colors.orangeAccent
                    : _speaking
                        ? accent
                        : Colors.green,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            _listening
                ? (_heard.isEmpty ? 'Listening… speak now' : _heard)
                : _statusLine,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: context.textColor, fontSize: 13),
          ),
        ),
      ]),
    );
  }

  Widget _controls(BuildContext context, Color accent) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      decoration: BoxDecoration(
        color: context.headerColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        border: Border(top: BorderSide(color: context.borderColor)),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (_awaitingReply)
          // Checkpoint quick replies (voice works too)
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              for (final r in const ['Yes', 'I understand', 'No', 'Explain again'])
                OutlinedButton(
                  onPressed: _thinking || _speaking ? null : () => _quickReply(r),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: accent,
                    side: BorderSide(color: accent.withOpacity(0.5)),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  ),
                  child: Text(r, style: const TextStyle(fontSize: 13)),
                ),
            ],
          ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: context.surfColor,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: context.borderColor),
              ),
              child: TextField(
                controller: _typedCtrl,
                style: TextStyle(color: context.textColor, fontSize: 14),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _submitTyped(),
                decoration: InputDecoration(
                  hintText: _awaitingReply
                      ? 'Answer the teacher…'
                      : 'e.g. Teach me limits',
                  hintStyle: TextStyle(color: context.greyColor, fontSize: 13),
                  border: InputBorder.none,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          // Big mic button
          GestureDetector(
            onTapDown: (_) => _listen(),
            onTapUp: (_) => _stopAndHandle(),
            onLongPressStart: (_) => _listen(),
            onLongPressEnd: (_) => _stopAndHandle(),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppGradients.primaryButton,
                boxShadow: _listening
                    ? [BoxShadow(color: accent.withOpacity(0.5), blurRadius: 16)]
                    : [],
              ),
              child: Icon(
                _listening ? Icons.mic_rounded : Icons.mic_none_rounded,
                color: Colors.white,
                size: 24,
              ),
            ),
          ),
          const SizedBox(width: 10),
          // Send typed question
          GestureDetector(
            onTap: _submitTyped,
            child: Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppGradients.primaryButton,
              ),
              child: _thinking
                  ? const Padding(
                      padding: EdgeInsets.all(14),
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.send_rounded, color: Colors.white, size: 22),
            ),
          ),
        ]),
      ]),
    );
  }
}
