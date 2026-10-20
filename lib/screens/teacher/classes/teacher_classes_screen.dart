import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../api/api_service.dart';
import '../../../theme/app_theme.dart';
import '../../student/classes/live_class_screen.dart';
import '../teacher_shared.dart';

class TeacherClassesScreen extends StatefulWidget {
  final int hostClassNonce;

  const TeacherClassesScreen({super.key, this.hostClassNonce = 0});

  @override
  State<TeacherClassesScreen> createState() => _TeacherClassesScreenState();
}

class _TeacherClassesScreenState extends State<TeacherClassesScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _api = ApiService();
  bool _loading = true;
  String? _teacherName;
  int _unread = 0;
  List<Map<String, dynamic>> _live = [];
  List<Map<String, dynamic>> _upcoming = [];
  List<Map<String, dynamic>> _past = [];
  List<Map<String, dynamic>> _students = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _load();
  }

  @override
  void didUpdateWidget(covariant TeacherClassesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.hostClassNonce != oldWidget.hostClassNonce &&
        widget.hostClassNonce > 0) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showCreateClassSheet(goLiveNow: true);
      });
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        _api.getTeacherMe(),
        _api.unreadNotificationCount(),
        _api.listLiveClasses(status: 'live'),
        _api.listLiveClasses(status: 'upcoming'),
        _api.listLiveClasses(status: 'past'),
      ]);
      var students = await _api.listLiveSessionRequests(status: 'approved');
      if (students.isEmpty) {
        students = await _api.listLiveSessionRequests();
      }
      if (!mounted) return;
      setState(() {
        _teacherName = (results[0] as Map)['full_name']?.toString();
        _unread = results[1] as int;
        _live = _toMaps(results[2] as List);
        _upcoming = _toMaps(results[3] as List);
        _past = _toMaps(results[4] as List);
        _students = _toMaps(students);
        _loading = false;
      });
      teacherUnreadCount.value = results[1] as int;
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> _toMaps(List raw) {
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  void _showCreateClassSheet({String? subject, String? title, bool goLiveNow = false}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.headerColor,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _CreateClassSheet(
        api: _api,
        onCreated: _load,
        initialSubject: subject,
        initialTitle: title,
        initialGoLiveNow: goLiveNow,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final accent = context.accentColor;
    return Scaffold(
      backgroundColor: context.bgColor,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: TeacherTopBar(
                api: _api,
                teacherName: _teacherName,
                unreadCount: _unread,
              ),
            ),
            const SizedBox(height: 20),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('My Classes',
                            style: TextStyle(
                                color: context.textColor,
                                fontSize: 22,
                                fontWeight: FontWeight.bold)),
                        const SizedBox(height: 4),
                        Text('Manage your live classes and sessions.',
                            style: TextStyle(
                                color: context.greyColor, fontSize: 13)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton.icon(
                    onPressed: () => _showCreateClassSheet(goLiveNow: true),
                    icon: const Icon(Icons.videocam_rounded, size: 18),
                    label: const Text('Host class',
                        style: TextStyle(fontWeight: FontWeight.bold)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: accent,
                      foregroundColor: Colors.black,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 12),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 20),
              decoration: BoxDecoration(
                color: context.surfColor,
                borderRadius: BorderRadius.circular(12),
              ),
              child: TabBar(
                controller: _tabController,
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                indicator: BoxDecoration(
                  color: accent,
                  borderRadius: BorderRadius.circular(10),
                ),
                indicatorSize: TabBarIndicatorSize.tab,
                labelColor: Colors.black,
                unselectedLabelColor: context.greyColor,
                dividerColor: Colors.transparent,
                tabs: [
                  Tab(text: 'Live (${_live.length})'),
                  Tab(text: 'Upcoming (${_upcoming.length})'),
                  Tab(text: 'Past (${_past.length})'),
                  Tab(text: 'Students (${_students.length})'),
                ],
              ),
            ),
            const SizedBox(height: 4),
            Expanded(
              child: _loading
                  ? Center(
                      child: CircularProgressIndicator(color: accent))
                  : RefreshIndicator(
                      color: accent,
                      onRefresh: _load,
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          _classList(_live, empty: 'No live classes right now.'),
                          _classList(_upcoming, empty: 'No upcoming classes.'),
                          _classList(_past, empty: 'No past classes yet.'),
                          _studentsList(),
                        ],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _classList(List<Map<String, dynamic>> classes, {required String empty}) {
    if (classes.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
        children: [
          const SizedBox(height: 40),
          Icon(Icons.videocam_outlined, color: context.greyColor, size: 48),
          const SizedBox(height: 12),
          Text(empty,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: context.textColor, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text(
            'Tap Host class above to go live instantly.',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.greyColor, fontSize: 13),
          ),
          const SizedBox(height: 20),
          Center(
            child: OutlinedButton.icon(
              onPressed: () => _showCreateClassSheet(goLiveNow: true),
              icon: Icon(Icons.videocam_rounded, color: context.accentColor),
              label: Text('Host a class now',
                  style: TextStyle(color: context.accentColor)),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: context.accentColor),
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
            ),
          ),
        ],
      );
    }
    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
      itemCount: classes.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, i) => _ClassCard(data: classes[i], api: _api, onChanged: _load),
    );
  }

  Widget _studentsList() {
    if (_students.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
        children: [
          const SizedBox(height: 40),
          Icon(Icons.people_outline, color: context.greyColor, size: 48),
          const SizedBox(height: 12),
          Text(
            'No students assigned yet',
            textAlign: TextAlign.center,
            style: TextStyle(
                color: context.textColor,
                fontSize: 16,
                fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            'When admin assigns a student to you, they appear here so you can host a live class for them.',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.greyColor, fontSize: 13, height: 1.4),
          ),
        ],
      );
    }
    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
      itemCount: _students.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, i) {
        final s = _students[i];
        final name = s['student_name']?.toString() ?? 'Student';
        final subject = s['subject']?.toString() ?? 'Subject';
        final topic = s['topic']?.toString() ??
            s['message']?.toString() ??
            'Live session';
        final status = s['status']?.toString() ?? 'approved';
        final time = TeacherUtils.formatDateTime(
            s['preferred_time'] ?? s['created_at']);
        final color = TeacherUtils.subjectColor(subject, context);
        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: context.cardColor,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: context.borderColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: color.withOpacity(0.15),
                    child: Text(
                      name.isNotEmpty ? name[0].toUpperCase() : 'S',
                      style: TextStyle(
                          color: color, fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name,
                            style: TextStyle(
                                color: context.textColor,
                                fontSize: 15,
                                fontWeight: FontWeight.bold)),
                        Text(subject,
                            style: TextStyle(color: color, fontSize: 12)),
                      ],
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: context.accentColor.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      status,
                      style: TextStyle(
                          color: context.accentColor,
                          fontSize: 10,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(topic,
                  style: TextStyle(color: context.greyColor, fontSize: 12)),
              if (time.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(time,
                      style:
                          TextStyle(color: context.greyColor, fontSize: 11)),
                ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => _showCreateClassSheet(
                    subject: subject,
                    title: topic,
                    goLiveNow: true,
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: context.accentColor,
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    elevation: 0,
                  ),
                  child: const Text('Host class',
                      style:
                          TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ClassCard extends StatelessWidget {
  final Map<String, dynamic> data;
  final ApiService api;
  final VoidCallback? onChanged;
  const _ClassCard({required this.data, required this.api, this.onChanged});

  String get _id => data['id']?.toString() ?? '';
  String get _subject => data['subject']?.toString() ?? 'Subject';
  String get _title => data['title']?.toString() ?? _subject;
  bool get _isLive => data['is_live'] == true;

  Future<void> _startClass(BuildContext context) async {
    if (_id.isEmpty) return;
    try {
      await api.startLiveClass(_id);
      final tokenData = await api.getLiveClassToken(_id);
      final roomId = tokenData['room_id']?.toString() ??
          tokenData['channel_id']?.toString() ??
          data['room_id']?.toString() ??
          _id;
      final userId = await api.getUserId() ?? '';
      if (!context.mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => LiveClassScreen(
            subject: _subject,
            topic: _title,
            classId: _id,
            roomId: roomId,
            livekitToken: tokenData['livekit_token']?.toString() ??
                tokenData['token']?.toString(),
            livekitUrl: tokenData['livekit_url']?.toString(),
            userId: userId,
            isTeacher: true,
          ),
        ),
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _endClass(BuildContext context) async {
    if (_id.isEmpty) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.cardColor,
        title: Text('End class?', style: TextStyle(color: ctx.textColor)),
        content: Text(
          'This will stop the live session for all students.',
          style: TextStyle(color: ctx.greyColor),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('End Class', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await api.endLiveClass(_id);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Class ended.')),
      );
      onChanged?.call();
    } on ApiException catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: Colors.red),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = TeacherUtils.subjectColor(_subject, context);
    final time = TeacherUtils.formatDateTime(data['start_time']);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
            color: _isLive ? color.withOpacity(0.4) : context.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.school_outlined, color: color, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_title,
                        style: TextStyle(
                            color: context.textColor,
                            fontSize: 15,
                            fontWeight: FontWeight.bold)),
                    Text(_subject,
                        style: TextStyle(color: context.greyColor, fontSize: 12)),
                  ],
                ),
              ),
              if (_isLive)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.red.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text('LIVE',
                      style: TextStyle(
                          color: Colors.red,
                          fontSize: 10,
                          fontWeight: FontWeight.bold)),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Icon(Icons.schedule_outlined, color: context.greyColor, size: 13),
              const SizedBox(width: 4),
              Text(time,
                  style: TextStyle(color: context.greyColor, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 14),
          if (_isLive)
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => _startClass(context),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: color,
                      foregroundColor: Colors.black,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8)),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      elevation: 0,
                    ),
                    child: const Text('Go Live',
                        style: TextStyle(
                            fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _endClass(context),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red,
                      side: const BorderSide(color: Colors.red),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8)),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                    ),
                    child: const Text('End Class',
                        style: TextStyle(
                            fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => _startClass(context),
                style: ElevatedButton.styleFrom(
                  backgroundColor: color,
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8)),
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  elevation: 0,
                ),
                child: const Text('Start Class',
                    style:
                        TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
              ),
            ),
        ],
      ),
    );
  }
}

