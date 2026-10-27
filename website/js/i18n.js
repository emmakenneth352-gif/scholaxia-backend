/* ═══════════════════════════════════════════════════════════════════
   SCHOLAXIA  —  i18n + Currency  (v1.0)
   ═══════════════════════════════════════════════════════════════════
   • Supports: English (en) · French (fr) · Portuguese (pt) · Arabic (ar)
   • Arabic activates RTL on <html dir="rtl">
   • Currency toggle: USD · GBP · NGN · KES · GHS
   • All [data-i18n] elements are rewritten on language change
   • Language + currency persisted in localStorage
   ═══════════════════════════════════════════════════════════════════ */
(() => {

  /* ─────────────────────────────────────────────────────────────
     1. TRANSLATION MAP
     ───────────────────────────────────────────────────────────── */
  const T = {

    /* ── ENGLISH (default) ── */
    en: {
      currency_label: '🌍 Prices shown in:',
      nav_home: 'Home', nav_cbt: 'CBT Practice', nav_pq: 'Past questions',
      nav_exam: 'School Exam',
      nav_market: 'Marketplace', nav_affiliate: 'Affiliate',
      nav_contact: 'Contact', nav_about: 'About',
      btn_marketplace: 'Marketplace', btn_join: 'Join', btn_join_free: 'Join free',
      hero_badge: 'Now live — WAEC & JAMB 2026',
      hero_h1_a: 'Study online.',
      hero_h1_b: 'Pass with confidence.',
      exam_more: '+ more',
      hero_sub: 'Live classes, CBT practice, and Sia AI — built for students across Africa and beyond.',
      stat_students: '10,000+', stat_students_label: 'Students enrolled',
      stat_courses: '200+',    stat_courses_label: 'Courses & materials',
      stat_completion: '85%',  stat_completion_label: 'Completion rate',
      stat_rating: '4.8★',    stat_rating_label: 'Average rating',
      trust_global: 'Trusted by 10,000+ students across 20+ countries',
      kicker_about: 'About', about_h2: 'Built for modern education',
      about_p: 'Scholaxia brings every student tool into one mature platform — clear, reliable, and ready for schools and learners worldwide.',
      kicker_product: 'Product', product_h2: 'Everything students need. One platform.',
      feat_live_h: 'Live Classes',     feat_live_p: 'HD lessons with whiteboard, raise-hand, and screen share.',
      feat_cbt_h:  'CBT Exams',        feat_cbt_p:  'Timed practice, instant scoring, and clear analytics.',
      feat_ai_h:   'Sia AI Tutor',     feat_ai_p:   '24/7 homework help, explanations, and study support.',
      feat_lib_h:  'Digital Library',  feat_lib_p:  'Books, PDFs, video lessons, and smart search.',
      feat_shop_h: 'Marketplace',      feat_shop_p: 'Books & gadgets in its own shop — browse free, checkout when ready.',
      feat_cert_h: 'Certificates',     feat_cert_p: 'Auto-generate PDF certificates after CBT completion with name & score.',
      kicker_teachers: 'Our Teachers',
      teachers_h2: 'Learn from the best Scholaxia instructors',
      teachers_p: 'Seasoned experts who bring real industry experience, practical insights, and proven success directly to your screen.',
      kicker_stories: 'Stories', stories_h2: 'Trusted by students and teachers',
      q1_text: 'Scholaxia made exam practice clear and consistent. It feels serious and easy to use.',
      q1_name: 'Amaka E.',    q1_role: 'SS3 Student',          q1_loc: 'Lagos, Nigeria',
      q2_text: 'Live classes and CBT analytics help me teach with better focus every week.',
      q2_name: 'Mr. Okonkwo', q2_role: 'Physics Teacher',      q2_loc: 'Abuja, Nigeria',
      q3_text: 'Clean, mature, and complete. Students actually stay on the platform.',
      q3_name: 'Fatima B.',   q3_role: 'School Admin',          q3_loc: 'Accra, Ghana',
      q4_text: 'Sia explains hard topics fast. I study more and stress less before exams.',
      q4_name: 'Aisha M.',    q4_role: 'KCSE Candidate',        q4_loc: 'Nairobi, Kenya',
      partners_h2: 'Our Trusted Partners',
      aff_kicker: 'Earn with Scholaxia', aff_h2: 'Grow with us as an affiliate partner',
      aff_p: 'Share Scholaxia with students and schools. Earn when they join live classes, CBT practice, and skills programs.',
      aff_btn1: 'Join to get started', aff_btn2: 'Email affiliate team',
      perk1_h: 'Refer',   perk1_p: 'Students & schools',
      perk2_h: 'Earn',    perk2_p: 'On every signup',
      perk3_h: 'Support', perk3_p: 'Partner team help',
      cta_kicker: 'Start learning today',
      cta_h2: 'Ready to Pass Your Exams With Confidence?',
      cta_p: 'Join 10,000+ students across 20+ countries using Scholaxia for CBT practice, live classes and expert tutors.',
      cta_btn1: 'Explore Courses', cta_btn2: 'Download Desktop',
      dl_kicker: 'Windows app', dl_h2: 'Download Scholaxia Desktop',
      dl_p: 'Install the Scholaxia app on your PC for live classes, CBT practice, and study tools — same account as the website.',
      dl_btn: 'Download for Windows',
      footer_about: 'Scholaxia is a global learning platform helping students prepare for WAEC, NECO, JAMB, IGCSE, SAT, KCSE & BECE with CBT, live classes, AI tutoring and community support.',
      footer_links: 'Quick Links', footer_courses: 'Popular Courses',
      footer_dl: 'Download Desktop', footer_stay: 'Stay updated',
      footer_stay_p: 'Get exam tips, free materials and learning updates weekly.',
      footer_email_label: 'Email', footer_subscribe: 'Subscribe',
      footer_privacy: 'Privacy Policy', footer_terms: 'Terms of Service', footer_support: 'Support',
    },

    /* ── FRENCH ── */
    fr: {
      currency_label: '🌍 Prix affichés en :',
      nav_home: 'Accueil', nav_cbt: 'Pratique CBT', nav_pq: 'Annales',
      nav_exam: 'Examen scolaire',
      nav_market: 'Marché', nav_affiliate: 'Affiliation',
      nav_contact: 'Contact', nav_about: 'À propos',
      btn_marketplace: 'Marché', btn_join: 'Rejoindre', btn_join_free: 'Rejoindre gratuitement',
      hero_badge: 'En ligne — WAEC & JAMB 2026',
      hero_h1_a: 'Étudiez en ligne.',
      hero_h1_b: 'Réussissez avec confiance.',
      exam_more: '+ autres',
      hero_sub: 'Cours en direct, pratique CBT et Sia IA — conçus pour les élèves d\'Afrique et au-delà.',
      stat_students: '10 000+', stat_students_label: 'Élèves inscrits',
      stat_courses: '200+',    stat_courses_label: 'Cours & matériaux',
      stat_completion: '85%',  stat_completion_label: 'Taux de complétion',
      stat_rating: '4.8★',    stat_rating_label: 'Note moyenne',
      trust_global: 'Approuvé par plus de 10 000 élèves dans plus de 20 pays',
      kicker_about: 'À propos', about_h2: 'Conçu pour l\'éducation moderne',
      about_p: 'Scholaxia réunit tous les outils étudiants sur une seule plateforme mature — claire, fiable et prête pour les écoles et les apprenants du monde entier.',
      kicker_product: 'Produit', product_h2: 'Tout ce dont les élèves ont besoin. Une seule plateforme.',
      feat_live_h: 'Cours en direct',   feat_live_p: 'Leçons HD avec tableau blanc, lever la main et partage d\'écran.',
      feat_cbt_h:  'Examens CBT',       feat_cbt_p:  'Pratique chronométrée, notation instantanée et analyses claires.',
      feat_ai_h:   'Tuteur IA Sia',     feat_ai_p:   'Aide aux devoirs 24/7, explications et soutien scolaire.',
      feat_lib_h:  'Bibliothèque numérique', feat_lib_p: 'Livres, PDFs, vidéos et recherche intelligente.',
      feat_shop_h: 'Marché',            feat_shop_p: 'Livres & gadgets — parcourez gratuitement, achetez quand vous êtes prêt.',
      feat_cert_h: 'Certificats',       feat_cert_p: 'Générez automatiquement des certificats PDF après le CBT avec nom & score.',
      kicker_teachers: 'Nos Professeurs',
      teachers_h2: 'Apprenez des meilleurs instructeurs Scholaxia',
      teachers_p: 'Des experts chevronnés qui apportent une véritable expérience à votre écran.',
      kicker_stories: 'Témoignages', stories_h2: 'Approuvé par élèves et professeurs',
      q1_text: 'Scholaxia a rendu la pratique des examens claire et cohérente. C\'est sérieux et facile à utiliser.',
      q1_name: 'Amaka E.',    q1_role: 'Élève Terminale',       q1_loc: 'Lagos, Nigéria',
      q2_text: 'Les cours en direct et les analyses CBT m\'aident à enseigner avec plus de focus.',
      q2_name: 'M. Okonkwo', q2_role: 'Professeur de Physique', q2_loc: 'Abuja, Nigéria',
      q3_text: 'Propre, mature et complet. Les élèves restent vraiment sur la plateforme.',
      q3_name: 'Fatima B.',   q3_role: 'Admin Scolaire',        q3_loc: 'Accra, Ghana',
      q4_text: 'Sia explique les sujets difficiles rapidement. J\'étudie plus et stresse moins.',
      q4_name: 'Aisha M.',    q4_role: 'Candidate KCSE',        q4_loc: 'Nairobi, Kenya',
      partners_h2: 'Nos Partenaires de Confiance',
      aff_kicker: 'Gagnez avec Scholaxia', aff_h2: 'Rejoignez-nous comme partenaire affilié',
      aff_p: 'Partagez Scholaxia et gagnez quand ils rejoignent les cours, la pratique CBT et les programmes.',
      aff_btn1: 'Commencer', aff_btn2: 'Écrire à l\'équipe',
      perk1_h: 'Référer',   perk1_p: 'Élèves & écoles',
      perk2_h: 'Gagner',    perk2_p: 'À chaque inscription',
      perk3_h: 'Soutien',   perk3_p: 'Équipe partenaire',
      cta_kicker: 'Commencez à apprendre aujourd\'hui',
      cta_h2: 'Prêt à réussir vos examens avec confiance ?',
      cta_p: 'Rejoignez plus de 10 000 élèves dans plus de 20 pays qui utilisent Scholaxia.',
      cta_btn1: 'Explorer les cours', cta_btn2: 'Télécharger',
      dl_kicker: 'Application Windows', dl_h2: 'Télécharger Scholaxia Desktop',
      dl_p: 'Installez l\'application Scholaxia sur votre PC — même compte que le site.',
      dl_btn: 'Télécharger pour Windows',
      footer_about: 'Scholaxia est une plateforme mondiale d\'apprentissage pour les examens WAEC, NECO, JAMB, IGCSE, SAT, KCSE & BECE.',
      footer_links: 'Liens rapides', footer_courses: 'Cours populaires',
      footer_dl: 'Télécharger', footer_stay: 'Restez informé',
      footer_stay_p: 'Recevez des conseils d\'examen et du matériel gratuit chaque semaine.',
      footer_email_label: 'E-mail', footer_subscribe: 'S\'abonner',
      footer_privacy: 'Politique de confidentialité', footer_terms: 'Conditions d\'utilisation', footer_support: 'Assistance',
    },

    /* ── PORTUGUESE ── */
    pt: {
      currency_label: '🌍 Preços exibidos em:',
      nav_home: 'Início', nav_cbt: 'Prática CBT', nav_pq: 'Questões anteriores',
      nav_exam: 'Prova escolar',
      nav_market: 'Mercado', nav_affiliate: 'Afiliado',
      nav_contact: 'Contato', nav_about: 'Sobre',
      btn_marketplace: 'Mercado', btn_join: 'Entrar', btn_join_free: 'Entrar grátis',
      hero_badge: 'Ao vivo — WAEC & JAMB 2026',
      hero_h1_a: 'Estude online.',
      hero_h1_b: 'Passe com confiança.',
      exam_more: '+ mais',
      hero_sub: 'Aulas ao vivo, prática CBT e IA Sia — criados para estudantes em toda a África e além.',
      stat_students: '10.000+', stat_students_label: 'Alunos matriculados',
      stat_courses: '200+',     stat_courses_label: 'Cursos & materiais',
      stat_completion: '85%',   stat_completion_label: 'Taxa de conclusão',
      stat_rating: '4.8★',     stat_rating_label: 'Avaliação média',
      trust_global: 'Confiado por mais de 10.000 alunos em mais de 20 países',
      kicker_about: 'Sobre', about_h2: 'Construído para a educação moderna',
      about_p: 'O Scholaxia reúne todas as ferramentas do estudante numa plataforma madura — clara, confiável e pronta para escolas e alunos em todo o mundo.',
      kicker_product: 'Produto', product_h2: 'Tudo que os alunos precisam. Uma plataforma.',
      feat_live_h: 'Aulas ao Vivo',      feat_live_p: 'Lições em HD com quadro branco, levantar mão e compartilhar tela.',
      feat_cbt_h:  'Exames CBT',         feat_cbt_p:  'Prática cronometrada, pontuação instantânea e análises claras.',
      feat_ai_h:   'Tutor IA Sia',       feat_ai_p:   'Ajuda com tarefas 24/7, explicações e suporte aos estudos.',
      feat_lib_h:  'Biblioteca Digital', feat_lib_p:  'Livros, PDFs, vídeos e pesquisa inteligente.',
      feat_shop_h: 'Mercado',            feat_shop_p: 'Livros & gadgets — navegue grátis, compre quando estiver pronto.',
      feat_cert_h: 'Certificados',       feat_cert_p: 'Gere certificados PDF automaticamente após o CBT com nome e pontuação.',
      kicker_teachers: 'Nossos Professores',
      teachers_h2: 'Aprenda com os melhores instrutores Scholaxia',
      teachers_p: 'Especialistas experientes que trazem experiência real diretamente para a sua tela.',
      kicker_stories: 'Histórias', stories_h2: 'Confiado por alunos e professores',
      q1_text: 'O Scholaxia tornou a prática dos exames clara e consistente. Parece sério e fácil de usar.',
      q1_name: 'Amaka E.',    q1_role: 'Aluna do 3º Ano',       q1_loc: 'Lagos, Nigéria',
      q2_text: 'As aulas ao vivo e as análises CBT me ajudam a ensinar com mais foco.',
      q2_name: 'Sr. Okonkwo', q2_role: 'Professor de Física',   q2_loc: 'Abuja, Nigéria',
      q3_text: 'Limpo, maduro e completo. Os alunos realmente ficam na plataforma.',
      q3_name: 'Fatima B.',   q3_role: 'Diretora Escolar',      q3_loc: 'Accra, Gana',
      q4_text: 'O Sia explica tópicos difíceis rapidamente. Estudo mais e estressa menos.',
      q4_name: 'Aisha M.',    q4_role: 'Candidata KCSE',        q4_loc: 'Nairobi, Quénia',
      partners_h2: 'Nossos Parceiros de Confiança',
      aff_kicker: 'Ganhe com Scholaxia', aff_h2: 'Cresça conosco como parceiro afiliado',
      aff_p: 'Compartilhe o Scholaxia e ganhe quando aderirem às aulas, CBT e programas.',
      aff_btn1: 'Começar agora', aff_btn2: 'Enviar e-mail à equipa',
      perk1_h: 'Indicar',  perk1_p: 'Alunos & escolas',
      perk2_h: 'Ganhar',   perk2_p: 'A cada inscrição',
      perk3_h: 'Suporte',  perk3_p: 'Equipa de parceiros',
      cta_kicker: 'Comece a aprender hoje',
      cta_h2: 'Pronto para passar nos seus exames com confiança?',
      cta_p: 'Junte-se a mais de 10.000 alunos em mais de 20 países que usam o Scholaxia.',
      cta_btn1: 'Explorar Cursos', cta_btn2: 'Baixar Desktop',
      dl_kicker: 'App Windows', dl_h2: 'Baixar Scholaxia Desktop',
      dl_p: 'Instale o app Scholaxia no seu PC — mesma conta do site.',
      dl_btn: 'Baixar para Windows',
      footer_about: 'O Scholaxia é uma plataforma de aprendizagem global para os exames WAEC, NECO, JAMB, IGCSE, SAT, KCSE & BECE.',
      footer_links: 'Links rápidos', footer_courses: 'Cursos populares',
      footer_dl: 'Baixar Desktop', footer_stay: 'Fique atualizado',
      footer_stay_p: 'Receba dicas de exames e materiais gratuitos toda semana.',
      footer_email_label: 'E-mail', footer_subscribe: 'Subscrever',
      footer_privacy: 'Política de Privacidade', footer_terms: 'Termos de Serviço', footer_support: 'Suporte',
    },

    /* ── ARABIC ── */
    ar: {
      currency_label: '🌍 الأسعار المعروضة بـ:',
      nav_home: 'الرئيسية', nav_cbt: 'تدريب CBT', nav_pq: 'أسئلة سابقة',
      nav_exam: 'امتحان مدرسي',
      nav_market: 'السوق', nav_affiliate: 'الشراكة',
      nav_contact: 'اتصل بنا', nav_about: 'حول',
      btn_marketplace: 'السوق', btn_join: 'انضم', btn_join_free: 'انضم مجاناً',
      hero_badge: 'مباشر الآن — WAEC & JAMB 2026',
      hero_h1_a: 'ادرس عبر الإنترنت.',
      hero_h1_b: 'انجح بثقة.',
      exam_more: '+ المزيد',
      hero_sub: 'دروس مباشرة، تدريب CBT، وذكاء اصطناعي Sia — مصمم للطلاب في أفريقيا وما وراءها.',
      stat_students: '+10,000', stat_students_label: 'طالب مسجل',
      stat_courses: '+200',     stat_courses_label: 'دورات ومواد',
      stat_completion: '85%',   stat_completion_label: 'معدل الإتمام',
      stat_rating: '4.8★',     stat_rating_label: 'متوسط التقييم',
      trust_global: 'موثوق به من قبل أكثر من 10,000 طالب في أكثر من 20 دولة',
      kicker_about: 'حول', about_h2: 'مصمم للتعليم الحديث',
      about_p: 'يجمع Scholaxia كل أدوات الطالب في منصة واحدة متكاملة — واضحة وموثوقة وجاهزة للمدارس والمتعلمين حول العالم.',
      kicker_product: 'المنتج', product_h2: 'كل ما يحتاجه الطلاب. منصة واحدة.',
      feat_live_h: 'الفصول المباشرة',   feat_live_p: 'دروس بجودة عالية مع السبورة البيضاء ورفع اليد ومشاركة الشاشة.',
      feat_cbt_h:  'امتحانات CBT',       feat_cbt_p:  'تدريب بتوقيت، تصحيح فوري، وتحليلات واضحة.',
      feat_ai_h:   'مدرس Sia الذكي',    feat_ai_p:   'مساعدة في الواجبات 24/7 وشرح وافٍ.',
      feat_lib_h:  'المكتبة الرقمية',   feat_lib_p:  'كتب، ملفات PDF، دروس مرئية وبحث ذكي.',
      feat_shop_h: 'السوق',              feat_shop_p: 'كتب وأجهزة — تصفح مجاناً وادفع عند الاستعداد.',
      feat_cert_h: 'الشهادات',           feat_cert_p: 'إصدار شهادات PDF تلقائياً بعد اكتمال CBT مع الاسم والدرجة.',
      kicker_teachers: 'معلمونا',
      teachers_h2: 'تعلم من أفضل مدرسي Scholaxia',
      teachers_p: 'خبراء متمرسون يجلبون خبرة صناعية حقيقية مباشرة إلى شاشتك.',
      kicker_stories: 'قصص', stories_h2: 'موثوق به من الطلاب والمعلمين',
      q1_text: 'جعل Scholaxia التدريب على الامتحانات واضحاً ومتسقاً. يبدو جاداً وسهل الاستخدام.',
      q1_name: 'أماكا إي',   q1_role: 'طالبة ثانوية',          q1_loc: 'لاغوس، نيجيريا',
      q2_text: 'تساعدني الدروس المباشرة وتحليلات CBT على التدريس بتركيز أفضل.',
      q2_name: 'أ. أوكونكو', q2_role: 'مدرس فيزياء',            q2_loc: 'أبوجا، نيجيريا',
      q3_text: 'نظيف، ناضج، ومتكامل. الطلاب يبقون فعلاً على المنصة.',
      q3_name: 'فاطمة ب.',   q3_role: 'مديرة مدرسة',            q3_loc: 'أكرا، غانا',
      q4_text: 'يشرح Sia المواضيع الصعبة بسرعة. أدرس أكثر وأقل توتراً.',
      q4_name: 'عائشة م.',   q4_role: 'مرشحة KCSE',             q4_loc: 'نيروبي، كينيا',
      partners_h2: 'شركاؤنا الموثوقون',
      aff_kicker: 'اكسب مع Scholaxia', aff_h2: 'انمُ معنا كشريك تابع',
      aff_p: 'شارك Scholaxia مع الطلاب والمدارس واكسب عندما ينضمون.',
      aff_btn1: 'ابدأ الآن', aff_btn2: 'راسل الفريق',
      perk1_h: 'رشّح',   perk1_p: 'طلاب ومدارس',
      perk2_h: 'اكسب',   perk2_p: 'مع كل تسجيل',
      perk3_h: 'دعم',    perk3_p: 'فريق الشراكة',
      cta_kicker: 'ابدأ التعلم اليوم',
      cta_h2: 'هل أنت مستعد للنجاح في امتحاناتك بثقة؟',
      cta_p: 'انضم إلى أكثر من 10,000 طالب في أكثر من 20 دولة يستخدمون Scholaxia.',
      cta_btn1: 'استكشف الدورات', cta_btn2: 'تحميل التطبيق',
      dl_kicker: 'تطبيق Windows', dl_h2: 'تحميل Scholaxia Desktop',
      dl_p: 'ثبّت تطبيق Scholaxia على جهاز الكمبيوتر — نفس الحساب كالموقع.',
      dl_btn: 'تحميل لـ Windows',
      footer_about: 'Scholaxia منصة تعليمية عالمية لامتحانات WAEC وNECO وJAMB وIGCSE وSAT وKCSE وBECE.',
      footer_links: 'روابط سريعة', footer_courses: 'الدورات الشائعة',
      footer_dl: 'تحميل Desktop', footer_stay: 'ابق على اطلاع',
      footer_stay_p: 'احصل على نصائح الامتحانات ومواد مجانية كل أسبوع.',
      footer_email_label: 'البريد الإلكتروني', footer_subscribe: 'اشترك',
      footer_privacy: 'سياسة الخصوصية', footer_terms: 'شروط الخدمة', footer_support: 'الدعم',
    },
  };

  /* ─────────────────────────────────────────────────────────────
     2. LANGUAGE ENGINE
     ───────────────────────────────────────────────────────────── */
  const LANG_META = {
    en: { flag: '🇬🇧', label: 'EN', dir: 'ltr' },
    fr: { flag: '🇫🇷', label: 'FR', dir: 'ltr' },
    pt: { flag: '🇧🇷', label: 'PT', dir: 'ltr' },
    ar: { flag: '🇸🇦', label: 'AR', dir: 'rtl' },
  };

  let currentLang = localStorage.getItem('sx_lang') || 'en';

  /*
   * Shared application labels. Dashboard pages predate data-i18n, so this
   * exact-text map also translates their static and dynamically-rendered UI.
   * English/French/Portuguese/Arabic are the only supported languages.
   */
  const UI_TEXT = {
    fr: {
      'Home':'Accueil','Video Tutorials':'Tutoriels vidéo','Past Questions':'Annales',
      'My CBT':'Mon CBT','CBT Practice':'Pratique CBT','Examinations':'Examens',
      'Scholaxia Exam':'Examen Scholaxia','Live Class':'Cours en direct',
      'Live Classes':'Cours en direct','Subscription':'Abonnement','Skills':'Compétences',
      'Library':'Bibliothèque','Games':'Jeux','Assignments':'Devoirs','Tutor AI':'Tuteur IA',
      'Teacher AI':'IA enseignant','Community':'Communauté','Groups':'Groupes',
      'Saved':'Enregistrés','About':'À propos','Contact':'Contact','Profile':'Profil',
      'Log out':'Déconnexion','Welcome back':'Bon retour','Practice Exam':'Examen pratique',
      'Your exam':'Votre examen','Your subjects':'Vos matières','Timed mode':'Mode chronométré',
      'Start CBT Practice →':'Commencer le CBT →','View subscriptions →':'Voir les abonnements →',
      'Teacher studio':'Espace enseignant','Materials':'Supports','Exams':'Examens',
      'Students':'Élèves','Grading':'Notation','Broadcast':'Diffusion','Host a class':'Créer un cours',
      'Live now':'En direct','Upcoming':'À venir','Public':'Public','Private':'Privé',
      'School group':'Groupe scolaire','Title':'Titre','Subject':'Matière','Date':'Date',
      'Start':'Début','End':'Fin','Kid Safe Zone':'Zone sécurisée enfants','Kids':'Enfants',
      'Kid Safe':'Sécurisé','Quick access':'Accès rapide','Videos':'Vidéos',
      'Shop':'Boutique','Learning home':'Accueil apprentissage','My orders':'Mes commandes',
      'Cart':'Panier','Join':'Rejoindre','Shop the shelf':'Voir la boutique',
      'For sellers':'Pour les vendeurs','Start your store':'Créez votre boutique',
      'Sell as a vendor':'Vendre','Find what you need':'Trouvez ce qu’il vous faut',
      'Loading products…':'Chargement des produits…','Your cart':'Votre panier',
      'Total':'Total','Checkout & pay':'Commander et payer','Buyer signup':'Inscription acheteur',
      'Vendor signup':'Inscription vendeur','Buyer or vendor?':'Acheteur ou vendeur ?',
      'Buyer':'Acheteur','Vendor':'Vendeur','Delivery details':'Détails de livraison',
      'Delivery address':'Adresse de livraison','Contact phone':'Téléphone',
      'Pay with Paystack':'Payer avec Paystack','← Back to home':'← Retour à l’accueil',
      'Welcome back':'Bon retour','Sign in to your account':'Connectez-vous à votre compte',
      'Student':'Élève','Teacher':'Enseignant','Kid':'Enfant','Log in':'Connexion',
      'Sign up':'Inscription','Email':'E-mail','Password':'Mot de passe','New here?':'Nouveau ?',
      'Create an account':'Créer un compte','Full name':'Nom complet','Age group':'Tranche d’âge',
      'Create account':'Créer le compte','Already have an account?':'Vous avez déjà un compte ?',
      'Forgot password?':'Mot de passe oublié ?','Phone number':'Téléphone','Location':'Lieu',
      'Marketplace':'Marché','Sign in':'Connexion','Past Questions Marketplace':'Marché des annales',
      'Prepare smarter. Practice better. Pass with confidence.':'Préparez-vous mieux. Entraînez-vous davantage. Réussissez avec confiance.',
      'Get authentic JAMB, WAEC, NECO and Common Entrance past questions in one place.':'Obtenez de vraies annales JAMB, WAEC, NECO et Common Entrance au même endroit.',
      'Search past questions':'Rechercher des annales','Search':'Rechercher',
      'Search Mathematics, English, Biology, 2025…':'Rechercher Maths, Anglais, Biologie, 2025…',
      'Instant PDF access':'Accès PDF immédiat','Secure Paystack payment':'Paiement Paystack sécurisé',
      'No account required':'Aucun compte requis','Find the right past questions':'Trouvez les bonnes annales',
      'Loading catalog…':'Chargement du catalogue…','Exam':'Examen','All exams':'Tous les examens',
      'All subjects':'Toutes les matières','All years':'Toutes les années','Sort by':'Trier par',
      'Latest':'Plus récent','Price: low to high':'Prix : croissant','Price: high to low':'Prix : décroissant',
      'Title A–Z':'Titre A–Z','Loading past questions…':'Chargement des annales…',
      'Why buy from Scholaxia?':'Pourquoi acheter chez Scholaxia ?','Authentic Materials':'Matériel authentique',
      'Get organized past questions in PDF format, ready for revision.':'Annales organisées en PDF, prêtes pour réviser.',
      'Instant Access':'Accès immédiat','Download immediately after a successful Paystack payment.':'Téléchargez juste après un paiement Paystack réussi.',
      'Secure Payment':'Paiement sécurisé','Payments are securely processed through Paystack — no account needed.':'Paiements sécurisés via Paystack — aucun compte requis.',
      'Multiple Exams':'Plusieurs examens','JAMB, WAEC, NECO and Common Entrance in one marketplace.':'JAMB, WAEC, NECO et Common Entrance au même endroit.',
      'Study better. Score higher. Past questions are the best way to prepare for your exams.':'Étudiez mieux. Obtenez de meilleurs scores. Les annales sont le meilleur moyen de se préparer.',
      'Browse Papers':'Parcourir les sujets','Explore':'Explorer','Need help?':'Besoin d’aide ?',
      'Helping Nigerian students prepare smarter with past questions, CBT practice and live classes.':'Nous aidons les élèves à mieux se préparer avec les annales, le CBT et les cours en direct.',
      'Paystack-secured checkout. No student account required to buy.':'Paiement sécurisé Paystack. Aucun compte élève requis.',
      '© 2026 Scholaxia. All rights reserved.':'© 2026 Scholaxia. Tous droits réservés.','Built for students':'Conçu pour les élèves',
      'All':'Tous','Common Entrance':'Common Entrance','Buy Now →':'Acheter →',
      'Could not load the catalog.':'Impossible de charger le catalogue.','1 paper available':'1 sujet disponible',
      'Unable to load past questions':'Impossible de charger les annales','Please try again in a moment.':'Réessayez dans un instant.',
      'Try Again':'Réessayer','No past questions available yet':'Aucune annale disponible pour le moment',
      'New JAMB, WAEC, NECO and Common Entrance papers will appear here.':'De nouveaux sujets JAMB, WAEC, NECO et Common Entrance apparaîtront ici.',
      'Email for receipt & download link':'E-mail pour le reçu et le lien de téléchargement',
      'Full name (optional)':'Nom complet (facultatif)','Your name':'Votre nom',
      'Redirecting to Paystack…':'Redirection vers Paystack…','Enter your email.':'Saisissez votre e-mail.',
      'Payment could not start. Please try again.':'Le paiement n’a pas pu démarrer. Réessayez.',
      'Verifying payment…':'Vérification du paiement…','Download PDF':'Télécharger le PDF',
      'Payment successful.':'Paiement réussi.','Your PDF is unlocked.':'Votre PDF est débloqué.',
      'Save this link — it works with the email you paid with.':'Enregistrez ce lien — il fonctionne avec l’e-mail utilisé pour le paiement.',
      'Payment recorded, but download token was not ready. Refresh in a moment.':'Paiement enregistré, mais le lien n’est pas encore prêt. Actualisez dans un instant.',
      'Unable to verify payment.':'Impossible de vérifier le paiement.',
      'If you were charged, use the same email to recover access or contact support.':'Si vous avez été débité, utilisez le même e-mail pour récupérer l’accès ou contactez le support.'
    },
    pt: {
      'Home':'Início','Video Tutorials':'Tutoriais em vídeo','Past Questions':'Provas anteriores',
      'My CBT':'Meu CBT','CBT Practice':'Prática CBT','Examinations':'Exames',
      'Scholaxia Exam':'Exame Scholaxia','Live Class':'Aula ao vivo','Live Classes':'Aulas ao vivo',
      'Subscription':'Assinatura','Skills':'Competências','Library':'Biblioteca','Games':'Jogos',
      'Assignments':'Tarefas','Tutor AI':'Tutor IA','Teacher AI':'IA do professor',
      'Community':'Comunidade','Groups':'Grupos','Saved':'Guardados','About':'Sobre',
      'Contact':'Contacto','Profile':'Perfil','Log out':'Sair','Welcome back':'Bem-vindo de volta',
      'Practice Exam':'Exame prático','Your exam':'Seu exame','Your subjects':'Suas disciplinas',
      'Timed mode':'Modo cronometrado','Start CBT Practice →':'Iniciar prática CBT →',
      'View subscriptions →':'Ver assinaturas →','Teacher studio':'Estúdio do professor',
      'Materials':'Materiais','Exams':'Exames','Students':'Alunos','Grading':'Avaliação',
      'Broadcast':'Transmissão','Host a class':'Criar uma aula','Live now':'Ao vivo',
      'Upcoming':'Próximas','Public':'Pública','Private':'Privada','School group':'Grupo escolar',
      'Title':'Título','Subject':'Disciplina','Date':'Data','Start':'Início','End':'Fim',
      'Kid Safe Zone':'Zona segura infantil','Kids':'Crianças','Kid Safe':'Seguro para crianças',
      'Quick access':'Acesso rápido','Videos':'Vídeos','Shop':'Loja',
      'Learning home':'Página de aprendizagem','My orders':'Meus pedidos','Cart':'Carrinho',
      'Join':'Entrar','Shop the shelf':'Comprar agora','For sellers':'Para vendedores',
      'Start your store':'Crie sua loja','Sell as a vendor':'Vender','Find what you need':'Encontre o que precisa',
      'Loading products…':'Carregando produtos…','Your cart':'Seu carrinho','Total':'Total',
      'Checkout & pay':'Finalizar e pagar','Buyer signup':'Cadastro de comprador',
      'Vendor signup':'Cadastro de vendedor','Buyer or vendor?':'Comprador ou vendedor?',
      'Buyer':'Comprador','Vendor':'Vendedor','Delivery details':'Dados de entrega',
      'Delivery address':'Endereço de entrega','Contact phone':'Telefone',
      'Pay with Paystack':'Pagar com Paystack','← Back to home':'← Voltar ao início',
      'Welcome back':'Bem-vindo de volta','Sign in to your account':'Entre na sua conta',
      'Student':'Aluno','Teacher':'Professor','Kid':'Criança','Log in':'Entrar','Sign up':'Cadastrar',
      'Email':'E-mail','Password':'Senha','New here?':'Novo aqui?','Create an account':'Criar conta',
      'Full name':'Nome completo','Age group':'Faixa etária','Create account':'Criar conta',
      'Already have an account?':'Já tem uma conta?',      'Forgot password?':'Esqueceu a senha?',
      'Phone number':'Telefone','Location':'Localização',
      'Marketplace':'Mercado','Sign in':'Entrar','Past Questions Marketplace':'Mercado de provas anteriores',
      'Prepare smarter. Practice better. Pass with confidence.':'Prepare-se melhor. Pratique mais. Passe com confiança.',
      'Get authentic JAMB, WAEC, NECO and Common Entrance past questions in one place.':'Obtenha provas autênticas de JAMB, WAEC, NECO e Common Entrance num só lugar.',
      'Search past questions':'Pesquisar provas anteriores','Search':'Pesquisar',
      'Search Mathematics, English, Biology, 2025…':'Pesquisar Matemática, Inglês, Biologia, 2025…',
      'Instant PDF access':'Acesso imediato ao PDF','Secure Paystack payment':'Pagamento seguro Paystack',
      'No account required':'Não precisa de conta','Find the right past questions':'Encontre as provas certas',
      'Loading catalog…':'Carregando catálogo…','Exam':'Exame','All exams':'Todos os exames',
      'All subjects':'Todas as disciplinas','All years':'Todos os anos','Sort by':'Ordenar por',
      'Latest':'Mais recentes','Price: low to high':'Preço: menor para maior','Price: high to low':'Preço: maior para menor',
      'Title A–Z':'Título A–Z','Loading past questions…':'Carregando provas anteriores…',
      'Why buy from Scholaxia?':'Por que comprar na Scholaxia?','Authentic Materials':'Materiais autênticos',
      'Get organized past questions in PDF format, ready for revision.':'Provas organizadas em PDF, prontas para revisão.',
      'Instant Access':'Acesso imediato','Download immediately after a successful Paystack payment.':'Baixe imediatamente após o pagamento Paystack.',
      'Secure Payment':'Pagamento seguro','Payments are securely processed through Paystack — no account needed.':'Pagamentos seguros via Paystack — sem conta.',
      'Multiple Exams':'Vários exames','JAMB, WAEC, NECO and Common Entrance in one marketplace.':'JAMB, WAEC, NECO e Common Entrance num só mercado.',
      'Study better. Score higher. Past questions are the best way to prepare for your exams.':'Estude melhor. Tire notas mais altas. As provas anteriores são a melhor forma de se preparar.',
      'Browse Papers':'Ver provas','Explore':'Explorar','Need help?':'Precisa de ajuda?',
      'Helping Nigerian students prepare smarter with past questions, CBT practice and live classes.':'Ajudamos alunos a se prepararem melhor com provas anteriores, CBT e aulas ao vivo.',
      'Paystack-secured checkout. No student account required to buy.':'Checkout seguro Paystack. Não precisa de conta de aluno.',
      '© 2026 Scholaxia. All rights reserved.':'© 2026 Scholaxia. Todos os direitos reservados.','Built for students':'Feito para alunos',
      'All':'Todos','Common Entrance':'Common Entrance','Buy Now →':'Comprar agora →',
      'Could not load the catalog.':'Não foi possível carregar o catálogo.','1 paper available':'1 prova disponível',
      'Unable to load past questions':'Não foi possível carregar as provas','Please try again in a moment.':'Tente novamente em instantes.',
      'Try Again':'Tentar novamente','No past questions available yet':'Ainda não há provas disponíveis',
      'New JAMB, WAEC, NECO and Common Entrance papers will appear here.':'Novas provas de JAMB, WAEC, NECO e Common Entrance aparecerão aqui.',
      'Email for receipt & download link':'E-mail para o recibo e o link de download',
      'Full name (optional)':'Nome completo (opcional)','Your name':'Seu nome',
      'Redirecting to Paystack…':'Redirecionando para o Paystack…','Enter your email.':'Digite seu e-mail.',
      'Payment could not start. Please try again.':'O pagamento não pôde iniciar. Tente novamente.',
      'Verifying payment…':'Verificando pagamento…','Download PDF':'Baixar PDF',
      'Payment successful.':'Pagamento concluído.','Your PDF is unlocked.':'Seu PDF está liberado.',
      'Save this link — it works with the email you paid with.':'Guarde este link — funciona com o e-mail usado no pagamento.',
      'Payment recorded, but download token was not ready. Refresh in a moment.':'Pagamento registado, mas o link ainda não está pronto. Atualize em instantes.',
      'Unable to verify payment.':'Não foi possível verificar o pagamento.',
      'If you were charged, use the same email to recover access or contact support.':'Se foi cobrado, use o mesmo e-mail para recuperar o acesso ou contacte o suporte.'
    },
    ar: {
      'Home':'الرئيسية','Video Tutorials':'دروس الفيديو','Past Questions':'أسئلة سابقة',
      'My CBT':'اختباراتي','CBT Practice':'تدريب CBT','Examinations':'الامتحانات',
      'Scholaxia Exam':'امتحان Scholaxia','Live Class':'الحصة المباشرة',
      'Live Classes':'الحصص المباشرة','Subscription':'الاشتراك','Skills':'المهارات',
      'Library':'المكتبة','Games':'الألعاب','Assignments':'الواجبات','Tutor AI':'المعلم الذكي',
      'Teacher AI':'ذكاء المعلم','Community':'المجتمع','Groups':'المجموعات',
      'Saved':'المحفوظات','About':'حول','Contact':'اتصل بنا','Profile':'الملف الشخصي',
      'Log out':'تسجيل الخروج','Welcome back':'مرحباً بعودتك','Practice Exam':'اختبار تدريبي',
      'Your exam':'امتحانك','Your subjects':'موادك','Timed mode':'وضع مؤقت',
      'Start CBT Practice →':'ابدأ تدريب CBT ←','View subscriptions →':'عرض الاشتراكات ←',
      'Teacher studio':'استوديو المعلم','Materials':'المواد','Exams':'الامتحانات',
      'Students':'الطلاب','Grading':'التصحيح','Broadcast':'البث','Host a class':'أنشئ حصة',
      'Live now':'مباشر الآن','Upcoming':'قادمة','Public':'عام','Private':'خاص',
      'School group':'مجموعة مدرسية','Title':'العنوان','Subject':'المادة','Date':'التاريخ',
      'Start':'البداية','End':'النهاية','Kid Safe Zone':'منطقة آمنة للأطفال','Kids':'الأطفال',
      'Kid Safe':'آمن للأطفال','Quick access':'وصول سريع','Videos':'فيديوهات',
      'Shop':'تسوق','Learning home':'صفحة التعلم','My orders':'طلباتي','Cart':'السلة',
      'Join':'انضم','Shop the shelf':'تسوق الآن','For sellers':'للبائعين',
      'Start your store':'ابدأ متجرك','Sell as a vendor':'بع كبائع','Find what you need':'ابحث عما تحتاجه',
      'Loading products…':'جارٍ تحميل المنتجات…','Your cart':'سلتك','Total':'الإجمالي',
      'Checkout & pay':'الدفع وإتمام الطلب','Buyer signup':'تسجيل مشتري',
      'Vendor signup':'تسجيل بائع','Buyer or vendor?':'مشتري أم بائع؟','Buyer':'مشتري',
      'Vendor':'بائع','Delivery details':'بيانات التوصيل','Delivery address':'عنوان التوصيل',
      'Contact phone':'رقم الهاتف','Pay with Paystack':'الدفع عبر Paystack',
      '← Back to home':'العودة للرئيسية →','Welcome back':'مرحباً بعودتك',
      'Sign in to your account':'سجل الدخول إلى حسابك','Student':'طالب','Teacher':'معلم',
      'Kid':'طفل','Log in':'تسجيل الدخول','Sign up':'إنشاء حساب','Email':'البريد الإلكتروني',
      'Password':'كلمة المرور','New here?':'جديد هنا؟','Create an account':'إنشاء حساب',
      'Full name':'الاسم الكامل','Age group':'الفئة العمرية','Create account':'إنشاء الحساب',
      'Already have an account?':'لديك حساب بالفعل؟',      'Forgot password?':'نسيت كلمة المرور؟',
      'Phone number':'رقم الهاتف','Location':'الموقع',
      'Marketplace':'السوق','Sign in':'تسجيل الدخول','Past Questions Marketplace':'سوق الأسئلة السابقة',
      'Prepare smarter. Practice better. Pass with confidence.':'استعد بذكاء. تدرب بشكل أفضل. انجح بثقة.',
      'Get authentic JAMB, WAEC, NECO and Common Entrance past questions in one place.':'احصل على أسئلة JAMB وWAEC وNECO وCommon Entrance الأصلية في مكان واحد.',
      'Search past questions':'ابحث في الأسئلة السابقة','Search':'بحث',
      'Search Mathematics, English, Biology, 2025…':'ابحث عن الرياضيات، الإنجليزية، الأحياء، 2025…',
      'Instant PDF access':'وصول فوري لملف PDF','Secure Paystack payment':'دفع آمن عبر Paystack',
      'No account required':'لا حاجة لحساب','Find the right past questions':'اعثر على الأسئلة المناسبة',
      'Loading catalog…':'جارٍ تحميل الكتالوج…','Exam':'الامتحان','All exams':'كل الامتحانات',
      'All subjects':'كل المواد','All years':'كل السنوات','Sort by':'ترتيب حسب',
      'Latest':'الأحدث','Price: low to high':'السعر: من الأقل للأعلى','Price: high to low':'السعر: من الأعلى للأقل',
      'Title A–Z':'العنوان أ–ي','Loading past questions…':'جارٍ تحميل الأسئلة السابقة…',
      'Why buy from Scholaxia?':'لماذا تشتري من Scholaxia؟','Authentic Materials':'مواد أصلية',
      'Get organized past questions in PDF format, ready for revision.':'أسئلة سابقة منظمة بصيغة PDF وجاهزة للمراجعة.',
      'Instant Access':'وصول فوري','Download immediately after a successful Paystack payment.':'حمّل مباشرة بعد نجاح الدفع عبر Paystack.',
      'Secure Payment':'دفع آمن','Payments are securely processed through Paystack — no account needed.':'تتم المدفوعات بأمان عبر Paystack — دون حاجة لحساب.',
      'Multiple Exams':'امتحانات متعددة','JAMB, WAEC, NECO and Common Entrance in one marketplace.':'JAMB وWAEC وNECO وCommon Entrance في سوق واحد.',
      'Study better. Score higher. Past questions are the best way to prepare for your exams.':'ادرس بشكل أفضل. احصل على درجات أعلى. الأسئلة السابقة أفضل طريقة للاستعداد.',
      'Browse Papers':'تصفح الأوراق','Explore':'استكشف','Need help?':'تحتاج مساعدة؟',
      'Helping Nigerian students prepare smarter with past questions, CBT practice and live classes.':'نساعد الطلاب على الاستعداد بذكاء عبر الأسئلة السابقة وتدريب CBT والدروس المباشرة.',
      'Paystack-secured checkout. No student account required to buy.':'دفع آمن عبر Paystack. لا حاجة لحساب طالب للشراء.',
      '© 2026 Scholaxia. All rights reserved.':'© 2026 Scholaxia. جميع الحقوق محفوظة.','Built for students':'مصمم للطلاب',
      'All':'الكل','Common Entrance':'Common Entrance','Buy Now →':'اشترِ الآن ←',
      'Could not load the catalog.':'تعذر تحميل الكتالوج.','1 paper available':'ورقة واحدة متاحة',
      'Unable to load past questions':'تعذر تحميل الأسئلة السابقة','Please try again in a moment.':'حاول مرة أخرى بعد قليل.',
      'Try Again':'حاول مرة أخرى','No past questions available yet':'لا توجد أسئلة سابقة بعد',
      'New JAMB, WAEC, NECO and Common Entrance papers will appear here.':'ستظهر هنا أوراق JAMB وWAEC وNECO وCommon Entrance الجديدة.',
      'Email for receipt & download link':'البريد الإلكتروني للإيصال ورابط التحميل',
      'Full name (optional)':'الاسم الكامل (اختياري)','Your name':'اسمك',
      'Redirecting to Paystack…':'جارٍ التحويل إلى Paystack…','Enter your email.':'أدخل بريدك الإلكتروني.',
      'Payment could not start. Please try again.':'تعذر بدء الدفع. حاول مرة أخرى.',
      'Verifying payment…':'جارٍ التحقق من الدفع…','Download PDF':'تحميل PDF',
      'Payment successful.':'تم الدفع بنجاح.','Your PDF is unlocked.':'تم فتح ملف PDF.',
      'Save this link — it works with the email you paid with.':'احفظ هذا الرابط — يعمل مع البريد الذي دفعت به.',
      'Payment recorded, but download token was not ready. Refresh in a moment.':'تم تسجيل الدفع، لكن رابط التحميل غير جاهز بعد. حدّث الصفحة بعد قليل.',
      'Unable to verify payment.':'تعذر التحقق من الدفع.',
      'If you were charged, use the same email to recover access or contact support.':'إذا تم الخصم، استخدم نفس البريد لاستعادة الوصول أو تواصل مع الدعم.'
    }
  };

  function rememberEnglishText(root) {
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || /SCRIPT|STYLE|TEXTAREA/.test(node.parentElement.tagName)) continue;
      if (node.parentElement.closest('[data-i18n]')) continue;
      const raw = node.nodeValue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (!node.__sxEnglish) node.__sxEnglish = trimmed;
    }
  }

  function translateApplicationText(lang, root) {
    rememberEnglishText(root || document.body);
    const dict = UI_TEXT[lang] || {};
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || /SCRIPT|STYLE|TEXTAREA/.test(node.parentElement.tagName)) continue;
      if (node.parentElement.closest('[data-i18n]')) continue;
      const english = node.__sxEnglish;
      if (!english) continue;
      let replacement = lang === 'en' ? english : dict[english];
      if (!replacement && lang !== 'en') {
        const papers = english.match(/^(\d+) papers available$/);
        if (papers) {
          replacement = {
            fr: papers[1] + ' documents disponibles',
            pt: papers[1] + ' provas disponíveis',
            ar: papers[1] + ' ورقة متاحة',
          }[lang];
        } else if (/^\d{4} Past Questions$/.test(english)) {
          const year = english.slice(0, 4);
          replacement = {
            fr: year + ' Annales',
            pt: year + ' Provas anteriores',
            ar: year + ' أسئلة سابقة',
          }[lang];
        }
      }
      if (!replacement) continue;
      const leading = (node.nodeValue.match(/^\s*/) || [''])[0];
      const trailing = (node.nodeValue.match(/\s*$/) || [''])[0];
      node.nodeValue = leading + replacement + trailing;
    }
    document.querySelectorAll('[placeholder]').forEach(el => {
      if (!el.dataset.sxEnglishPlaceholder) el.dataset.sxEnglishPlaceholder = el.placeholder;
      const english = el.dataset.sxEnglishPlaceholder;
      el.placeholder = lang === 'en' ? english : (dict[english] || english);
    });
  }

  function ensureCompactLanguagePicker() {
    /* Floating EN/FR/PT/AR pill removed by owner request — pages with their
       own #langWrap picker keep it; nothing floating is injected anymore. */
    var old = document.getElementById('sxPageLang');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    return;
    if (document.getElementById('langWrap') || document.getElementById('sxPageLang')) return;
    const picker = document.createElement('div');
    picker.id = 'sxPageLang';
    picker.className = 'sx-page-lang';
    picker.setAttribute('aria-label', 'Language');
    picker.innerHTML =
      '<button type="button" data-sx-lang="en">EN</button>' +
      '<button type="button" data-sx-lang="fr">FR</button>' +
      '<button type="button" data-sx-lang="pt">PT</button>' +
      '<button type="button" data-sx-lang="ar">AR</button>';
    const style = document.createElement('style');
    style.textContent =
      '.sx-page-lang{position:fixed;right:14px;bottom:14px;z-index:50000;display:flex;gap:3px;padding:5px;border:1px solid #ddd6fe;border-radius:999px;background:rgba(255,255,255,.96);box-shadow:0 8px 28px rgba(76,29,149,.18);direction:ltr}' +
      '.sx-page-lang button{border:0;border-radius:999px;background:transparent;color:#6d28d9;padding:6px 8px;font:700 11px/1 system-ui;cursor:pointer}' +
      '.sx-page-lang button.active{background:#7c3aed;color:#fff}';
    document.head.appendChild(style);
    document.body.appendChild(picker);
    picker.addEventListener('click', e => {
      const target = e.target.closest('[data-sx-lang]');
      if (target) applyLang(target.dataset.sxLang);
    });
  }

  function applyLang(lang) {
    if (!T[lang]) lang = 'en';
    currentLang = lang;
    localStorage.setItem('sx_lang', lang);

    const dict = T[lang];
    const meta = LANG_META[lang];

    /* update html dir + lang */
    document.documentElement.lang = lang;
    document.documentElement.dir  = meta.dir;

    /* rewrite every [data-i18n] element */
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) el.textContent = dict[key];
    });

    /* update lang button display */
    const flagEl  = document.getElementById('langFlag');
    const labelEl = document.getElementById('langLabel');
    if (flagEl)  flagEl.textContent  = meta.flag;
    if (labelEl) labelEl.textContent = meta.label;

    /* mark active option */
    document.querySelectorAll('.lang-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.lang === lang);
    });
    document.querySelectorAll('[data-sx-lang]').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.sxLang === lang);
    });

    translateApplicationText(lang, document.body);

    /* update <title> */
    const isHome = !!document.getElementById('heroSlider');
    const isPastQuestions = document.body && document.body.classList.contains('pq-page');
    if (isHome) {
      const titles = {
        en: 'Scholaxia — Smart. Simple. Learning.',
        fr: 'Scholaxia — Intelligent. Simple. Apprendre.',
        pt: 'Scholaxia — Inteligente. Simples. Aprender.',
        ar: 'Scholaxia — ذكي. بسيط. تعلّم.',
      };
      document.title = titles[lang] || titles.en;
    } else if (isPastQuestions) {
      const titles = {
        en: 'Past Questions Marketplace — Scholaxia',
        fr: 'Marché des annales — Scholaxia',
        pt: 'Mercado de provas anteriores — Scholaxia',
        ar: 'سوق الأسئلة السابقة — Scholaxia',
      };
      document.title = titles[lang] || titles.en;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     3. LANGUAGE DROPDOWN BEHAVIOUR
     ───────────────────────────────────────────────────────────── */
  const wrap    = document.getElementById('langWrap');
  const btn     = document.getElementById('langBtn');
  const dropdown = document.getElementById('langDropdown');

  if (btn && wrap && dropdown) {
    /* open / close */
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });

    /* close on outside click */
    document.addEventListener('click', () => {
      wrap.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });

    /* pick a language */
    dropdown.addEventListener('click', e => {
      const opt = e.target.closest('.lang-option');
      if (!opt) return;
      applyLang(opt.dataset.lang);
      wrap.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });

    /* keyboard navigation inside dropdown */
    dropdown.addEventListener('keydown', e => {
      const opt = e.target.closest('.lang-option');
      if (!opt) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyLang(opt.dataset.lang);
        wrap.classList.remove('open');
        btn.focus();
      }
      if (e.key === 'Escape') {
        wrap.classList.remove('open');
        btn.focus();
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     4. CURRENCY ENGINE
     ───────────────────────────────────────────────────────────── */
  const CURRENCIES = {
    USD: { symbol: '$',    label: 'USD', rate: 1      },
    GBP: { symbol: '£',    label: 'GBP', rate: 0.79   },
    NGN: { symbol: '₦',   label: 'NGN', rate: 1650   },
    KES: { symbol: 'KES ', label: 'KES', rate: 130    },
    GHS: { symbol: 'GHS ', label: 'GHS', rate: 13.5   },
  };

  /* NGN is the house currency — the shop & marketplace price in Naira and
     Paystack charges NGN server-side, so Naira must be the default. */
  let currentCurrency = localStorage.getItem('sx_currency') || 'NGN';

  function applyCurrency(code) {
    if (!CURRENCIES[code]) code = 'NGN';
    currentCurrency = code;
    localStorage.setItem('sx_currency', code);

    const cur = CURRENCIES[code];

    /* update currency button label */
    const symEl  = document.getElementById('currSymbol');
    const lblEl  = document.getElementById('currLabel');
    if (symEl) symEl.textContent = cur.symbol.trim();
    if (lblEl) lblEl.textContent = cur.label;

    /* mark active option in dropdown */
    document.querySelectorAll('#currDropdown .lang-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.currency === code);
    });

    /* convert any [data-price-usd] elements */
    document.querySelectorAll('[data-price-usd]').forEach(el => {
      const usd = parseFloat(el.dataset.priceUsd);
      if (isNaN(usd)) return;
      const converted = (usd * cur.rate).toLocaleString(undefined, {
        minimumFractionDigits: 0, maximumFractionDigits: 0,
      });
      el.textContent = cur.symbol + converted;
    });

    /* notify page scripts (shop, marketplace…) so they re-render prices */
    document.dispatchEvent(new CustomEvent('sx:currencychange', { detail: { code } }));
  }

  /* currency dropdown (reuses .lang-wrap pattern) */
  const currWrap     = document.getElementById('currWrap');
  const currBtn      = document.getElementById('currBtn');
  const currDropdown = document.getElementById('currDropdown');

  if (currBtn && currWrap && currDropdown) {
    currBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = currWrap.classList.toggle('open');
      currBtn.setAttribute('aria-expanded', String(open));
    });
    currDropdown.addEventListener('click', e => {
      const opt = e.target.closest('.lang-option');
      if (!opt || !opt.dataset.currency) return;
      applyCurrency(opt.dataset.currency);
      currWrap.classList.remove('open');
      currBtn.setAttribute('aria-expanded', 'false');
    });
    currDropdown.addEventListener('keydown', e => {
      const opt = e.target.closest('.lang-option');
      if (!opt) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyCurrency(opt.dataset.currency);
        currWrap.classList.remove('open');
        currBtn.focus();
      }
      if (e.key === 'Escape') { currWrap.classList.remove('open'); currBtn.focus(); }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     5. AUTO-DETECT TIMEZONE  (display only — no hardcoded WAT)
     ───────────────────────────────────────────────────────────── */
  try {
    const tz   = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now  = new Date();
    const time = now.toLocaleTimeString(currentLang === 'ar' ? 'ar-EG' : currentLang, {
      hour: '2-digit', minute: '2-digit', timeZone: tz,
    });
    /* inject into any [data-localtime] element */
    document.querySelectorAll('[data-localtime]').forEach(el => {
      el.textContent = time + ' (' + tz.replace(/_/g,' ') + ')';
    });
  } catch (_) {}

  /* ─────────────────────────────────────────────────────────────
     6. INIT — apply saved preferences on load
     ───────────────────────────────────────────────────────────── */
  applyLang(currentLang);
  applyCurrency(currentCurrency);

  ensureCompactLanguagePicker();
  applyLang(currentLang);

  /* Translate content created later by dashboard and marketplace scripts. */
  let translateQueued = false;
  const observer = new MutationObserver(records => {
    if (translateQueued) return;
    const hasAddedContent = records.some(record => record.addedNodes && record.addedNodes.length);
    if (!hasAddedContent) return;
    translateQueued = true;
    setTimeout(() => {
      translateQueued = false;
      translateApplicationText(currentLang, document.body);
    }, 20);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  /* expose globally so other pages/scripts can trigger language changes */
  window.SxLang = { apply: applyLang, current: () => currentLang };
  window.SxCurr = { apply: applyCurrency, current: () => currentCurrency };

  /* ─────────────────────────────────────────────────────────────
     7. ACCOUNT LANGUAGE — once logged in, the account's chosen
        language wins over the device default (every page load).
     ───────────────────────────────────────────────────────────── */
  try {
    let acctLang = '';
    try { acctLang = localStorage.getItem('sia_language') || ''; } catch (_) {}
    if (!acctLang) {
      try { acctLang = (JSON.parse(localStorage.getItem('sia_user') || 'null') || {}).language || ''; } catch (_) {}
    }
    acctLang = String(acctLang || '').toLowerCase().trim();
    if (['fr', 'pt', 'ar'].includes(acctLang) && currentLang !== acctLang) {
      applyLang(acctLang);
    }
  } catch (_) {}

})();
