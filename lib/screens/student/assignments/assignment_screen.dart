import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:pdfrx/pdfrx.dart';

import '../../../api/api_service.dart';
import '../../../theme/app_theme.dart';

class AssignmentScreen extends StatefulWidget {
  const AssignmentScreen({super.key});

  @override
  State<AssignmentScreen> createState() => _AssignmentScreenState();
}

class _AssignmentScreenState extends State<AssignmentScreen>
    with SingleTickerProviderStateMixin {
  final _api = ApiService();
  final _caption = TextEditingController();
  late final TabController _tabs;
  List<Map<String, dynamic>> _announcements = [];
  List<Map<String, dynamic>> _results = [];
  List<Map<String, dynamic>> _teachers = [];
  String? _teacherId;
  String _channelId = '';
  PlatformFile? _pdf;
  bool _loading = true;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    _caption.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final values = await Future.wait([
        _api.communityChannels(),
        _api.listTeacherAnnouncements(),
        _api.listPublicTeachers(),
        _api.myAssignmentSubmissions(),
      ]);
      final channels = values[0];
      for (final raw in channels.whereType<Map>()) {
        final ch = Map<String, dynamic>.from(raw);
        final marker =
            '${ch['name']} ${ch['channel_type']}'.toLowerCase();
        if (marker.contains('announcement') || marker.contains('teacher')) {
          _channelId = ch['id']?.toString() ?? '';
          break;
        }
      }
      if (mounted) {
        setState(() {
          _announcements = values[1]
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .where((p) =>
                  p['media_type']?.toString().toLowerCase() == 'pdf' &&
                  p['media_url']?.toString().isNotEmpty == true)
              .toList();
          _teachers = values[2]
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          _results = values[3]
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          _teacherId ??= _teachers.isNotEmpty
              ? _teachers.first['user_id']?.toString()
              : null;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickPdf() async {
    // Accept any document: image, PDF, Word, Excel, PowerPoint, text, etc.
    final result = await FilePicker.platform.pickFiles(
      type: FileType.any,
      withData: true,
    );
    if (result == null || result.files.isEmpty) return;
    final file = result.files.single;
    if (file.bytes == null) {
      _show('Could not read that file.', error: true);
      return;
    }
    setState(() => _pdf = file);
  }

  Future<void> _submit() async {
    if (_pdf?.bytes == null || _teacherId == null || _channelId.isEmpty) {
      _show('Choose a teacher and your completed work first.', error: true);
      return;
    }
    setState(() => _submitting = true);
    try {
      final uploaded = await _api.communityUpload(_pdf!.bytes!, _pdf!.name);
      final url = uploaded['file_url']?.toString() ?? '';
      if (url.isEmpty) throw ApiException.message('File upload failed.');
      await _api.submitAssignment(
        channelId: _channelId,
        teacherId: _teacherId!,
        fileUrl: url,
        caption: _caption.text,
      );
      if (!mounted) return;
      setState(() {
        _pdf = null;
        _caption.clear();
      });
      _show('Assignment submitted. Your teacher has been notified.');
      await _load();
      _tabs.animateTo(1);
    } on ApiException catch (e) {
      _show(e.message, error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _show(String text, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: error ? Colors.red : null,
      ),
    );
  }

  void _openPdf(String url, String title) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => AssignmentPdfScreen(url: url, title: title),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: AppBar(
        title: const Text('Assignments'),
        bottom: TabBar(
          controller: _tabs,
          indicatorSize: TabBarIndicatorSize.label,
          labelStyle: const TextStyle(fontWeight: FontWeight.w800),
          unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w600),
          tabs: const [
            Tab(text: 'Submit'),
            Tab(text: 'Notice Board'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : TabBarView(
              controller: _tabs,
              children: [_submitTab(), _noticeBoard()],
            ),
    );
  }

  InputDecoration _field(String hint, {Widget? prefix}) {
    return InputDecoration(
      hintText: hint,
      prefixIcon: prefix,
      filled: true,
      fillColor: context.cardColor,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: context.borderColor),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: context.borderColor),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: context.accentColor, width: 1.4),
      ),
    );
  }

  Widget _section(String title, {String? subtitle}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 4,
                height: 18,
                decoration: BoxDecoration(
                  color: context.accentColor,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: context.textColor,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 6),
            Padding(
              padding: const EdgeInsets.only(left: 14),
              child: Text(
                subtitle,
                style: TextStyle(color: context.greyColor, fontSize: 13, height: 1.35),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _panel({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: context.borderColor),
      ),
      child: child,
    );
  }

  Widget _submitTab() {
    final teacherItems = _teachers
        .map(
          (t) => DropdownMenuItem(
            value: t['user_id']?.toString(),
            child: Text(t['full_name']?.toString() ?? 'Teacher'),
          ),
        )
        .toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
        children: [
          _section(
            'From your teacher',
            subtitle: 'Open a posted PDF, complete it, then send it back below.',
          ),
          if (_announcements.isEmpty)
            _panel(
              child: Column(
                children: [
                  Icon(Icons.assignment_outlined, size: 36, color: context.accentColor),
                  const SizedBox(height: 10),
                  Text(
                    'No PDF assignments yet',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: context.textColor,
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'When a teacher posts work, it will show here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: context.greyColor, fontSize: 13),
                  ),
                ],
              ),
            )
          else
            ..._announcements.map((item) {
              final title =
                  item['content']?.toString().trim().isNotEmpty == true
                      ? item['content'].toString().trim()
                      : 'PDF assignment';
              final url = item['media_url']?.toString() ?? '';
              return Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _panel(
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      backgroundColor: context.accentColor.withValues(alpha: 0.12),
                      child: Icon(Icons.picture_as_pdf_rounded, color: context.accentColor),
                    ),
                    title: Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: context.textColor,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    subtitle: Text(
                      item['author_name']?.toString() ?? 'Teacher',
                      style: TextStyle(color: context.greyColor),
                    ),
                    trailing: Icon(Icons.chevron_right_rounded, color: context.greyColor),
                    onTap: () => _openPdf(url, title),
                  ),
                ),
              );
            }),
          const SizedBox(height: 28),
          _section(
            'Submit your work',
            subtitle: 'Choose the teacher, add a title, then attach your PDF.',
          ),
          _panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _teacherId,
                  isExpanded: true,
                  decoration: _field(
                    'Select teacher',
                    prefix: const Icon(Icons.person_outline_rounded),
                  ),
                  items: teacherItems,
                  onChanged: (value) => setState(() => _teacherId = value),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _caption,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: _field(
                    'Assignment title or note',
                    prefix: const Icon(Icons.notes_rounded),
                  ),
                ),
                const SizedBox(height: 14),
                Material(
                  color: context.bgColor,
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    onTap: _submitting ? null : _pickPdf,
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: context.borderColor),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            Icons.upload_file_rounded,
                            color: context.accentColor,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              _pdf?.name ?? 'Choose completed work (PDF, image, Word, Excel…)',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: _pdf == null
                                    ? context.greyColor
                                    : context.textColor,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Icon(Icons.attach_file_rounded, color: context.greyColor, size: 18),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                SizedBox(
                  height: 50,
                  child: FilledButton.icon(
                    onPressed: _submitting ? null : _submit,
                    icon: _submitting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.send_rounded),
                    label: Text(_submitting ? 'Submitting…' : 'Submit to teacher'),
                    style: FilledButton.styleFrom(
                      backgroundColor: context.accentColor,
                      foregroundColor: Colors.white,
                      textStyle: const TextStyle(fontWeight: FontWeight.w800),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Only you and the teacher you tag can see this submission.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: context.greyColor, fontSize: 12, height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _noticeBoard() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
        children: [
          _section(
            'Your private results',
            subtitle: 'Other students cannot see your submissions, scores, or feedback.',
          ),
          if (_results.isEmpty)
            _panel(
              child: Column(
                children: [
                  Icon(Icons.inbox_outlined, size: 36, color: context.accentColor),
                  const SizedBox(height: 10),
                  Text(
                    'No submissions yet',
                    style: TextStyle(
                      color: context.textColor,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Your scores and teacher comments will appear here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: context.greyColor, fontSize: 13),
                  ),
                ],
              ),
            )
          else
            ..._results.asMap().entries.map((entry) {
              final item = entry.value;
              final score = item['result_score']?.toString();
              final feedback = item['result_feedback']?.toString();
              final status = item['status']?.toString() ?? 'submitted';
              final graded = score != null && score.isNotEmpty;
              return Padding(
                padding: EdgeInsets.only(bottom: entry.key == _results.length - 1 ? 0 : 10),
                child: _panel(
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      backgroundColor: (graded ? Colors.green : Colors.orange)
                          .withValues(alpha: 0.15),
                      child: Icon(
                        graded ? Icons.verified_rounded : Icons.hourglass_top_rounded,
                        color: graded ? Colors.green : Colors.orange,
                      ),
                    ),
                    title: Text(
                      item['caption']?.toString().trim().isNotEmpty == true
                          ? item['caption'].toString()
                          : 'Assignment submission',
                      style: TextStyle(
                        color: context.textColor,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        graded
                            ? 'Score: $score${feedback?.isNotEmpty == true ? '\n$feedback' : ''}'
                            : 'Status: $status',
                        style: TextStyle(color: context.greyColor, height: 1.35),
                      ),
                    ),
                    isThreeLine: feedback?.isNotEmpty == true,
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}

class AssignmentPdfScreen extends StatelessWidget {
  const AssignmentPdfScreen({
    super.key,
    required this.url,
    required this.title,
  });

  final String url;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title, maxLines: 1)),
      body: PdfViewer.uri(Uri.parse(url)),
    );
  }
}
