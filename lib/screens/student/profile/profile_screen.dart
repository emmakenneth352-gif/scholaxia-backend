import 'dart:io';

import 'package:flutter/material.dart';
import '../../../api/api_service.dart';
import '../../../theme/app_theme.dart';
import '../../../utils/post_attachment_picker.dart';
import '../../../services/profile_avatar_cache.dart';
import '../../../services/support_contact_service.dart';
import '../../auth/exam_subject_setup_screen.dart';
import '../../auth/role_select_screen.dart';
import '../../kind/kind_shell.dart';
import '../notifications/notifications_screen.dart';
import 'about_scholaxia_screen.dart';
import 'terms_conditions_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _api = ApiService();
  StudentProfile? _profile;
  bool _loading = true;
  bool _uploadingPhoto = false;
  bool _loggingOut = false;
  String? _error;
  File? _localAvatar;

  @override
  void initState() {
    super.initState();
    _load();
    _startWatchdog();
  }

  /// Safety net: if still loading after 30s, force an error state so the
  /// spinner never hangs forever.
  void _startWatchdog() {
    Future.delayed(const Duration(seconds: 30), () {
      if (!mounted) return;
      if (_loading) {
        setState(() {
          _loading = false;
          _error = 'Request timed out. Please check your connection and retry.';
        });
      }
    });
  }

  Future<File?> _safeExistingAvatar() async {
    try {
      return await ProfileAvatarCache.instance
          .existingFile()
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      return null;
    }
  }

  Future<String?> _safeCachedProfilePicture() async {
    try {
      return await _api
          .cachedProfilePicture()
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      return null;
    }
  }

  Future<void> _load() async {
    debugPrint('_load: start');
    try {
      debugPrint('_load: getting role');
      final role = await _api.getRole().timeout(const Duration(seconds: 10));
      debugPrint('_load: role = $role');

      if (role == 'kind') {
        if (!mounted) return;
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const KindShell()),
          (_) => false,
        );
        return;
      }

      debugPrint('_load: getting student profile');
      final p = await _api
          .getStudentProfile()
          .timeout(const Duration(seconds: 20));
      debugPrint('_load: profile = ${p.fullName}');
      debugPrint('_load: email = ${p.email}');

      final local = await _safeExistingAvatar();

      if (!mounted) return;
      setState(() {
        _profile = p;
        _localAvatar = local;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      debugPrint('_load: error = $e');
      if (!mounted) return;

      final msg = e is ApiException ? e.message : e.toString();

      if (msg.toLowerCase().contains('students only') ||
          msg.toLowerCase().contains('kind')) {
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const KindShell()),
          (_) => false,
        );
        return;
      }

      // Fetch cached data safely — each wrapped so failures never hang.
      final local = await _safeExistingAvatar();
      if (!mounted) return;
      final cachedUrl = await _safeCachedProfilePicture();
      if (!mounted) return;

      setState(() {
        _localAvatar = local;
        if (cachedUrl != null && _profile == null) {
          _profile = StudentProfile(
            fullName: '',
            email: '',
            profilePicture: cachedUrl,
          );
        } else if (cachedUrl != null && _profile != null) {
          _profile = _profile!.copyWith(profilePicture: cachedUrl);
        }
        _error = msg;
        _loading = false; // GUARANTEED to run now.
      });
    }
  }

  Future<void> _logout() async {
    if (_loggingOut) return;
    if (mounted) setState(() => _loggingOut = true);
    // Clear local session, then ALWAYS leave — sign-out must never hang on a
    // stuck pref or a locked avatar file (Windows keeps the JPG open while
    // this screen shows it). Errors here are non-fatal by design.
    try {
      await _api.clearTokens().timeout(const Duration(seconds: 5));
    } catch (_) {}
    try {
      await ProfileAvatarCache.instance.clear().timeout(const Duration(seconds: 3));
    } catch (_) {}
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const RoleSelectScreen()),
      (_) => false,
    );
  }

  Future<void> _changeProfilePicture() async {
    if (_uploadingPhoto) return;
    try {
      final picked = await pickPostAttachment('photo');
      if (picked == null) return;
      setState(() => _uploadingPhoto = true);
      final url = await _api.updateProfilePicture(picked.bytes, picked.name);
      final local = await _safeExistingAvatar();
      if (!mounted) return;
      setState(() {
        _profile = _profile?.copyWith(profilePicture: url);
        _localAvatar = local;
        _uploadingPhoto = false;
      });
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Profile picture updated!')));
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _uploadingPhoto = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: Colors.red),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _uploadingPhoto = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not update picture. Try another image.'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  /// Opens a dialog to edit the user's full name and saves it via the API.
  Future<void> _editName() async {
    final current = _profile?.fullName ?? '';
    final controller = TextEditingController(text: current);

    final newName = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: context.cardColor,
        title: Text(
          'Edit name',
          style: TextStyle(
            color: context.textColor,
            fontWeight: FontWeight.w700,
          ),
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          style: TextStyle(color: context.textColor),
          decoration: InputDecoration(
            hintText: 'Enter your full name',
            hintStyle: TextStyle(color: context.greyColor),
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(
              'Cancel',
              style: TextStyle(color: context.greyColor),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            style: ElevatedButton.styleFrom(
              backgroundColor: context.accentColor,
              foregroundColor: context.isDark
                  ? AppColors.background
                  : Colors.white,
            ),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (newName == null) return;
    if (newName.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name cannot be empty.')),
      );
      return;
    }
    if (newName == current) return;

    try {
      final updated = await _api
          .updateStudentName(newName)
          .timeout(const Duration(seconds: 15));
      if (!mounted) return;
      setState(() {
        _profile = _profile?.copyWith(fullName: updated);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name updated!')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: Colors.red),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Could not update name: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  ImageProvider? _avatarProvider(StudentProfile p) {
    if (_localAvatar != null) return FileImage(_localAvatar!);
    final raw = p.profilePicture;
    if (raw == null || raw.isEmpty) return null;
    final url = _api.resolveMediaUrl(raw);
    if (url.isEmpty) return null;
    return NetworkImage(url);
  }

  /// Uses the API service's displayName property for consistent name display.
  String _displayName(StudentProfile p) {
    return p.displayName;
  }

  String _initialsFor(String name) {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return '?';
    return trimmed
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .map((w) => w[0])
        .take(2)
        .join()
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      body: _loading
          ? Center(child: CircularProgressIndicator(color: context.accentColor))
          : _error != null
          ? _buildError(context)
          : RefreshIndicator(
              color: context.accentColor,
              onRefresh: _load,
              child: _buildContent(context),
            ),
    );
  }

  Widget _buildError(BuildContext context) {
    final isAuthError =
        _error != null &&
        (_error!.contains('Not logged in') ||
            (_error!.contains('profile') && _error!.contains('404')));
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isAuthError ? Icons.person_outline : Icons.error_outline,
              color: context.greyColor,
              size: 48,
            ),
            const SizedBox(height: 12),
            Text(
              isAuthError ? 'Profile not set up yet' : 'Could not load profile',
              style: TextStyle(
                color: context.textColor,
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              isAuthError
                  ? 'Your student profile is being set up. Please log out and log back in.'
                  : (_error ?? ''),
              textAlign: TextAlign.center,
              style: TextStyle(color: context.greyColor, fontSize: 12),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                setState(() {
                  _loading = true;
                  _error = null;
                });
                _load();
                _startWatchdog();
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: context.accentColor,
                foregroundColor: context.isDark
                    ? AppColors.background
                    : Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: const Text('Retry'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _logout,
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                side: const BorderSide(color: Colors.red),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: const Text('Log out'),
            ),
            if (isAuthError) ...[
              const SizedBox(height: 8),
              Text(
                'Or log out and sign in again.',
                textAlign: TextAlign.center,
                style: TextStyle(color: context.greyColor, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    final p = _profile!;
    final displayName = _displayName(p);
    final initials = _initialsFor(displayName);
    final examSet = p.examType != null && p.examType!.isNotEmpty;
    final levelSet = p.educationLevel != null && p.educationLevel!.isNotEmpty;
    final profileIncomplete = !examSet || !levelSet || p.subjects.isEmpty;

    return CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        SliverToBoxAdapter(
          child: _heroHeader(context, p, initials, displayName),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
            child: _statsCard(context),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
          sliver: SliverList(
            delegate: SliverChildListDelegate([
              _sectionTitle(context, 'Study details'),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _detailCard(
                      context,
                      icon: Icons.school_rounded,
                      label: 'Exam target',
                      value: examSet
                          ? (p.examType == 'ALL'
                                ? 'JAMB + ${p.ssceExamType ?? 'WAEC/NECO'}'
                                : p.examType!)
                          : 'Not set',
                      muted: !examSet,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _detailCard(
                      context,
                      icon: Icons.menu_book_rounded,
                      label: 'Education',
                      value: levelSet ? p.educationLevel! : 'Not set',
                      muted: !levelSet,
                    ),
                  ),
                ],
              ),
              if (p.jambSubjects.isNotEmpty) ...[
                const SizedBox(height: 20),
                _sectionTitle(context, 'JAMB subjects'),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: p.jambSubjects
                      .map((s) => _subjectChip(context, s))
                      .toList(),
                ),
              ],
              if (p.ssceSubjects.isNotEmpty) ...[
                const SizedBox(height: 20),
                _sectionTitle(
                  context,
                  '${p.ssceExamType == 'JUNIOR_WAEC' ? 'Junior WAEC' : (p.ssceExamType ?? 'WAEC/NECO')} subjects',
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: p.ssceSubjects
                      .map((s) => _subjectChip(context, s))
                      .toList(),
                ),
              ],
              if (p.jambSubjects.isEmpty &&
                  p.ssceSubjects.isEmpty &&
                  p.subjects.isNotEmpty) ...[
                const SizedBox(height: 20),
                _sectionTitle(context, 'My subjects'),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: p.subjects
                      .map((s) => _subjectChip(context, s))
                      .toList(),
                ),
              ],
              const SizedBox(height: 24),
              _sectionTitle(context, 'Account'),
              const SizedBox(height: 10),
              _settingsGroup(context, [
                _settingsRow(
                  context,
                  Icons.person_outline_rounded,
                  'Edit name',
                  onTap: _editName,
                ),
              ]),
              const SizedBox(height: 24),
              _sectionTitle(context, 'Preferences'),
              const SizedBox(height: 10),
              _settingsGroup(context, [
                _settingsRow(
                  context,
                  Icons.notifications_outlined,
                  'Notifications',
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const NotificationsScreen(),
                    ),
                  ),
                ),
                _settingsRow(
                  context,
                  context.isDark
                      ? Icons.light_mode_outlined
                      : Icons.dark_mode_outlined,
                  context.isDark ? 'Light mode' : 'Dark mode',
                  trailing: Switch.adaptive(
                    value: context.isDark,
                    activeColor: context.accentColor,
                    onChanged: (_) => setState(() => themeNotifier.toggle()),
                  ),
                  onTap: () => setState(() => themeNotifier.toggle()),
                ),
              ]),
              const SizedBox(height: 16),
              _sectionTitle(context, 'About'),
              const SizedBox(height: 10),
              _settingsGroup(context, [
                _settingsRow(
                  context,
                  Icons.info_outline_rounded,
                  'About Scholaxia',
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const AboutScholaxiaScreen(),
                    ),
                  ),
                ),
                _settingsRow(
                  context,
                  Icons.description_outlined,
                  'Terms & Conditions',
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const TermsConditionsScreen(),
                    ),
                  ),
                ),
                _settingsRow(
                  context,
                  Icons.support_agent_rounded,
                  'Contact us',
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const ContactScholaxiaScreen(),
                    ),
                  ),
                ),
              ]),
              const SizedBox(height: 24),
              _logoutButton(context),
              const SizedBox(height: 100),
            ]),
          ),
        ),
      ],
    );
  }

  Widget _heroHeader(
    BuildContext context,
    StudentProfile p,
    String initials,
    String displayName,
  ) {
    return Container(
      width: double.infinity,
      color: context.headerColor,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: Column(
            children: [
              Row(
                children: [
                  if (Navigator.of(context).canPop()) ...[
                    GestureDetector(
                      onTap: () => Navigator.of(context).maybePop(),
                      child: Container(
                        width: 38,
                        height: 38,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: context.surfColor,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: context.borderColor),
                        ),
                        child: Icon(
                          Icons.arrow_back_rounded,
                          color: context.textColor,
                          size: 20,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Text(
                    'Profile',
                    style: TextStyle(
                      color: context.textColor,
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const Spacer(),
                  _planBadge(context, p.hasActiveSubscription),
                ],
              ),
              const SizedBox(height: 28),
              GestureDetector(
                onTap: _uploadingPhoto ? null : _changeProfilePicture,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: context.accentColor.withOpacity(0.35),
                          width: 3,
                        ),
                      ),
                      child: CircleAvatar(
                        radius: 44,
                        backgroundColor: context.accentColor.withOpacity(0.12),
                        backgroundImage: _avatarProvider(p),
                        child: _avatarProvider(p) == null
                            ? Text(
                                initials,
                                style: TextStyle(
                                  color: context.accentColor,
                                  fontSize: 28,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 1,
                                ),
                              )
                            : null,
                      ),
                    ),
                    if (_uploadingPhoto)
                      Container(
                        width: 96,
                        height: 96,
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.35),
                          shape: BoxShape.circle,
                        ),
                        child: const Center(
                          child: SizedBox(
                            width: 28,
                            height: 28,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      )
                    else
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: Container(
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            color: context.accentColor,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: context.headerColor,
                              width: 3,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: context.accentColor.withOpacity(0.35),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: const Icon(
                            Icons.camera_alt_rounded,
                            color: Colors.white,
                            size: 16,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Tap photo to change',
                style: TextStyle(
                  color: context.greyColor,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                    child: Text(
                      displayName,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: context.textColor,
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: _editName,
                    child: Icon(
                      Icons.edit_rounded,
                      color: context.accentColor,
                      size: 18,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                p.email,
                style: TextStyle(color: context.greyColor, fontSize: 14),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _planBadge(BuildContext context, bool premium) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: premium
            ? context.accentColor.withOpacity(0.12)
            : context.surfColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: premium
              ? context.accentColor.withOpacity(0.35)
              : context.borderColor,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            premium
                ? Icons.workspace_premium_rounded
                : Icons.person_outline_rounded,
            size: 14,
            color: premium ? context.accentColor : context.greyColor,
          ),
          const SizedBox(width: 5),
          Text(
            premium ? 'Premium' : 'Free plan',
            style: TextStyle(
              color: premium ? context.accentColor : context.greyColor,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _statsCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: context.borderColor.withOpacity(0.7)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(context.isDark ? 0.25 : 0.06),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          _statItem(context, Icons.quiz_outlined, '0', 'Exams taken'),
          _statDivider(context),
          _statItem(context, Icons.schedule_rounded, '0', 'Study hours'),
          _statDivider(context),
          _statItem(context, Icons.trending_up_rounded, '0%', 'Avg score'),
        ],
      ),
    );
  }

  Widget _statDivider(BuildContext context) {
    return Container(width: 1, height: 36, color: context.borderColor);
  }

  Widget _statItem(
    BuildContext context,
    IconData icon,
    String value,
    String label,
  ) {
    return Expanded(
      child: Column(
        children: [
          Icon(icon, size: 18, color: context.accentColor.withOpacity(0.85)),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              color: context.textColor,
              fontSize: 18,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(color: context.greyColor, fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(BuildContext context, String title) {
    return Text(
      title,
      style: TextStyle(
        color: context.textColor,
        fontSize: 15,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.2,
      ),
    );
  }

  Widget _detailCard(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String value,
    bool muted = false,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: context.accentColor.withOpacity(0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: context.accentColor, size: 18),
          ),
          const SizedBox(height: 12),
          Text(label, style: TextStyle(color: context.greyColor, fontSize: 11)),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: muted ? context.greyColor : context.textColor,
              fontSize: 14,
              fontWeight: FontWeight.w700,
              height: 1.25,
            ),
          ),
        ],
      ),
    );
  }

  Widget _subjectChip(BuildContext context, String subject) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: context.surfColor,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: context.borderColor),
      ),
      child: Text(
        subject,
        style: TextStyle(
          color: context.textColor,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _settingsGroup(BuildContext context, List<Widget> rows) {
    return Container(
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.borderColor),
      ),
      child: Column(
        children: List.generate(
          rows.length,
          (i) => Column(
            children: [
              rows[i],
              if (i < rows.length - 1)
                Divider(height: 1, indent: 56, color: context.borderColor),
            ],
          ),
        ),
      ),
    );
  }

  Widget _settingsRow(
    BuildContext context,
    IconData icon,
    String label, {
    VoidCallback? onTap,
    Widget? trailing,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: context.surfColor,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: context.textColor, size: 18),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: context.textColor,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              trailing ??
                  Icon(
                    Icons.chevron_right_rounded,
                    color: context.greyColor,
                    size: 20,
                  ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _logoutButton(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _loggingOut ? null : _logout,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: const Color(
              0xFFEF4444,
            ).withOpacity(context.isDark ? 0.12 : 0.08),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: const Color(0xFFEF4444).withOpacity(0.35),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (_loggingOut)
                SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Color(0xFFEF4444),
                  ),
                )
              else
                Icon(Icons.logout_rounded, color: Color(0xFFEF4444), size: 18),
              SizedBox(width: 8),
              Text('Log out', style: TextStyle(color: Color(0xFFEF4444), fontWeight: FontWeight.w700, fontSize: 14)),
            ],
          ),
        ),
      ),
    );
  }
}