import 'package:flutter/material.dart';
import '../../api/api_service.dart';
import '../../theme/app_theme.dart';
import '../student/cbt/cbt_exam_screen.dart';
import '../student/cbt/cbt_packages_screen.dart';

/// Primary 6 Common Entrance CBT for the Kids app.
/// Exams are created/published from the admin panel (exam type COMMON_ENTRANCE).
class KindCbtScreen extends StatefulWidget {
  const KindCbtScreen({super.key});

  @override
  State<KindCbtScreen> createState() => _KindCbtScreenState();
}

class _KindCbtScreenState extends State<KindCbtScreen> {
  final _api = ApiService();
  bool _loading = true;
  List<dynamic> _exams = [];
  String? _startingExamId;
  String? _error;
  bool _hasPaidAccess = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.cbtExams(examType: 'COMMON_ENTRANCE');
      Map<String, dynamic> access = const {};
      try {
        access = await _api.cbtPackageAccess();
      } catch (_) {}
      final boards = ((access['boards'] as List?) ?? const [])
          .map((e) => e.toString().toUpperCase())
          .toSet();
      if (!mounted) return;
      setState(() {
        _exams = data;
        _hasPaidAccess = boards.contains('COMMON_ENTRANCE');
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _exams = [];
        _loading = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load Common Entrance exams.';
      });
    }
  }

  /// Show "English Language / Verbal Reasoning", never "COMMON_ENTRANCE …Question Bank".
  String _cleanTitle(String raw) {
    var t = raw.trim();
    final lower = t.toLowerCase();
    if (lower.startsWith('common_entrance')) {
      t = t.substring('common_entrance'.length);
    } else if (lower.startsWith('common entrance')) {
      t = t.substring('common entrance'.length);
    }
    // Case-insensitive strip of any "Question Bank" suffix (any case).
    t = t.replaceAll(RegExp(r'_?question[_ ]bank', caseSensitive: false), ' ');
    t = t.replaceAll('_', ' ').trim();
    return t.isEmpty ? 'Practice' : t;
  }

  Future<void> _startExam(Map<String, dynamic> exam) async {
    if (!_hasPaidAccess) {
      final unlocked = await showCbtUnlockChoice(context, kidsOnly: true);
      if (!mounted) return;
      if (unlocked) await _load();
      if (!_hasPaidAccess) return;
    }
    final examId = exam['id']?.toString() ?? '';
    final title = _cleanTitle(
      exam['title']?.toString() ?? exam['subject']?.toString() ?? 'Practice',
    );
    if (examId.isEmpty || _startingExamId != null) return;
    setState(() => _startingExamId = examId);
    try {
      final session = await _api.cbtStartSession(examId);
      final questions = await _api.cbtDownloadExam(examId);
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => CbtExamScreen(
            subject: title,
            totalQuestions: questions.isNotEmpty
                ? questions.length
                : session.totalQuestions,
            durationSeconds: session.durationMinutes * 60,
            sessionId: session.sessionId,
            questions: questions,
          ),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 402 ||
          e.message.toLowerCase().contains('package') ||
          e.message.toLowerCase().contains('required')) {
        await _openPackage();
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: Colors.red),
      );
    } finally {
      if (mounted) setState(() => _startingExamId = null);
    }
  }

  Widget _kidsPayBanner(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.accentColor.withOpacity(0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Browse exams below — pay to start',
            style: TextStyle(
              color: context.textColor,
              fontWeight: FontWeight.w800,
              fontSize: 15,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Common Entrance CBT is ₦2,000 / year. Tap an exam or Pay with Paystack to unlock.',
            style: TextStyle(color: context.greyColor, height: 1.4, fontSize: 13),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _openPackage,
            child: const Text('Pay with Paystack'),
          ),
        ],
      ),
    );
  }

  Future<void> _openPackage() async {
    final paid = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => const CbtPackagesScreen(kidsOnly: true),
      ),
    );
    if (paid == true && mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 16, 0),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => Navigator.of(context).maybePop(),
                    child: Container(
                      width: 40,
                      height: 40,
                      alignment: Alignment.center,
                      child: Icon(
                        Icons.arrow_back_rounded,
                        color: context.textColor,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      'Common Entrance CBT',
                      style: TextStyle(
                        color: context.textColor,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Annual package',
                    onPressed: _openPackage,
                    icon: Icon(
                      Icons.workspace_premium_rounded,
                      color: context.accentColor,
                    ),
                  ),
                  IconButton(
                    onPressed: _loading ? null : _load,
                    icon: Icon(
                      Icons.refresh_rounded,
                      color: context.accentColor,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Text(
                'Primary 6 practice exams — added by admin. Take each subject to prepare for Common Entrance.',
                style: TextStyle(
                  color: context.greyColor,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ),
            Expanded(
              child: _loading
                  ? Center(
                      child: CircularProgressIndicator(
                        color: context.accentColor,
                      ),
                    )
                  : RefreshIndicator(
                      color: context.accentColor,
                      onRefresh: _load,
                      child: _exams.isEmpty
                          ? ListView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              children: [
                                if (!_hasPaidAccess) ...[
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                      20,
                                      8,
                                      20,
                                      16,
                                    ),
                                    child: _kidsPayBanner(context),
                                  ),
                                ],
                                const SizedBox(height: 80),
                                Icon(
                                  Icons.assignment_outlined,
                                  size: 48,
                                  color: context.greyColor,
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  _error ?? 'No Common Entrance exams yet',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: context.textColor,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Ask admin to add exams with type COMMON_ENTRANCE.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: context.greyColor,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
                              itemCount:
                                  _exams.length + (!_hasPaidAccess ? 1 : 0),
                              itemBuilder: (context, i) {
                                if (!_hasPaidAccess && i == 0) {
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 14),
                                    child: _kidsPayBanner(context),
                                  );
                                }
                                final examIndex =
                                    !_hasPaidAccess ? i - 1 : i;
                                final exam = Map<String, dynamic>.from(
                                  _exams[examIndex] as Map,
                                );
                                final id = exam['id']?.toString() ?? '';
                                final title = _cleanTitle(
                                  exam['title']?.toString() ??
                                      exam['subject']?.toString() ??
                                      'Exam',
                                );
                                final starting = _startingExamId == id;
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 14),
                                  child: Material(
                                    color: context.isDark
                                        ? const Color(0xFF1A1428)
                                        : Colors.white,
                                    borderRadius: BorderRadius.circular(18),
                                    child: InkWell(
                                      borderRadius: BorderRadius.circular(18),
                                      onTap: starting
                                          ? null
                                          : () => _startExam(exam),
                                      child: Container(
                                        padding: const EdgeInsets.all(16),
                                        decoration: BoxDecoration(
                                          borderRadius: BorderRadius.circular(
                                            18,
                                          ),
                                          border: Border.all(
                                            color: context.accentColor
                                                .withOpacity(0.18),
                                          ),
                                        ),
                                        child: Row(
                                          children: [
                                            Container(
                                              width: 48,
                                              height: 48,
                                              decoration: BoxDecoration(
                                                gradient: const LinearGradient(
                                                  colors: [
                                                    Color(0xFF0EA5E9),
                                                    Color(0xFF6366F1),
                                                  ],
                                                ),
                                                borderRadius:
                                                    BorderRadius.circular(14),
                                              ),
                                              child: starting
                                                  ? const Padding(
                                                      padding: EdgeInsets.all(
                                                        12,
                                                      ),
                                                      child:
                                                          CircularProgressIndicator(
                                                            strokeWidth: 2,
                                                            color: Colors.white,
                                                          ),
                                                    )
                                                  : const Icon(
                                                      Icons.quiz_rounded,
                                                      color: Colors.white,
                                                    ),
                                            ),
                                            const SizedBox(width: 14),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.start,
                                                children: [                                                Text(
                                                  title,
                                                  style: TextStyle(
                                                    color: context.textColor,
                                                    fontWeight:
                                                        FontWeight.w800,
                                                    fontSize: 15,
                                                  ),
                                                ),
                                                ],
                                              ),
                                            ),
                                            Icon(
                                              Icons.play_circle_fill_rounded,
                                              color: context.accentColor,
                                              size: 28,
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
