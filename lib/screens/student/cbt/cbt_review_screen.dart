import 'package:flutter/material.dart';
import '../../../api/api_service.dart';
import '../../../services/cbt_offline_store.dart';
import '../../../theme/app_theme.dart';

/// Answer review for both exam types:
/// - Internal/board exams (CBT sessions): GET /cbt/sessions/{id}/review
///   → questions: [{question_text, option_a..d, correct_option, student_answer, ...}]
/// - Practice attempts (JAMB/WAEC/NECO boards): GET /cbt/practice/attempts/{id}/review
///   → full_review: [{question_text, options: [{key, text}], correct_key, your_answer, ...}]
/// Falls back to the locally cached practice review when the server is unreachable.
class CbtReviewScreen extends StatefulWidget {
  final String sessionId;
  final String? attemptId;
  const CbtReviewScreen({super.key, required this.sessionId, this.attemptId});

  @override
  State<CbtReviewScreen> createState() => _CbtReviewScreenState();
}

class _ReviewItem {
  final String question;
  final List<String> options;
  final String correctAnswer; // option text
  final String studentAnswer; // option text ('' = skipped)
  final String explanation;

  const _ReviewItem({
    required this.question,
    required this.options,
    required this.correctAnswer,
    required this.studentAnswer,
    this.explanation = '',
  });

  bool get isCorrect =>
      studentAnswer.isNotEmpty && studentAnswer == correctAnswer;
}

