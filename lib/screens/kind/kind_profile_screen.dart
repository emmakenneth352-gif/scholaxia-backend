import 'package:flutter/material.dart';
import '../../api/api_service.dart';
import '../../services/profile_avatar_cache.dart';
import '../../services/support_contact_service.dart';
import '../../theme/app_theme.dart';
import '../../utils/post_attachment_picker.dart';
import '../../widgets/student_ui.dart';
import '../../widgets/theme_toggle_tile.dart';
import '../auth/role_select_screen.dart';
import '../student/profile/about_scholaxia_screen.dart';
import 'kind_terms_screen.dart';

class KindProfileScreen extends StatefulWidget {
  const KindProfileScreen({super.key});

  @override
  State<KindProfileScreen> createState() => _KindProfileScreenState();
}

class _KindProfileScreenState extends State<KindProfileScreen> {
  final _api = ApiService();
  Map<String, dynamic>? _profile;
  bool _loading = true;
  bool _uploadingPhoto = false;
  bool _loggingOut = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final p = await _api.getKindMe();
      if (mounted) {
        setState(() {
          _profile = p;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
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
      if (!mounted) return;
      setState(() {
        _profile = {...?_profile, 'profile_picture': url};
        _uploadingPhoto = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile picture updated!')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _uploadingPhoto = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: Colors.red),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _uploadingPhoto = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not update picture. Try another image.'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = _profile?['full_name']?.toString() ?? 'Learner';
    final email = _profile?['email']?.toString() ?? '';
    final age = _profile?['age_group']?.toString() ?? '';
    final parent = _profile?['parent_email']?.toString() ?? '';
    final picture = _api.resolveMediaUrl(
      _profile?['profile_picture']?.toString() ?? '',
    );
    final initial = name.isNotEmpty ? name[0].toUpperCase() : 'K';

    return Scaffold(
      backgroundColor: context.bgColor,
      body: _loading
          ? Center(child: CircularProgressIndicator(color: context.accentColor))
          : RefreshIndicator(
              color: context.accentColor,
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(0, 0, 0, 110),
                children: [
                  SafeArea(
                    bottom: false,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (Navigator.of(context).canPop())
                          Padding(
                            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                            child: GestureDetector(
                              onTap: () => Navigator.of(context).maybePop(),
                              child: Container(
                                width: 40,
                                height: 40,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: context.cardColor,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: context.borderColor,
                                  ),
                                ),
                                child: Icon(
                                  Icons.arrow_back_rounded,
                                  color: context.textColor,
                                  size: 20,
                                ),
                              ),
                            ),
                          ),
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                          padding: const EdgeInsets.fromLTRB(22, 28, 22, 32),
                          decoration: BoxDecoration(
                            gradient: AppGradients.hero(context),
                            borderRadius: BorderRadius.circular(28),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(
                                  0xFF7C3AED,
                                ).withOpacity(0.35),
                                blurRadius: 24,
                                offset: const Offset(0, 12),
                              ),
                            ],
                          ),
                          child: Column(
                            children: [
                              GestureDetector(
                                onTap: _changeProfilePicture,
                                child: Stack(
                                  clipBehavior: Clip.none,
                                  children: [
                                    CircleAvatar(
                                      radius: 40,
                                      backgroundColor:
                                          Colors.white.withOpacity(0.2),
                                      backgroundImage: picture.isNotEmpty
                                          ? NetworkImage(picture)
                                          : null,
                                      child: picture.isEmpty
                                          ? Text(
                                              initial,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 34,
                                                fontWeight: FontWeight.w800,
                                              ),
                                            )
                                          : null,
                                    ),
                                    Positioned(
                                      right: -4,
                                      bottom: -4,
                                      child: CircleAvatar(
                                        radius: 15,
                                        backgroundColor: Colors.white,
                                        child: _uploadingPhoto
                                            ? const SizedBox(
                                                width: 15,
                                                height: 15,
                                                child:
                                                    CircularProgressIndicator(
                                                  strokeWidth: 2,
                                                ),
                                              )
                                            : const Icon(
                                                Icons.camera_alt_rounded,
                                                size: 17,
                                                color: Color(0xFF7C3AED),
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
                                  color: Colors.white.withOpacity(0.8),
                                  fontSize: 11,
                                ),
                              ),
                              const SizedBox(height: 14),
                              Text(
                                name,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 22,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              if (age.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Text(
                                    'Ages $age · Kid learner',
                                    style: TextStyle(
                                      color: Colors.white.withOpacity(0.8),
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const StudentSectionTitle(title: 'Account'),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Column(
                      children: [
                        if (email.isNotEmpty)
                          _infoTile(
                            context,
                            Icons.mail_outline_rounded,
                            'Email',
                            email,
                          ),
                        if (parent.isNotEmpty)
                          _infoTile(
                            context,
                            Icons.family_restroom_outlined,
                            'Parent email',
                            parent,
                          ),
                        const SizedBox(height: 8),
                        ThemeToggleTile(accentColor: context.accentColor),
                        const SizedBox(height: 16),
                        _linkTile(
                          context,
                          Icons.info_outline_rounded,
                          'About App',
                          'Learn what Scholaxia Kids offers',
                          () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const AboutScholaxiaScreen(),
                            ),
                          ),
                        ),
                        _linkTile(
                          context,
                          Icons.description_outlined,
                          'Terms & Conditions',
                          'Class bookings and app use rules',
                          () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const KindTermsScreen(),
                            ),
                          ),
                        ),
                        _linkTile(
                          context,
                          Icons.support_agent_rounded,
                          'Contact us',
                          'Call, email, or chat on WhatsApp',
                          () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const ContactScholaxiaScreen(),
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        SizedBox(
                          width: double.infinity,
                          height: 50,
                          child: OutlinedButton.icon(
                            onPressed: _loggingOut ? null : _logout,
                            icon: _loggingOut
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Color(0xFFEF4444),
                                    ),
                                  )
                                : const Icon(
                                    Icons.logout_rounded,
                                    color: Color(0xFFEF4444),
                                  ),
                            label: const Text(
                              'Log out',
                              style: TextStyle(
                                color: Color(0xFFEF4444),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            style: OutlinedButton.styleFrom(
                              side: BorderSide(
                                color: const Color(0xFFEF4444).withOpacity(0.5),
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                            ),
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

  Widget _linkTile(
    BuildContext context,
    IconData icon,
    String title,
    String subtitle,
    VoidCallback onTap,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: context.borderColor),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    gradient: AppGradients.primaryButton,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: context.textColor,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        subtitle,
                        style: TextStyle(
                          color: context.greyColor,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded, color: context.greyColor),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _infoTile(
    BuildContext context,
    IconData icon,
    String label,
    String value,
  ) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: context.borderColor),
        boxShadow: [
          BoxShadow(
            color: context.accentColor.withOpacity(0.06),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              gradient: AppGradients.primaryButton,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: Colors.white, size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(color: context.greyColor, fontSize: 11),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: TextStyle(
                    color: context.textColor,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
