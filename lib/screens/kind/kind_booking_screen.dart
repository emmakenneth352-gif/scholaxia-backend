import 'package:flutter/material.dart';
import '../../api/api_service.dart';
import '../../services/paystack_checkout_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/student_ui.dart';
import '../student/classes/class_packages_screen.dart';

/// Kids pay-per-class packages + booking form.
/// Step 1: pick how many classes (price calculated).
/// Step 2: fill form and submit a live session request.
class KindBookingScreen extends StatefulWidget {
  const KindBookingScreen({super.key, this.kidsOnly = true});

  final bool kidsOnly;

  @override
  State<KindBookingScreen> createState() => _KindBookingScreenState();
}

class _KindPlan {
  final String id;
  final String name;
  final int classes;
  final int priceNaira;
  final String? savings;
  final String subtitle;

  const _KindPlan({
    required this.id,
    required this.name,
    required this.classes,
    required this.priceNaira,
    required this.subtitle,
    this.savings,
  });

  String get priceLabel => '₦${_fmt(priceNaira)}';

  static String _fmt(int n) {
    final s = n.toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      final fromEnd = s.length - i;
      buf.write(s[i]);
      if (fromEnd > 1 && fromEnd % 3 == 1) buf.write(',');
    }
    return buf.toString();
  }
}

class _KindBookingScreenState extends State<KindBookingScreen> {
  // Same plans as the website & desktop app (renderer/js/class-packages.js).
  static const _plans = [
    _KindPlan(
      id: 'single_class',
      name: 'Special Single Class',
      classes: 1,
      priceNaira: 5000,
      subtitle: '1 session · 90 minutes',
    ),
    _KindPlan(
      id: 'nursery_school',
      name: 'Nursery School',
      classes: 2,
      priceNaira: 25000,
      subtitle: '2 subjects · 2 sessions weekly',
    ),
    _KindPlan(
      id: 'primary_school',
      name: 'Primary School',
      classes: 3,
      priceNaira: 25000,
      subtitle: '3 subjects · 3 sessions weekly',
    ),
  ];

  final _api = ApiService();
  int _step = 0; // 0 = packages, 1 = form
  _KindPlan _selected = _plans.first;

  final _subjectCtrl = TextEditingController();
  final _topicCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _timeCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _subjectCtrl.dispose();
    _topicCtrl.dispose();
    _phoneCtrl.dispose();
    _timeCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final subject = _subjectCtrl.text.trim();
    if (subject.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Please enter a subject.')));
      return;
    }
    setState(() => _submitting = true);
    final plan = _selected;
    final topic = _topicCtrl.text.trim();
    final phone = _phoneCtrl.text.trim();
    final time = _timeCtrl.text.trim();
    final note = _noteCtrl.text.trim();

    final message = [
      widget.kidsOnly
          ? 'Kids pay-per-class booking (paid)'
          : 'Student pay-per-class booking (paid)',
      'Bundle: ${plan.classes} class${plan.classes == 1 ? '' : 'es'}',
      'Total: ${plan.priceLabel}',
      if (plan.savings != null) plan.savings!,
      if (phone.isNotEmpty) 'Phone: $phone',
      if (time.isNotEmpty) 'Preferred time: $time',
      if (note.isNotEmpty) 'Note: $note',
    ].join('\n');