class _CbtReviewScreenState extends State<CbtReviewScreen> {
  final _api = ApiService();
  List<_ReviewItem> _items = [];
  bool _loading = true;
  String? _error;

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
    // Practice attempts first (their ids are not CBT session ids).
    if ((widget.attemptId ?? '').isNotEmpty) {
      try {
        final res = await _api.cbtPracticeReview(widget.attemptId!);
        final items = _parsePractice(res);
        if (mounted) {
          setState(() {
            _items = items;
            _loading = false;
          });
        }
        await CbtOfflineStore.instance
            .savePack('attempt:${widget.attemptId}:review', res);
        return;
      } catch (_) {
        // Offline? Try the locally cached review from submit time.
        final cached =
            await CbtOfflineStore.instance.loadPack('attempt:${widget.attemptId}:review');
        if (cached != null) {
          final items = _parsePractice(cached);
          if (items.isNotEmpty && mounted) {
            setState(() {
              _items = items;
              _loading = false;
            });
            return;
          }
        }
        if (mounted) {
          setState(() {
            _error =
                'Could not load the review. Check your internet and try again.';
            _loading = false;
          });
        }
        return;
      }
    }
    // Board exam session review.
    try {
      final data = await _api.cbtSessionReview(widget.sessionId);
      if (mounted) {
        setState(() {
          _items = _parseSession(data);
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  List<_ReviewItem> _parsePractice(Map<String, dynamic> res) {
    final raw = (res['full_review'] as List?) ?? (res['review'] as List?) ?? [];
    final items = <_ReviewItem>[];
    for (final q in raw.whereType<Map>()) {
      final optsRaw = (q['options'] as List?) ?? const [];
      final options = <String>[];
      String textOf(String key) {
        for (final o in optsRaw) {
          if (o is Map &&
              (o['key']?.toString().toUpperCase() ?? '') == key.toUpperCase()) {
            return o['text']?.toString() ?? '';
          }
        }
        return '';
      }

      if (optsRaw.isNotEmpty && optsRaw.first is Map) {
        for (final o in optsRaw) {
          if (o is Map) options.add(o['text']?.toString() ?? '');
        }
      } else {
        options.addAll(optsRaw.map((o) => o.toString()));
      }
      final correctKey = (q['correct_key']?.toString() ?? '').toUpperCase();
      final yourKey = (q['your_answer']?.toString() ?? '').toUpperCase();
      items.add(_ReviewItem(
        question: q['question_text']?.toString() ?? '',
        options: options,
        correctAnswer: textOf(correctKey),
        studentAnswer: yourKey.isEmpty ? '' : textOf(yourKey),
        explanation: (q['explanation']?.toString() ?? ''),
      ));
    }
    return items;
  }

  List<_ReviewItem> _parseSession(Map<String, dynamic> data) {
    final raw = (data['questions'] as List?) ?? const [];
    return raw.whereType<Map>().map((q) {
      final opts = [
        q['option_a']?.toString() ?? '',
        q['option_b']?.toString() ?? '',
        q['option_c']?.toString() ?? '',
        q['option_d']?.toString() ?? '',
      ].where((s) => s.isNotEmpty).toList();
      return _ReviewItem(
        question: q['question_text']?.toString() ?? '',
        options: opts,
        correctAnswer: q['correct_option']?.toString() ?? '',
        studentAnswer: q['student_answer']?.toString() ?? '',
        explanation: q['explanation']?.toString() ?? '',
      );
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        foregroundColor: AppColors.white,
        title: Text('Answer Review',
            style:
                TextStyle(color: context.textColor, fontWeight: FontWeight.bold)),
        centerTitle: false,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: context.borderColor),
        ),
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.yellow))
          : _error != null
              ? _buildError()
              : _buildContent(),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.error_outline, color: context.greyColor, size: 48),
          const SizedBox(height: 12),
          Text(_error ?? '',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.greyColor, fontSize: 13)),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: _load,
            style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.yellow,
                foregroundColor: Colors.black),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    if (_items.isEmpty) {
      return Center(
        child: Text('No review data available',
            style: TextStyle(color: context.greyColor)),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, i) {
        final item = _items[i];
        final isCorrect = item.isCorrect;
        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: isCorrect
                  ? const Color(0xFF4ADE80).withOpacity(0.4)
                  : const Color(0xFFFF6B6B).withOpacity(0.4),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: isCorrect
                          ? const Color(0xFF4ADE80).withOpacity(0.15)
                          : const Color(0xFFFF6B6B).withOpacity(0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      isCorrect ? Icons.check : Icons.close,
                      size: 16,
                      color: isCorrect
                          ? const Color(0xFF4ADE80)
                          : const Color(0xFFFF6B6B),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text('Q${i + 1}',
                      style: TextStyle(
                          color: context.greyLColor,
                          fontSize: 13,
                          fontWeight: FontWeight.w600)),
                  const Spacer(),
                  if (item.studentAnswer.isEmpty)
                    Text('Skipped',
                        style: TextStyle(
                            color: context.greyColor,
                            fontSize: 11,
                            fontStyle: FontStyle.italic)),
                ],
              ),
              const SizedBox(height: 10),
              Text(item.question,
                  style: TextStyle(
                      color: context.textColor, fontSize: 14, height: 1.5)),
              const SizedBox(height: 12),
              ...item.options.map((opt) {
                final isCorrectOpt = opt == item.correctAnswer;
                final isStudentOpt = opt == item.studentAnswer;
                Color optColor = AppColors.grey;
                Color bgColor = AppColors.surfaceLight;
                if (isCorrectOpt) {
                  optColor = const Color(0xFF4ADE80);
                  bgColor = const Color(0xFF4ADE80).withOpacity(0.1);
                } else if (isStudentOpt && !isCorrectOpt) {
                  optColor = const Color(0xFFFF6B6B);
                  bgColor = const Color(0xFFFF6B6B).withOpacity(0.1);
                }
                return Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 6),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: bgColor,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(opt,
                            style:
                                TextStyle(color: optColor, fontSize: 13)),
                      ),
                      if (isCorrectOpt)
                        const Icon(Icons.check_circle_outline,
                            color: Color(0xFF4ADE80), size: 16),
                      if (isStudentOpt && !isCorrectOpt)
                        const Icon(Icons.cancel_outlined,
                            color: Color(0xFFFF6B6B), size: 16),
                    ],
                  ),
                );
              }),
              if (item.explanation.isNotEmpty) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.yellow.withOpacity(0.06),
                    borderRadius: BorderRadius.circular(8),
                    border:
                        Border.all(color: AppColors.yellow.withOpacity(0.2)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.lightbulb_outline,
                          color: AppColors.yellow, size: 16),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(item.explanation,
                            style: TextStyle(
                                color: context.greyLColor,
                                fontSize: 13,
                                height: 1.5)),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
