import 'package:flutter/material.dart';
import '../../../api/api_service.dart';
import '../../../theme/app_theme.dart';
import 'cbt_review_screen.dart';

class CbtResultScreen extends StatefulWidget {
  final String sessionId;
  // Board practice attempt id — enables the Answer Review for practice runs.
  final String? attemptId;
  // Optionally pass a pre-loaded result to skip the API call
  final CbtResult? result;

  const CbtResultScreen({
    super.key,
    required this.sessionId,
    this.attemptId,
    this.result,
  });

  @override
  State<CbtResultScreen> createState() => _CbtResultScreenState();
}

class _CbtResultScreenState extends State<CbtResultScreen> {
  final _api = ApiService();
  CbtResult? _result;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.result != null) {
      _result = widget.result;
      _loading = false;
    } else {
      _loadResult();
    }
  }

  Future<void> _loadResult() async {
    final sid = widget.sessionId.trim();
    if (sid.isEmpty) {
      if (mounted) {
        setState(() {
          _error =
              'No online session was created (you may be offline). Your score was calculated on this device.';
          _loading = false;
        });
      }
      return;
    }
    try {
      final r = await _api.cbtSessionResult(sid);
      if (mounted) setState(() { _result = r; _loading = false; });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error =
              'Could not reach the server. Check your internet and try again.';
          _loading = false;
        });
      }
    }
  }

  Color get _scoreColor {
    final p = _result?.percentage ?? 0;
    if (p >= 70) return const Color(0xFF4ADE80);
    if (p >= 50) return AppColors.yellow;
    return const Color(0xFFFF6B6B);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        foregroundColor: AppColors.white,
        title: Text('Your Result',
            style: TextStyle(color: context.textColor, fontWeight: FontWeight.bold)),
        centerTitle: false,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: context.borderColor),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.yellow))
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
          SizedBox(height: 12),
          Text(_error ?? '', textAlign: TextAlign.center,
              style: TextStyle(color: context.greyColor, fontSize: 13)),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: () { setState(() { _loading = true; _error = null; }); _loadResult(); },
            style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.yellow, foregroundColor: Colors.black),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    final r = _result!;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          const SizedBox(height: 16),
          // Score ring
          Container(
            width: 140,
            height: 140,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _scoreColor.withOpacity(0.1),
              border: Border.all(color: _scoreColor, width: 4),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  '${r.percentage.toStringAsFixed(1)}%',
                  style: TextStyle(
                      color: _scoreColor,
                      fontSize: 32,
                      fontWeight: FontWeight.bold),
                ),
                Text(
                  'Score',
                  style: TextStyle(color: context.greyColor, fontSize: 13),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text(
            r.rating ??
                (r.percentage >= 70
                    ? 'Great job!'
                    : r.percentage >= 50
                        ? 'Keep practicing!'
                        : 'Need more practice'),
            style: TextStyle(
                color: context.textColor, fontSize: 22, fontWeight: FontWeight.bold),
          ),
          if ((r.ratingMessage ?? '').isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              r.ratingMessage!,
              textAlign: TextAlign.center,
              style: TextStyle(color: context.greyColor, fontSize: 13, height: 1.4),
            ),
          ],
          if ((r.scoreDisplay ?? '').isNotEmpty) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
              decoration: BoxDecoration(
                color: _scoreColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _scoreColor.withOpacity(0.4)),
              ),
              child: Text(
                r.scoreDisplay!,
                style: TextStyle(
                    color: _scoreColor,
                    fontSize: 18,
                    fontWeight: FontWeight.w800),
              ),
            ),
          ],
          const SizedBox(height: 24),
          // Stats row
          Row(
            children: [
              Expanded(child: _StatCard(label: 'Correct', value: '${r.totalCorrect}',
                  color: const Color(0xFF4ADE80))),
              const SizedBox(width: 12),
              Expanded(child: _StatCard(label: 'Wrong', value: '${r.totalWrong}',
                  color: const Color(0xFFFF6B6B))),
              const SizedBox(width: 12),
              Expanded(child: _StatCard(label: 'Total Score', value: '${r.score}',
                  color: AppColors.yellow)),
            ],
          ),
          if (r.perSubjectScores.isNotEmpty) ...[
            const SizedBox(height: 24),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Theme.of(context).cardColor,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: context.borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Score by subject',
                      style: TextStyle(
                          color: context.textColor,
                          fontSize: 15,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  ...r.perSubjectScores.entries.map(
                    (e) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(e.key,
                                style: TextStyle(
                                    color: context.textColor, fontSize: 13)),
                          ),
                          Text(
                            e.value % 1 == 0
                                ? e.value.toInt().toString()
                                : e.value.toStringAsFixed(1),
                            style: TextStyle(
                                color: e.value >= 70
                                    ? const Color(0xFF4ADE80)
                                    : e.value >= 50
                                        ? AppColors.yellow
                                        : const Color(0xFFFF6B6B),
                                fontWeight: FontWeight.w800,
                                fontSize: 14),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (r.weakTopics.isNotEmpty) ...[
            const SizedBox(height: 24),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Theme.of(context).cardColor,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: context.borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Topics to Improve',
                      style: TextStyle(
                          color: context.textColor,
                          fontSize: 15,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: r.weakTopics.map((t) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFF6B6B).withOpacity(0.1),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFFF6B6B).withOpacity(0.4)),
                      ),
                      child: Text(t,
                          style: const TextStyle(
                              color: Color(0xFFFF6B6B), fontSize: 13)),
                    )).toList(),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 28),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) => CbtReviewScreen(
                      sessionId: widget.sessionId,
                      attemptId: widget.attemptId,
                    )),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.yellow,
                foregroundColor: Colors.black,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Review Answers',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: OutlinedButton(
              onPressed: () => Navigator.pop(context),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.white,
                side: const BorderSide(color: Color(0xFF3A3A3A)),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Back to CBT'),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatCard({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.borderColor),
      ),
      child: Column(
        children: [
          Text(value,
              style: TextStyle(
                  color: color, fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(label,
              style: TextStyle(color: context.greyColor, fontSize: 12)),
        ],
      ),
    );
  }
}