    try {
      final paid = await PaystackCheckoutService.purchase(
        context: context,
        api: _api,
        productType: 'class_package',
        productId: plan.id,
      );
      if (!mounted || !paid) return;
      await _api.createLiveSessionRequest(
        subject: subject,
        topic: topic.isEmpty ? '${plan.classes}-class kids booking' : topic,
        message: message,
        preferredTime: time.isEmpty ? null : time,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Booking submitted! ${plan.classes} class${plan.classes == 1 ? '' : 'es'} · ${plan.priceLabel}. We will contact you.',
          ),
        ),
      );
      Navigator.of(context).maybePop();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: Colors.red),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not submit booking. Try again.'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
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
                  const StudentBackButton(),
                  Expanded(
                    child: Text(
                      _step == 0 ? 'Plan' : 'Book classes',
                      style: TextStyle(
                        color: context.textColor,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(0, 8, 0, 32),
                children: [
                  _hero(context),
                  if (_step == 0)
                    ..._packageStep(context)
                  else
                    ..._formStep(context),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _hero(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: AppGradients.hero(context),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _step == 0 ? 'Plan' : 'Almost done',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            _step == 0
                ? 'Bundle & save on live one-on-one tutoring.'
                : '${_selected.classes} class${_selected.classes == 1 ? '' : 'es'} · ${_selected.priceLabel}',
            style: TextStyle(
              color: Colors.white.withOpacity(0.9),
              fontSize: 14,
            ),
          ),
          if (_step == 0) ...[
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) =>
                        ClassPackagesScreen(kidsOnly: widget.kidsOnly),
                ),
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white,
                side: const BorderSide(color: Colors.white54),
              ),
              icon: const Icon(Icons.school_rounded),
              label: Text(
                widget.kidsOnly
                    ? 'View Nursery & Primary packages'
                    : 'View Student class packages',
              ),
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _packageStep(BuildContext context) {
    return [
      const StudentSectionTitle(title: 'Choose a bundle'),
      ..._plans.map((p) {
        final sel = p.classes == _selected.classes;
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: Material(
            color: context.cardColor,
            borderRadius: BorderRadius.circular(18),
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () => setState(() => _selected = p),
              child: Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: sel ? context.accentColor : context.borderColor,
                    width: sel ? 2 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      sel
                          ? Icons.radio_button_checked_rounded
                          : Icons.radio_button_off_rounded,
                      color: sel ? context.accentColor : context.greyColor,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            p.name,
                            style: TextStyle(
                              color: context.textColor,
                              fontSize: 17,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            p.subtitle,
                            style: TextStyle(
                              color: context.greyColor,
                              fontSize: 12,
                            ),
                          ),
                          if (p.savings != null) ...[
                            const SizedBox(height: 4),
                            Text(
                              p.savings!,
                              style: const TextStyle(
                                color: Color(0xFF22C55E),
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    Text(
                      p.priceLabel,
                      style: TextStyle(
                        color: context.accentColor,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }),
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: context.accentColor.withOpacity(0.08),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: context.accentColor.withOpacity(0.25)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Total',
                style: TextStyle(color: context.greyColor, fontSize: 12),
              ),
              const SizedBox(height: 4),
              Text(
                '${_selected.classes} class${_selected.classes == 1 ? '' : 'es'} = ${_selected.priceLabel}',
                style: TextStyle(
                  color: context.textColor,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                '≈ ₦${_KindPlan._fmt((_selected.priceNaira / _selected.classes).round())} per class',
                style: TextStyle(color: context.greyColor, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
      const StudentSectionTitle(title: "What's included"),
      _bullets(context, [
        'Live one-on-one class',
        widget.kidsOnly
            ? "Any subject of the child's choice"
            : 'Any subject of your choice',
        'Experienced tutor',
        'Class notes and learning materials',
        'Questions & answers during the session',
      ]),
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
        child: SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: () => setState(() => _step = 1),
            style: ElevatedButton.styleFrom(
              backgroundColor: context.accentColor,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            child: const Text(
              'Continue to booking form',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
            ),
          ),
        ),
      ),
    ];
  }

  List<Widget> _formStep(BuildContext context) {
    return [
      const StudentSectionTitle(title: 'Booking details'),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Column(
          children: [
            _field(_subjectCtrl, 'Subject (e.g. Maths, English) *'),
            const SizedBox(height: 10),
            _field(_topicCtrl, 'Topic (optional)'),
            const SizedBox(height: 10),
            _field(
              _phoneCtrl,
              'Phone / WhatsApp',
              keyboard: TextInputType.phone,
            ),
            const SizedBox(height: 10),
            _field(_timeCtrl, 'Preferred day & time'),
            const SizedBox(height: 10),
            _field(_noteCtrl, 'Any note for us', maxLines: 3),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: context.cardColor,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: context.borderColor),
              ),
              child: Text(
                'You selected ${_selected.classes} class${_selected.classes == 1 ? '' : 'es'} for ${_selected.priceLabel}. Paystack opens when you submit. After payment, Admin will contact you.',
                style: TextStyle(
                  color: context.greyColor,
                  fontSize: 12,
                  height: 1.4,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _submitting
                        ? null
                        : () => setState(() => _step = 0),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: context.accentColor,
                      side: BorderSide(color: context.accentColor),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: const Text(
                      'Back',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    onPressed: _submitting ? null : _submit,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: context.accentColor,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: _submitting
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text(
                            'Pay & submit booking',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                            ),
                          ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ];
  }

  Widget _field(
    TextEditingController ctrl,
    String hint, {
    TextInputType? keyboard,
    int maxLines = 1,
  }) {
    return TextField(
      controller: ctrl,
      keyboardType: keyboard,
      maxLines: maxLines,
      style: TextStyle(color: context.textColor),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: context.greyLColor),
        filled: true,
        fillColor: context.cardColor,
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
          borderSide: BorderSide(color: context.accentColor, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
      ),
    );
  }

  Widget _bullets(BuildContext context, List<String> items) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(
        children: items
            .map(
              (t) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.check_circle_rounded,
                      color: context.accentColor,
                      size: 18,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        t,
                        style: TextStyle(
                          color: context.textColor,
                          fontSize: 13,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}