class _CreateClassSheet extends StatefulWidget {
  final ApiService api;
  final VoidCallback onCreated;
  final String? initialSubject;
  final String? initialTitle;
  final bool initialGoLiveNow;
  const _CreateClassSheet({
    required this.api,
    required this.onCreated,
    this.initialSubject,
    this.initialTitle,
    this.initialGoLiveNow = false,
  });

  @override
  State<_CreateClassSheet> createState() => _CreateClassSheetState();
}

class _CreateClassSheetState extends State<_CreateClassSheet> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _subjectCtrl;
  // Comma-separated emails for private classes — kids are invited by email.
  final TextEditingController _inviteEmailsCtrl = TextEditingController();
  DateTime _start = DateTime.now().add(const Duration(hours: 1));
  bool _loading = false;
  late bool _goLiveNow;

  // How long the class runs before it auto-ends, in minutes.
  int _durationMinutes = 60;
  static const List<int> _durationOptions = [30, 45, 60, 90, 120, 180];

  // 'public' = anyone in the subject, 'private' = access-code join,
  // 'school_group' = a saved group.
  String _visibility = 'public';
  List<Map<String, dynamic>> _groups = [];
  bool _loadingGroups = false;
  String? _groupId;

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController(text: widget.initialTitle ?? '');
    _subjectCtrl = TextEditingController(text: widget.initialSubject ?? '');
    _goLiveNow = widget.initialGoLiveNow;
  }

  Future<void> _loadGroups() async {
    if (_groups.isNotEmpty || _loadingGroups) return;
    setState(() => _loadingGroups = true);
    try {
      final rows = await widget.api.listSchoolGroups();
      final list = rows
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      if (mounted) setState(() => _groups = list);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingGroups = false);
    }
  }

  void _onVisibilityChanged(String v) {
    setState(() => _visibility = v);
    if (v == 'school_group') _loadGroups();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _subjectCtrl.dispose();
    _inviteEmailsCtrl.dispose();
    super.dispose();
  }



  /// Site-style share sheet: show the join code big, with copy + share.
  Future<void> _showClassCodeSheet(
    Map<String, dynamic> created,
    String code, {
    required bool live,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.cardColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        final accent = context.accentColor;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 20, 24, 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(
                        color: accent.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Icon(Icons.key_rounded, color: accent),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        live ? 'Class is live — share this code' : 'Class scheduled — share this code',
                        style: TextStyle(
                          color: context.textColor,
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Students open Join Live, paste this code, and they\'re in. It also lands in their Access Code tab automatically.',
                  style: TextStyle(color: context.greyColor, fontSize: 13, height: 1.4),
                ),
                const SizedBox(height: 18),
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 18),
                  decoration: BoxDecoration(
                    color: context.surfColor,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: accent.withOpacity(0.4), width: 1.5),
                  ),
                  child: Text(
                    code,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 3,
                      color: accent,
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => Clipboard.setData(ClipboardData(text: code)),
                        icon: const Icon(Icons.copy_rounded, size: 18),
                        label: const Text('Copy code'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () async {
                          final text = Uri.encodeComponent(
                            'Join my Scholaxia live class with this access code: $code',
                          );
                          final uri = Uri.parse('https://wa.me/?text=$text');
                          try {
                            await launchUrl(uri, mode: LaunchMode.externalApplication);
                          } catch (_) {
                            await Clipboard.setData(ClipboardData(text: code));
                            if (ctx.mounted) {
                              ScaffoldMessenger.of(ctx).showSnackBar(
                                const SnackBar(content: Text('Invite text copied')),
                              );
                            }
                          }
                        },
                        icon: const Icon(Icons.share_rounded, size: 18),
                        label: const Text('Share'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _enterClassroom(Map<String, dynamic> created) async {
    final classId = created['id']?.toString() ?? '';
    if (classId.isEmpty || !mounted) return;
    final title = _titleCtrl.text.trim();
    final subject = _subjectCtrl.text.trim();
    try {
      await widget.api.startLiveClass(classId);
      final tokenData = await widget.api.getLiveClassToken(classId);
      final roomId = tokenData['room_id']?.toString() ??
          tokenData['channel_id']?.toString() ??
          created['room_id']?.toString() ??
          classId;
      final userId = await widget.api.getUserId() ?? '';
      if (!mounted) return;
      Navigator.pop(context);
      widget.onCreated();
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => LiveClassScreen(
            subject: subject,
            topic: title,
            classId: classId,
            roomId: roomId,
            livekitToken: tokenData['livekit_token']?.toString() ??
                tokenData['token']?.toString(),
            livekitUrl: tokenData['livekit_url']?.toString(),
            userId: userId,
            isTeacher: true,
          ),
        ),
      );
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: Colors.red),
        );
      }
    }
  }

  String _durationLabel(int minutes) {
    if (minutes < 60) return '$minutes min';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    if (m == 0) return h == 1 ? '1 hour' : '$h hours';
    return '${h}h ${m}m';
  }

  Future<void> _submit() async {
    final title = _titleCtrl.text.trim();
    final subject = _subjectCtrl.text.trim();
    if (title.isEmpty || subject.isEmpty) return;

    if (_visibility == 'school_group' && (_groupId == null || _groupId!.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select a school group.')),
      );
      return;
    }

    setState(() => _loading = true);
    try {
      final created = await widget.api.createLiveClass(
        subject: subject,
        title: title,
        startTime: _goLiveNow ? null : _start.toUtc().toIso8601String(),
        goLiveNow: _goLiveNow,
        durationMinutes: _durationMinutes,
        visibility: _visibility,
        schoolGroupId: _groupId,
        invitedStudentEmails: _visibility == 'private'
            ? _inviteEmailsCtrl.text
                .split(',')
                .map((e) => e.trim())
                .where((e) => e.contains('@'))
                .toList()
            : const [],
      );
      final joinCode = created['join_code']?.toString() ?? '';
      if (_goLiveNow) {
        if (mounted && joinCode.isNotEmpty) {
          await _showClassCodeSheet(created, joinCode, live: true);
        }
        await _enterClassroom(created);
      } else if (mounted) {
        Navigator.pop(context);
        widget.onCreated();
        if (joinCode.isNotEmpty) {
          await _showClassCodeSheet(created, joinCode, live: false);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Class scheduled successfully!')),
          );
        }
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Schedule Live Class',
              style: TextStyle(
                  color: context.textColor,
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          _field(_titleCtrl, 'Class title'),
          const SizedBox(height: 12),
          _field(_subjectCtrl, 'Subject (e.g. Mathematics)'),
          const SizedBox(height: 16),
          Text('Who can join?',
              style: TextStyle(
                  color: context.textColor,
                  fontSize: 14,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          _visibilityOption(
            value: 'public',
            icon: Icons.public,
            title: 'Public',
            subtitle: 'Any student taking this subject can join.',
          ),
          _visibilityOption(
            value: 'private',
            icon: Icons.lock_outline,
            title: 'Private — access code',
            subtitle: 'Only students with your class code can join.',
          ),
          _visibilityOption(
            value: 'school_group',
            icon: Icons.groups_outlined,
            title: 'School group',
            subtitle: 'Only members of a saved group can join.',
          ),
          if (_visibility == 'private')
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: _inviteEmailsCtrl,
                    keyboardType: TextInputType.emailAddress,
                    decoration: InputDecoration(
                      hintText: 'kid1@email.com, kid2@email.com',
                      labelText: 'Invite by email (optional)',
                      border: const OutlineInputBorder(),
                      isDense: true,
                      prefixIcon: const Icon(Icons.mail_outline, size: 18),
                      fillColor: context.surfColor,
                      filled: true,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(Icons.key_rounded, size: 16, color: context.accentColor),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Invited emails get a class invitation with the join code, and the class shows in their Live Class list — no code typing needed. Others can still join with the code.',
                          style: TextStyle(color: context.greyColor, fontSize: 12, height: 1.4),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          if (_visibility == 'school_group') _groupPicker(),
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('Go live now',
                style: TextStyle(color: context.textColor, fontSize: 14)),
            subtitle: Text('Start immediately and open the classroom',
                style: TextStyle(color: context.greyColor, fontSize: 12)),
            value: _goLiveNow,
            activeThumbColor: context.accentColor,
            onChanged: (v) => setState(() => _goLiveNow = v),
          ),
          if (!_goLiveNow)
            ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('Start time',
                style: TextStyle(color: context.greyColor, fontSize: 12)),
            subtitle: Text(TeacherUtils.formatDateTime(_start.toIso8601String()),
                style: TextStyle(color: context.textColor)),
            trailing: Icon(Icons.calendar_today, color: context.accentColor),
            onTap: () async {
              final date = await showDatePicker(
                context: context,
                initialDate: _start,
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (date == null || !mounted) return;
              final time = await showTimePicker(
                context: context,
                initialTime: TimeOfDay.fromDateTime(_start),
              );
              if (time == null || !mounted) return;
              setState(() {
                _start = DateTime(date.year, date.month, date.day, time.hour, time.minute);
              });
            },
          ),
          const SizedBox(height: 12),
          Text('When does the class stop?',
              style: TextStyle(
                  color: context.textColor,
                  fontSize: 14,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _durationOptions.map((m) {
              final selected = _durationMinutes == m;
              return ChoiceChip(
                label: Text(_durationLabel(m)),
                selected: selected,
                onSelected: (_) => setState(() => _durationMinutes = m),
                labelStyle: TextStyle(
                  color: selected ? Colors.black : context.textColor,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
                selectedColor: context.accentColor,
                backgroundColor: context.surfColor,
                side: BorderSide(color: context.borderColor),
                showCheckmark: false,
              );
            }).toList(),
          ),
          const SizedBox(height: 6),
          Text(
            _goLiveNow
                ? 'The class will automatically end ${_durationLabel(_durationMinutes)} after it starts.'
                : 'The class will automatically end ${_durationLabel(_durationMinutes)} after the start time.',
            style: TextStyle(color: context.greyColor, fontSize: 11),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: _loading ? null : _submit,
              style: ElevatedButton.styleFrom(
                backgroundColor: context.accentColor,
                foregroundColor: Colors.black,
              ),
              child: _loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      _goLiveNow ? 'Go Live' : 'Create Class',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
            ),
          ),
        ],
      ),
      ),
    );
  }

  Widget _visibilityOption({
    required String value,
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    final selected = _visibility == value;
    final accent = context.accentColor;
    return GestureDetector(
      onTap: () => _onVisibilityChanged(value),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? accent.withOpacity(0.12) : context.surfColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? accent : context.borderColor,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(icon, color: selected ? accent : context.greyColor, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: TextStyle(
                          color: context.textColor,
                          fontSize: 14,
                          fontWeight: FontWeight.w600)),
                  Text(subtitle,
                      style:
                          TextStyle(color: context.greyColor, fontSize: 11)),
                ],
              ),
            ),
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              color: selected ? accent : context.greyColor,
              size: 20,
            ),
          ],
        ),
      ),
    );
  }

  Widget _groupPicker() {
    if (_loadingGroups) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    if (_groups.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          'No school groups yet. Create one in the Groups tab first.',
          style: TextStyle(color: context.greyColor, fontSize: 12),
        ),
      );
    }
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: BoxDecoration(
        color: context.surfColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.borderColor),
      ),
      child: ListView(
        shrinkWrap: true,
        children: _groups.map((g) {
          final id = g['id']?.toString() ?? '';
          final title = (g['name'] ?? 'Group').toString();
          final school = (g['school_name'] ?? '').toString();
          final count = g['member_count'] ?? (g['student_ids'] is List
              ? (g['student_ids'] as List).length
              : 0);
          final selected = _groupId == id;
          return RadioListTile<String>(
            dense: true,
            value: id,
            groupValue: _groupId,
            activeColor: context.accentColor,
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(
              school.isEmpty ? title : '$school — $title',
              style: TextStyle(
                  color: context.textColor,
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.normal),
            ),
            subtitle: Text('$count student(s)',
                style: TextStyle(color: context.greyColor, fontSize: 11)),
            onChanged: (v) => setState(() => _groupId = v),
          );
        }).toList(),
      ),
    );
  }

  Widget _field(TextEditingController ctrl, String hint) {
    return TextField(
      controller: ctrl,
      style: TextStyle(color: context.textColor),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: context.greyColor),
        filled: true,
        fillColor: context.surfColor,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}
