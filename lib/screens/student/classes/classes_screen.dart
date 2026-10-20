import 'package:flutter/material.dart';
import '../../../api/api_service.dart';
import '../../../services/live_class_ring_service.dart';
import '../../../theme/app_theme.dart';
import '../../../widgets/student_ui.dart';
import '../../../utils/live_join_helper.dart';
import '../../kind/kind_booking_screen.dart';
import 'class_packages_screen.dart';
import 'live_class_screen.dart';

class ClassesScreen extends StatefulWidget {
  const ClassesScreen({super.key});
  @override
  State<ClassesScreen> createState() => _ClassesScreenState();
}

class _ClassesScreenState extends State<ClassesScreen> {
  final _api = ApiService();
  String _tab = 'Schedule';

  List<Map<String, dynamic>> _live = [];
  List<Map<String, dynamic>> _upcoming = [];
  List<Map<String, dynamic>> _past = [];
  bool _loading = true;
  String? _joiningId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final results = await Future.wait([
        _safeCall(_api.listLiveClasses(status: 'live')),
        _safeCall(_api.listLiveClasses(status: 'upcoming')),
        _safeCall(_api.listLiveClasses(status: 'past')),
      ]);
      if (mounted) {
        setState(() {
          _live = _dedupe(_toMaps(results[0]));
          _upcoming = _dedupe(_toMaps(results[1]));
          _past = _dedupe(_toMaps(results[2]));
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<T?> _safeCall<T>(Future<T> call) async {
    try {
      return await call.timeout(const Duration(seconds: 15));
    } catch (_) {
      return null;
    }
  }

  List<Map<String, dynamic>> _toMaps(List<dynamic>? raw) {
    if (raw == null) return [];
    return raw
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  List<Map<String, dynamic>> _dedupe(List<Map<String, dynamic>> items) {
    final seen = <String>{};
    final out = <Map<String, dynamic>>[];
    for (final item in items) {
      final id = _field(item, ['id', 'class_id', 'uuid']);
      final key = id.isNotEmpty ? id : item.toString();
      if (seen.add(key)) out.add(item);
    }
    return out;
  }

  String _field(Map<String, dynamic> m, List<String> keys, [String fallback = '']) {
    for (final k in keys) {
      final v = m[k];
      if (v != null && v.toString().trim().isNotEmpty) return v.toString().trim();
    }
    return fallback;
  }

  String _formatTime(Map<String, dynamic> item) {
    final iso = _field(item, ['start_time', 'scheduled_at', 'preferred_time']);
    if (iso.isEmpty) return '';
    try {
      final dt = DateTime.parse(iso).toLocal();
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day);
      final day = DateTime(dt.year, dt.month, dt.day);
      final hour = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
      final min = dt.minute.toString().padLeft(2, '0');
      final ampm = dt.hour >= 12 ? 'PM' : 'AM';
      final time = '$hour:$min $ampm';
      if (day == today) return 'Today, $time';
      if (day == today.add(const Duration(days: 1))) return 'Tomorrow, $time';
      return '${dt.day}/${dt.month}/${dt.year}, $time';
    } catch (_) {
      return iso;
    }
  }

  String _viewerCount(Map<String, dynamic> item) {
    final raw = item['viewer_count'] ?? item['participants'] ?? item['students_count'];
    if (raw == null) return '0';
    if (raw is num) {
      if (raw >= 1000) return '${(raw / 1000).toStringAsFixed(1)}k';
      return raw.toInt().toString();
    }
    return raw.toString();
  }

  Future<void> _joinClass(Map<String, dynamic> session) async {
    final classId = _field(session, ['id', 'class_id', 'uuid']);
    setState(() => _joiningId = classId.isNotEmpty ? classId : 'join');
    try {
      // If we already have a class ID, join it directly — no code entry needed.
      if (classId.isNotEmpty) {
        LiveClassRingService.instance.stop();
        final userId = await _api.getUserId() ?? 'student';
        // join-by-id: join the class and get a LiveKit token
        final data = await _api.joinLiveClassById(classId);
        if (!mounted) return;
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => LiveClassScreen(
              classId: classId,
              subject: data['subject']?.toString() ??
                  session['subject']?.toString() ?? 'General',
              topic: data['title']?.toString() ??
                  session['title']?.toString() ?? 'Live Class',
              userId: userId,
              roomId: data['room_id']?.toString() ??
                  data['channel_id']?.toString(),
              livekitToken: data['livekit_token']?.toString() ??
                  data['token']?.toString(),
              livekitUrl: data['livekit_url']?.toString(),
            ),
          ),
        );
      } else {
        // No id — fall back to code entry dialog
        await joinLiveWithAccessCode(context, _api);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      final msg = e.message.toLowerCase();
      final needsSub = e.statusCode == 402 ||
          msg.contains('plan') || msg.contains('subscription');
      if (needsSub) {
        final go = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Subscription required'),
            content: Text(e.message.isNotEmpty
                ? e.message
                : 'Choose a live class plan before joining.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Open Subscription'),
              ),
            ],
          ),
        );
        if (go == true && mounted) {
          await Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const ClassPackagesScreen()),
          );
        }
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not join class: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _joiningId = null);
    }
  }

  Map<String, dynamic>? get _ongoing {
    return _live.isNotEmpty ? _live.first : null;
  }

  List<Map<String, dynamic>> get _listItems {
    return _tab == 'Schedule' ? _upcoming : _past;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: RefreshIndicator(
                color: context.accentColor,
                onRefresh: _load,
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _header(context),
                      const SizedBox(height: 8),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                        child: ElevatedButton.icon(
                          onPressed: () => joinLiveWithAccessCode(context, _api),
                          icon: const Icon(Icons.qr_code_scanner, size: 18),
                          label: const Text('Join with class code'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: context.accentColor,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            minimumSize: const Size.fromHeight(44),
                          ),
                        ),
                      ),
                      if (_loading)
                        Padding(
                          padding: const EdgeInsets.all(32),
                          child: Center(
                            child: CircularProgressIndicator(
                                color: context.accentColor),
                          ),
                        )
                      else ...[
                        if (_ongoing != null) _ongoingSession(context, _ongoing!),
                        _tabsRow(context),
                        if (_listItems.isEmpty)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                            child: Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: context.cardColor,
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: context.borderColor),
                              ),
                              child: Text(
                                _tab == 'Schedule'
                                    ? 'No upcoming classes scheduled yet.'
                                    : 'No past sessions to show.',
                                style: TextStyle(
                                    color: context.greyColor, fontSize: 13),
                              ),
                            ),
                          )
                        else
                          _classList(context),
                        _countdown(context),
                      ],
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
              ),
            ),
            _subscribeBar(context),
          ],
        ),
      ),
    );
  }

  Widget _subscribeBar(BuildContext ctx) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      decoration: BoxDecoration(
        color: ctx.headerColor,
        border: Border(top: BorderSide(color: ctx.borderColor)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ElevatedButton.icon(
            onPressed: () => Navigator.push(
              ctx,
              MaterialPageRoute(
                builder: (_) =>
                    const ClassPackagesScreen(holidayOnly: true),
              ),
            ),
            icon: const Icon(Icons.school_rounded, size: 20),
            label: const Text(
              'Live Class Plans',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF16A34A),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Special Single Class ₦5,000 · JAMB Prep ₦10,000 · JAMB + WAEC/NECO ₦15,000',
            textAlign: TextAlign.center,
            style: TextStyle(color: ctx.greyColor, fontSize: 11),
          ),
          const SizedBox(height: 8),
          ElevatedButton.icon(
            onPressed: () => Navigator.push(
              ctx,
              MaterialPageRoute(
                builder: (_) => const KindBookingScreen(kidsOnly: false),
              ),
            ),
            icon: const Icon(Icons.card_membership_rounded, size: 20),
            label: const Text(
              'Book & pay — Pay-Per-Class Plan',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: ctx.accentColor,
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(vertical: 14),
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _header(BuildContext ctx) {
    return Container(
      color: ctx.headerColor,
      padding: const EdgeInsets.fromLTRB(20, 16, 16, 16),
      child: Row(
        children: [
          const StudentBackButton(),
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: ctx.accentColor,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.bolt, color: ctx.isDark ? AppColors.background : Colors.white, size: 20),
          ),
          const SizedBox(width: 10),
          Text('Live Classes',
              style: TextStyle(color: ctx.textColor, fontSize: 17, fontWeight: FontWeight.bold)),
          const Spacer(),
          Icon(Icons.more_vert, color: ctx.textColor),
        ],
      ),
    );
  }

  Widget _ongoingSession(BuildContext ctx, Map<String, dynamic> session) {
    final title = _field(session, ['title', 'topic', 'name'], 'Live Class');
    final series = _field(session, ['series', 'description', 'subtitle', 'exam_type'], 'Live Session');
    final teacher = _field(session, ['teacher_name', 'teacher', 'instructor', 'host'], 'Instructor');
    final role = _field(session, ['teacher_title', 'instructor_title', 'department'], 'Lead Instructor');
    final classId = _field(session, ['id', 'class_id']);
    final joining = _joiningId == classId;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.circle, color: Colors.red, size: 10),
              const SizedBox(width: 6),
              Text('Ongoing Session',
                  style: TextStyle(
                      color: ctx.textColor, fontSize: 14, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            decoration: BoxDecoration(
              color: ctx.cardColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: ctx.borderColor),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(ctx.isDark ? 0.25 : 0.06),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Stack(
                  children: [
                    Container(
                      height: 160,
                      width: double.infinity,
                      decoration: BoxDecoration(
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: ctx.isDark
                              ? [const Color(0xFF1F2937), const Color(0xFF111827)]
                              : [const Color(0xFF374151), const Color(0xFF1F2937)],
                        ),
                      ),
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.play_circle_outline,
                                color: Colors.white.withOpacity(0.9), size: 48),
                            const SizedBox(height: 8),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16),
                              child: Text(
                                title,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      top: 10,
                      left: 10,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.red,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.circle, color: Colors.white, size: 6),
                            SizedBox(width: 4),
                            Text('LIVE',
                                style: TextStyle(
                                    color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      top: 10,
                      right: 10,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.black54,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.people_outline, color: Colors.white, size: 12),
                            const SizedBox(width: 4),
                            Text(_viewerCount(session),
                                style: const TextStyle(color: Colors.white, fontSize: 11)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: TextStyle(
                              color: ctx.textColor, fontSize: 15, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text(series,
                          style: TextStyle(color: ctx.accentColor, fontSize: 12)),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Stack(
                            clipBehavior: Clip.none,
                            children: [
                              CircleAvatar(
                                radius: 16,
                                backgroundColor: ctx.surfColor,
                                child: Icon(Icons.person, color: ctx.greyColor, size: 18),
                              ),
                              Positioned(
                                right: -1,
                                bottom: -1,
                                child: Container(
                                  width: 10,
                                  height: 10,
                                  decoration: BoxDecoration(
                                    color: ctx.accentColor,
                                    shape: BoxShape.circle,
                                    border: Border.all(color: ctx.cardColor, width: 1.5),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(teacher,
                                    style: TextStyle(
                                        color: ctx.textColor,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600)),
                                Text(role,
                                    style: TextStyle(color: ctx.greyColor, fontSize: 11),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis),
                              ],
                            ),
                          ),
                          ElevatedButton(
                            onPressed: joining ? null : () => _joinClass(session),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: ctx.accentColor,
                              foregroundColor: ctx.isDark ? AppColors.background : Colors.white,
                              disabledBackgroundColor: ctx.accentColor.withOpacity(0.5),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(20)),
                              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                              elevation: 0,
                            ),
                            child: joining
                                ? SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: ctx.isDark ? AppColors.background : Colors.white,
                                    ),
                                  )
                                : const Text('Join Live',
                                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _tabsRow(BuildContext ctx) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
      child: Row(
        children: [
          ...['Schedule', 'Past Sessions'].map((label) {
            final sel = _tab == label;
            return GestureDetector(
              onTap: () => setState(() => _tab = label),
              child: Container(
                margin: const EdgeInsets.only(right: 16),
                padding: const EdgeInsets.only(bottom: 6),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: sel ? ctx.accentColor : Colors.transparent,
                      width: 2,
                    ),
                  ),
                ),
                child: Text(
                  label,
                  style: TextStyle(
                    color: sel ? ctx.accentColor : ctx.greyColor,
                    fontSize: 14,
                    fontWeight: sel ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
              ),
            );
          }),
          const Spacer(),
          Text('View All →',
              style: TextStyle(
                  color: ctx.accentColor, fontSize: 13, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _classList(BuildContext ctx) {
    return Column(
      children: _listItems.map((c) {
        final subject = _field(c, ['subject', 'category'], 'Class');
        final title = _field(c, ['title', 'topic', 'name'], 'Upcoming Class');
        final teacher = _field(c, ['teacher_name', 'teacher', 'instructor'], 'Instructor');
        final time = _formatTime(c);

        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: ctx.cardColor,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: ctx.borderColor),
            ),
            child: Row(
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    CircleAvatar(
                      radius: 22,
                      backgroundColor: ctx.surfColor,
                      child: Icon(Icons.person, color: ctx.greyColor, size: 20),
                    ),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: ctx.accentColor,
                          shape: BoxShape.circle,
                          border: Border.all(color: ctx.cardColor, width: 1.5),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: ctx.accentColor.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(subject,
                                style: TextStyle(
                                    color: ctx.accentColor,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold)),
                          ),
                          if (time.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            Icon(Icons.access_time, size: 12, color: ctx.greyColor),
                            const SizedBox(width: 3),
                            Flexible(
                              child: Text(time,
                                  style: TextStyle(color: ctx.greyColor, fontSize: 11),
                                  overflow: TextOverflow.ellipsis),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(title,
                          style: TextStyle(
                              color: ctx.textColor, fontSize: 13, fontWeight: FontWeight.w600),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                      Text(teacher,
                          style: TextStyle(color: ctx.greyColor, fontSize: 11),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    ],
                  ),
                ),
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    border: Border.all(color: ctx.accentColor.withOpacity(0.4)),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(Icons.calendar_today_outlined, color: ctx.accentColor, size: 18),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _countdown(BuildContext ctx) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: ctx.accentColor.withOpacity(0.08),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: ctx.accentColor.withOpacity(0.2)),
        ),
        child: Row(
          children: [
            Icon(Icons.calendar_today_outlined, color: ctx.accentColor, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Exam Countdown',
                      style: TextStyle(
                          color: ctx.textColor, fontSize: 14, fontWeight: FontWeight.bold)),
                  Text(
                    'The next major JAMB simulation starts in 4 days. Keep practicing!',
                    style: TextStyle(color: ctx.greyColor, fontSize: 12, height: 1.4),
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
