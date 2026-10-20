import 'package:flutter/material.dart';

import '../../../api/api_service.dart';
import '../../../services/paystack_checkout_service.dart';
import '../../../services/support_contact_service.dart';
import '../../../theme/app_theme.dart';
import '../../../widgets/student_ui.dart';

class ClassPackagesScreen extends StatelessWidget {
  const ClassPackagesScreen({
    super.key,
    this.kidsOnly = false,
    this.holidayOnly = false,
  });

  final bool kidsOnly;
  final bool holidayOnly;

  /// Exact Scholaxia packages from product pricing — same as the website
  /// and desktop app (renderer/js/class-packages.js).
  static const _kidSections = [
    _PackageSection(
      title: 'Kids Live Classes',
      plans: [
        _ClassPackage(
          id: 'single_class',
          name: 'Special Single Class',
          price: 5000,
          billing: '₦5,000 · 1 session',
          features: [
            '1 live session',
            'One-on-one tutor',
            'Class notes',
          ],
        ),
        _ClassPackage(
          id: 'nursery_school',
          name: 'Nursery School',
          price: 25000,
          billing: '₦25,000 / Month · 2 sessions weekly',
          features: [
            '2 subjects',
            '2 sessions weekly',
            'Reading & Phonics',
            'Counting & fun games',
            'Parent feedback',
          ],
        ),
        _ClassPackage(
          id: 'primary_school',
          name: 'Primary School',
          price: 25000,
          billing: '₦25,000 / Month · 3 sessions weekly',
          features: [
            '3 subjects',
            '3 sessions weekly',
            'Mathematics, English & Phonics',
            'Homework help',
            'Parent feedback',
          ],
        ),
      ],
    ),
  ];

  static const _studentSections = [
    _PackageSection(
      title: 'Single & Exam Prep',
      plans: [
        _ClassPackage(
          id: 'single_class',
          name: 'Special Single Class',
          price: 5000,
          billing: '₦5,000 · 1 session',
          features: [
            '1 live session',
            'One-on-one tutor',
            'Class notes',
            'Questions and answers',
          ],
        ),
        _ClassPackage(
          id: 'jamb_prep',
          name: 'JAMB Prep',
          price: 10000,
          billing: '₦10,000 / Month · 4 sessions weekly',
          features: [
            '4 subjects',
            '4 sessions weekly',
            'JAMB past questions & CBT drills',
            'Progress tracking',
          ],
        ),
        _ClassPackage(
          id: 'jamb_waec_neco_prep',
          name: 'JAMB + WAEC/NECO Prep',
          price: 15000,
          billing: '₦15,000 / Month · 5 sessions weekly',
          features: [
            '6 subjects',
            '5 sessions weekly',
            'JAMB, WAEC & NECO practice',
            'Mock exams',
          ],
        ),
      ],
    ),
    _PackageSection(
      title: 'Private & School Lessons',
      plans: [
        _ClassPackage(
          id: 'private_lesson',
          name: 'Private Lesson (One-on-One)',
          price: 25000,
          billing: '₦25,000 / Month · 4 sessions weekly',
          features: [
            '4 subjects',
            '4 sessions weekly',
            'Dedicated one-on-one tutor',
            'Unlimited Sia AI Tutor',
          ],
        ),
        _ClassPackage(
          id: 'primary_school',
          name: 'Primary School',
          price: 25000,
          billing: '₦25,000 / Month · 3 sessions weekly',
          features: [
            '3 subjects',
            '3 sessions weekly',
            'Mathematics, English & Phonics',
            'Parent feedback',
          ],
        ),
        _ClassPackage(
          id: 'nursery_school',
          name: 'Nursery School',
          price: 25000,
          billing: '₦25,000 / Month · 2 sessions weekly',
          features: [
            '2 subjects',
            '2 sessions weekly',
            'Reading & Phonics',
            'Parent feedback',
          ],
        ),
      ],
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final sections = kidsOnly
        ? _kidSections
        : holidayOnly
            ? _studentSections
                .where((section) =>
                    section.title.contains('Single') ||
                    section.title.contains('Prep'))
                .toList()
            : _studentSections;
    final total = sections.fold<int>(0, (sum, s) => sum + s.plans.length);

    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: AppBar(
        leading: const StudentBackButton(),
        title: Text(
          kidsOnly
              ? 'Kids class packages'
              : holidayOnly
                  ? 'Live Class Plans'
                  : 'Class packages',
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
        children: [
          Text(
            kidsOnly
                ? 'Nursery & Primary packages'
                : holidayOnly
                    ? 'Single & Exam Prep plans'
                    : 'Exam prep first, then Private & School lessons',
            style: TextStyle(
              color: context.textColor,
              fontSize: 23,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            kidsOnly
                ? '$total packages for Nursery and Primary learners.'
                : holidayOnly
                    ? 'Special Single Class, JAMB Prep and JAMB + WAEC/NECO Prep.'
                    : '$total packages — pay securely with Paystack.',
            style: TextStyle(color: context.greyColor),
          ),
          const SizedBox(height: 18),
          for (final section in sections) ...[
            Text(
              section.title,
              style: TextStyle(
                color: context.textColor,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 10),
            ...section.plans.map((plan) => _PackageCard(plan: plan)),
            const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }
}

class _PackageCard extends StatelessWidget {
  const _PackageCard({required this.plan});

  final _ClassPackage plan;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              plan.name,
              style: TextStyle(
                color: context.textColor,
                fontSize: 17,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              plan.billing,
              style: TextStyle(
                color: context.accentColor,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 12),
            ...plan.features.map(
              (feature) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    const Icon(
                      Icons.check_circle_rounded,
                      color: Color(0xFF22C55E),
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: Text(feature)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => _buy(context),
                child: Text('Pay ${plan.billing.split('·').first.trim()}'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _buy(BuildContext context) async {
    try {
      final paid = await PaystackCheckoutService.purchase(
        context: context,
        api: ApiService(),
        productType: 'class_package',
        productId: plan.id,
      );
      if (!context.mounted || !paid) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Payment confirmed. Your subscription is active — Live Class will recognize that you have paid.',
          ),
        ),
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      final message = e.message;
      final paystackMissing = message.toLowerCase().contains('paystack') &&
          message.toLowerCase().contains('not configured');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            paystackMissing
                ? 'Paystack keys are missing on the server. Chat WhatsApp to enroll meanwhile.'
                : message,
          ),
          backgroundColor: Colors.red,
          action: paystackMissing
              ? SnackBarAction(
                  label: 'WhatsApp',
                  textColor: Colors.white,
                  onPressed: SupportContactService.openWhatsApp,
                )
              : null,
        ),
      );
    }
  }
}

class _PackageSection {
  const _PackageSection({required this.title, required this.plans});

  final String title;
  final List<_ClassPackage> plans;
}

class _ClassPackage {
  const _ClassPackage({
    required this.id,
    required this.name,
    required this.price,
    required this.billing,
    required this.features,
  });

  final String id;
  final String name;
  final int price;
  final String billing;
  final List<String> features;
}
