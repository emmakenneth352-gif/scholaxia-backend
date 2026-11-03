import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../api/api_service.dart';
import '../../../theme/app_theme.dart';
import '../../../widgets/student_ui.dart';
import 'cbt_exam_screen.dart';

/// Internal (school) exams set by teachers. Students can download an exam for
/// offline use, take it offline, then submit — the score is shown to the
/// student and routed to the teacher(s) who teach that subject.
class InternalExamsScreen extends StatefulWidget {
  const InternalExamsScreen({super.key});

  @override
  State<InternalExamsScreen> createState() => _InternalExamsScreenState();
}

class _InternalExamsScreenState extends State<InternalExamsScreen> {
  final _api = ApiService();
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _exams = [];
  final Set<String> _downloaded = {};
  final Set<String> _busy = {};

  static const _cachePrefix = 'internal_exam_pack_';

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
      final prefs = await SharedPreferences.getInstance();
      final rows = await _api.internalExamsForMe();
      final exams = rows
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final downloaded = <String>{};
      for (final e in exams) {
        final id = e['id']?.toString() ?? '';
        if (id.isEmpty) continue;
        // A granted retake invalidates the cached paper exactly once, so the
        // next download brings a freshly randomized order. The marker stops a
        // newly downloaded pack from being wiped on the next refresh.
        final marker = 'internal_retake_cleared_$id';
        if (e['retake_granted'] == true) {
          if (!prefs.containsKey(marker)) {
            await prefs.remove('$_cachePrefix$id');
            await prefs.setBool(marker, true);
          }
        } else {
          await prefs.remove(marker);
        }
        if (prefs.containsKey('$_cachePrefix$id')) {
          downloaded.add(id);
        }
      }
      if (!mounted) return;
      setState(() {
        _exams = exams;
        _downloaded
          ..clear()
          ..addAll(downloaded);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _download(Map<String, dynamic> exam) async {
    final id = exam['id']?.toString() ?? '';
    if (id.isEmpty) return;
    setState(() => _busy.add(id));
    try {
      final pack = await _api.cbtDownloadExamRaw(id);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('$_cachePrefix$id', jsonEncode(pack));
      if (!mounted) return;
      setState(() {
        _downloaded.add(id);
        _busy.remove(id);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Downloaded. You can now take it offline.')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy.remove(id));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Download failed: $e'),
            backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _take(Map<String, dynamic> exam) async {
    final id = exam['id']?.toString() ?? '';
    if (id.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getString('$_cachePrefix$id');
    Map<String, dynamic>? pack;
    if (cached != null) {
      try {
        pack = Map<String, dynamic>.from(jsonDecode(cached) as Map);
      } catch (_) {}
    }
    // No cache yet — try downloading on the fly (needs connection).
    if (pack == null) {
      setState(() => _busy.add(id));
      try {
        pack = await _api.cbtDownloadExamRaw(id);
        await prefs.setString('$_cachePrefix$id', jsonEncode(pack));
      } catch (e) {
        if (!mounted) return;
        setState(() => _busy.remove(id));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Download this exam first while online.'),
              backgroundColor: Colors.red),
        );
        return;
      }
      if (mounted) setState(() => _busy.remove(id));
    }

    final rawQuestions = (pack['questions'] as List?) ?? const [];
    final questions = rawQuestions
        .whereType<Map>()
        .map((q) => CbtQuestion.fromJson(Map<String, dynamic>.from(q)))
        .toList();
    if (questions.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('This exam has no questions yet.')),
      );
      return;
    }

    final durationMinutes =
        (pack['duration_minutes'] as num?)?.toInt() ?? 60;
    final title = pack['title']?.toString() ??
        exam['title']?.toString() ??
        'Internal Exam';

    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CbtExamScreen(
          subject: title,
          totalQuestions: questions.length,
          durationSeconds: durationMinutes * 60,
          questions: questions,
          internalExamId: id,
        ),
      ),
    );
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: [
                  const StudentBackButton(),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Internal Exams',
                          style: TextStyle(
                            color: context.textColor,
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          'Download, take offline, submit for grading.',
                          style: TextStyle(
                              color: context.greyColor, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: _loading ? null : _load,
                    icon: Icon(Icons.refresh_rounded, color: context.accentColor),
                  ),
                ],
              ),
            ),
            Expanded(child: _body(context)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.wifi_off_rounded, color: context.greyColor, size: 40),
              const SizedBox(height: 12),
              Text(
                'Could not load exams.\nDownloaded exams can still be taken from here.',
                textAlign: TextAlign.center,
                style: TextStyle(color: context.greyColor),
              ),
              const SizedBox(height: 12),
              ElevatedButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (_exams.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.assignment_outlined,
                  color: context.greyColor, size: 44),
              const SizedBox(height: 12),
              Text(
                'No internal exams yet.\nYour teachers will set them here.',
                textAlign: TextAlign.center,
                style: TextStyle(color: context.greyColor),
              ),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
        itemCount: _exams.length,
        itemBuilder: (_, i) => _examCard(context, _exams[i]),
      ),
    );
  }

  Widget _examCard(BuildContext context, Map<String, dynamic> exam) {
    final id = exam['id']?.toString() ?? '';
    final title = exam['title']?.toString() ?? 'Exam';
    final subject = exam['subject']?.toString() ?? '';
    final totalQ = (exam['total_questions'] as num?)?.toInt() ?? 0;
    final durMins = (exam['duration_minutes'] as num?)?.toInt() ?? 0;
    final taken = exam['already_taken'] == true;
    final downloaded = _downloaded.contains(id);
    final busy = _busy.contains(id);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: context.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: context.accentColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.assignment_rounded,
                    color: context.accentColor),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: TextStyle(
                            color: context.textColor,
                            fontSize: 15,
                            fontWeight: FontWeight.w800)),
                    const SizedBox(height: 2),
                    Text(
                      [
                        if ((exam['teacher_name']?.toString() ?? '').isNotEmpty)
                          'Teacher: ${exam['teacher_name']}',
                        if (subject.isNotEmpty) subject,
                      ].join(' · '),
                      style: TextStyle(
                          color: context.greyColor, fontSize: 12),
                    ),
                    if ((exam['notes_url']?.toString() ?? '').isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        exam['notes_title']?.toString().isNotEmpty == true
                            ? 'Notes: ${exam['notes_title']}'
                            : 'Notes attached',
                        style: TextStyle(
                            color: context.accentColor, fontSize: 11),
                      ),
                    ],
                  ],
                ),
              ),
              if (taken)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.green.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text('Submitted',
                      style: TextStyle(
                          color: Colors.green,
                          fontSize: 11,
                          fontWeight: FontWeight.w700)),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Icon(Icons.help_outline_rounded,
                  size: 14, color: context.greyColor),
              const SizedBox(width: 4),
              Text('$totalQ questions',
                  style: TextStyle(color: context.greyColor, fontSize: 12)),
              const SizedBox(width: 14),
              Icon(Icons.schedule_rounded, size: 14, color: context.greyColor),
              const SizedBox(width: 4),
              Text('$durMins min',
                  style: TextStyle(color: context.greyColor, fontSize: 12)),
              if (downloaded) ...[
                const SizedBox(width: 14),
                Icon(Icons.offline_pin_rounded,
                    size: 14, color: context.accentColor),
                const SizedBox(width: 4),
                Text('Offline ready',
                    style:
                        TextStyle(color: context.accentColor, fontSize: 12)),
              ],
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              if (!downloaded)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: busy ? null : () => _download(exam),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: context.accentColor,
                      side: BorderSide(color: context.accentColor),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    icon: busy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.download_rounded, size: 18),
                    label: Text(busy ? 'Downloading…' : 'Download'),
                  ),
                ),
              if (!downloaded) const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: taken || busy ? null : () => _take(exam),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: context.accentColor,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    disabledBackgroundColor: context.borderColor,
                  ),
                  icon: const Icon(Icons.play_arrow_rounded, size: 18),
                  label: Text(taken ? 'Done' : 'Take exam'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
