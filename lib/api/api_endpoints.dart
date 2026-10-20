/// All Scholaxia API endpoints in one place.
class ApiEndpoints {
  ApiEndpoints._();

  static const String baseUrl = 'https://scholaxia1.onrender.com';
  static const String communityBaseUrl = 'https://scholaxia1.onrender.com';
  static const String _v1 = '/api/v1';

  // Auth
  static const String studentSignup = '$_v1/auth/student/signup';
  static const String kindSignup = '$_v1/auth/kind/signup';
  static const String signupStart = '$_v1/auth/signup/start';
  static const String signupVerify = '$_v1/auth/signup/verify';
  static const String otpSend = '$_v1/auth/otp/send';
  static const String passwordReset = '$_v1/auth/password/reset';
  static const String firebaseAuth = '$_v1/auth/firebase';
  static const String kindMe = '$_v1/kind/me';
  static const String kindSubjects = '$_v1/kind/subjects';
  static const String kindSiaChat = '$_v1/kind/sia/chat';
  static const String kindSiaLearn = '$_v1/kind/sia/learn';
  static const String kindSiaQuiz = '$_v1/kind/sia/quiz';
  static String kindGameQuestions(String gameId) =>
      '$_v1/kind/games/$gameId/questions';
  static const String kindGamesCatalog = '$_v1/kind/games/catalog';
  static const String login = '$_v1/auth/login';

  // Students
  static const String setupExam = '$_v1/students/setup-exam';
  static const String setupStatus = '$_v1/students/setup-status';
  static const String studentSubjects = '$_v1/students/subjects';

  // Profiles
  static const String profileMe = '$_v1/profiles/me';
  static const String profilePicture = '$_v1/profiles/me/picture';
  static String studentProfile(String userId) => '$_v1/profiles/student/$userId';
  static String teacherProfile(String userId) => '$_v1/profiles/teacher/$userId';
  static const String teachersList = '$_v1/profiles/teachers';
  static const String teacherMe = '$_v1/teachers/me';

  // Sia AI
  static const String siaAsk = '$_v1/sia/ask';
  static const String siaTranscribe = '$_v1/sia/transcribe';
  static const String siaExplain = '$_v1/sia/explain';
  static const String siaSolve = '$_v1/sia/solve';
  static const String siaEvaluate = '$_v1/sia/evaluate';
  static const String siaGenerateQuestions = '$_v1/sia/generate-questions';
  static const String siaFeedback = '$_v1/sia/feedback';
  static const String siaExplainWrong = '$_v1/sia/explain-wrong';
  static const String siaLesson = '$_v1/sia/lesson';
  static const String siaDebate = '$_v1/sia/debate';
  static const String siaStudyPlan = '$_v1/sia/study-plan';
  static const String siaProcessPdf = '$_v1/sia/process-pdf';
  static const String siaAnalyzeImage = '$_v1/sia/analyze-image';
  static const String siaSaveNote = '$_v1/sia/notes';
  static const String siaNotes = '$_v1/sia/notes';
  static const String siaAbout = '$_v1/sia/about';
  static const String siaLanguages = '$_v1/sia/languages';
  static const String siaSpeak = '$_v1/sia/speak';

  // Teacher AI
  static const String teacherAiAsk = '$_v1/teacher-ai/ask';
  static const String teacherAiSpeak = '$_v1/teacher-ai/speak';

  // CBT
  static const String cbtExams = '$_v1/cbt/exams';
  static const String cbtExamsForMe = '$_v1/cbt/exams/for-me';
  static String cbtExam(String examId) => '$_v1/cbt/exams/$examId';
  static String cbtExamDownload(String examId) => '$_v1/cbt/exams/$examId/download';
  static String cbtStartSession(String examId) => '$_v1/cbt/sessions/$examId/start';
  static const String cbtSubmitSession = '$_v1/cbt/sessions/submit';
  static String cbtSessionResult(String sessionId) => '$_v1/cbt/sessions/$sessionId/result';
  static String cbtSessionReview(String sessionId) => '$_v1/cbt/sessions/$sessionId/review';
  static const String cbtMySessions = '$_v1/cbt/my-sessions';
  static const String cbtSchoolExamsMine = '$_v1/cbt/school-exams/mine';
  static const String cbtSchoolExamsCreate = '$_v1/cbt/school-exams';
  static String cbtSchoolExamResults(String examId) => '$_v1/cbt/school-exams/$examId/results';

  // Materials
  static const String materialsMine = '$_v1/materials/mine';
  static const String materialsCreate = '$_v1/materials/';

  // Community
  static const String communityChannels = '$_v1/community/channels';
  static const String communityJoin = '$_v1/community/join';
  static const String communityUpload = '$_v1/community/upload';
  static const String communityMessages = '$_v1/community/messages';
  static const String communityAssignments = '$_v1/community/assignments';
  static const String communityAssignmentsPending = '$_v1/community/assignments/pending';
  static String communityAssignmentResult(String submissionId) =>
      '$_v1/community/assignments/$submissionId/result';
  static const String communityPosts = '$_v1/community/posts';
  static const String communityPostComments = '$_v1/community/post-comments';
  static const String communityAnnouncements = '$_v1/community/announcements';
  static String communityPostLike(String postId) => '$_v1/community/posts/$postId/like';
  static String communityPostUpdate(String postId) => '$_v1/community/posts/$postId';
  static String communityPostDelete(String postId) => '$_v1/community/posts/$postId';
  static String communityChannelPinned(String channelId) =>
      '$_v1/community/channels/$channelId/pinned';
  static String communityPostPin(String postId) => '$_v1/community/posts/$postId/pin';

  // Student group voice calls
  static String studentGroupCallStart(String groupId) =>
      '$_v1/student-groups/$groupId/calls/start';
  static String studentGroupCallActive(String groupId) =>
      '$_v1/student-groups/$groupId/calls/active';
  static String studentGroupCallJoin(String groupId) =>
      '$_v1/student-groups/$groupId/calls/join';
  static String studentGroupCallEnd(String groupId) =>
      '$_v1/student-groups/$groupId/calls/end';
  static String studentGroupCallDecline(String groupId) =>
      '$_v1/student-groups/$groupId/calls/decline';

  // Home
  static const String homeFeed = '$_v1/home/feed';
  static const String recommendationsFeed = '$_v1/recommendations/feed';

  // Live classes
  static const String liveClassCreate = '$_v1/live-classes/';
  static const String liveClassList = '$_v1/live-classes/';
  static String liveClassStart(String classId) => '$_v1/live-classes/$classId/start';
  static String liveClassJoin(String classId) => '$_v1/live-classes/$classId/join';
  static String liveClassDetail(String classId) => '$_v1/live-classes/$classId';
  static String liveClassPresence(String classId) =>
      '$_v1/live-classes/$classId/presence';
  static String liveClassEnd(String classId) => '$_v1/live-classes/$classId/end';
  static String liveClassLeave(String classId) => '$_v1/live-classes/$classId/leave';
  static String liveClassToken(String classId) => '$_v1/live-classes/$classId/token';
  static String liveClassStudents(String classId) => '$_v1/live-classes/$classId/students';
  static String liveClassUnmute(String classId, String studentId) =>
      '$_v1/live-classes/$classId/students/$studentId/unmute';
  static String liveClassMute(String classId, String studentId) =>
      '$_v1/live-classes/$classId/students/$studentId/mute';
  static String liveClassAllowCamera(String classId, String studentId) =>
      '$_v1/live-classes/$classId/students/$studentId/allow-camera';
  static String liveClassRevokeCamera(String classId, String studentId) =>
      '$_v1/live-classes/$classId/students/$studentId/revoke-camera';
  static String liveClassRemove(String classId, String studentId) =>
      '$_v1/live-classes/$classId/students/$studentId/remove';
  static const String liveClassLivekitStatus = '$_v1/live-classes/livekit/status';

  /// WebSocket base (https → wss).
  static String get wsBase {
    final u = Uri.parse(baseUrl);
    final scheme = u.scheme == 'https' ? 'wss' : 'ws';
    final port = u.hasPort ? ':${u.port}' : '';
    return '$scheme://${u.host}$port';
  }

  static String liveClassWs(
    String roomId, {
    required String userId,
    required String role,
  }) {
    final q = Uri(queryParameters: {'user_id': userId, 'role': role});
    return '$wsBase/ws/live-class/${Uri.encodeComponent(roomId)}${q.query.isEmpty ? '' : '?${q.query}'}';
  }
  static const String liveClassHistory = '$_v1/live-classes/history/mine';
  static const String liveClassRequests = '$_v1/live-classes/requests';
  static const String liveClassRequestsMine = '$_v1/live-classes/requests/mine';
  static const String liveClassAccessCodesMine = '$_v1/live-classes/access-codes/mine';
  static const String liveClassAccessCodesMarkRead = '$_v1/live-classes/access-codes/mark-read';
  static const String liveClassJoinByCode = '$_v1/live-classes/join-by-code';
  static const String liveClassJoinPreview = '$_v1/live-classes/join-preview';
  static const String liveClassPlans = '$_v1/payments/live-class/plans';
  static String liveClassAccess(String classId) =>
      '$_v1/payments/live-class/$classId/access';

  // Student groups
  static const String studentGroups = '$_v1/student-groups/';
  static const String studentGroupsMine = '$_v1/student-groups/mine';
  static const String studentGroupsDiscover = '$_v1/student-groups/discover';
  static const String studentGroupsCommunityListed = '$_v1/student-groups/community-listed';
  static String studentGroup(String groupId) => '$_v1/student-groups/$groupId';
  static String studentGroupMembers(String groupId) => '$_v1/student-groups/$groupId/members';
  static String studentGroupMessages(String groupId) => '$_v1/student-groups/$groupId/messages';
  static String studentGroupJoinRequest(String groupId) =>
      '$_v1/student-groups/$groupId/join-request';
  static String studentGroupJoinRequests(String groupId) =>
      '$_v1/student-groups/$groupId/join-requests';
  static String studentGroupApproveJoinRequest(String groupId, String requestId) =>
      '$_v1/student-groups/$groupId/join-requests/$requestId/approve';
  static String studentGroupCommunityList(String groupId) =>
      '$_v1/student-groups/$groupId/community-list';

  // School groups (teacher-assigned, no self-join)
  static const String schoolGroupsMine = '$_v1/school-groups/mine';
  static const String schoolGroupsCreate = '$_v1/school-groups/';
  static String schoolGroup(String groupId) => '$_v1/school-groups/$groupId';
  static const String schoolGroupsStudentMine = '$_v1/school-groups/student/mine';

  // Library
  static const String libraryStudent = '$_v1/library/student';
  static String libraryRead(String bookId) => '$_v1/library/$bookId/read';
  static String libraryFile(String bookId, {bool download = false}) =>
      download
          ? '$_v1/library/$bookId/file?download=1'
          : '$_v1/library/$bookId/file';

  // Marketplace
  static const String marketplaceCategories = '$_v1/marketplace/categories';
  static const String marketplaceProducts = '$_v1/marketplace/products';
  static String marketplaceProduct(String id) => '$_v1/marketplace/products/$id';
  static String marketplaceBookProduct(String id) =>
      '$_v1/marketplace/products/$id/book';
  static const String marketplaceBookingsMine = '$_v1/marketplace/bookings/mine';
  static const String marketplaceCart = '$_v1/marketplace/cart';
  static const String marketplaceCartAdd = '$_v1/marketplace/cart/add';
  static String marketplaceCartItem(String id) => '$_v1/marketplace/cart/$id';
  static const String marketplaceCheckout = '$_v1/marketplace/checkout';
  static const String marketplaceOrdersMine = '$_v1/marketplace/orders/mine';
  static const String vendorMarketplaceProducts = '$_v1/vendor/marketplace/products';
  static const String vendorMarketplaceUploadImage =
      '$_v1/vendor/marketplace/upload-image';
  static const String vendorMarketplaceStatus = '$_v1/vendor/marketplace/status';
  static String vendorMarketplaceProduct(String id) =>
      '$_v1/vendor/marketplace/products/$id';
  static const String vendorMarketplaceOrders = '$_v1/vendor/marketplace/orders';
  static const String vendorMarketplaceBookings = '$_v1/vendor/marketplace/bookings';
  static String vendorMarketplaceBookingStatus(String bookingId) =>
      '$_v1/vendor/marketplace/bookings/$bookingId/status';
  static const String vendorMarketplaceKyc = '$_v1/vendor/marketplace/kyc';
  static String vendorMarketplaceOrderTracking(String orderItemId) =>
      '$_v1/vendor/marketplace/orders/$orderItemId/tracking';
  static String vendorMarketplaceOrderItem(String orderItemId) =>
      '$_v1/vendor/marketplace/orders/$orderItemId';
  static const String adminVendors = '$_v1/admin/vendors';
  static String adminVendorApprove(String id) => '$_v1/admin/vendors/$id/approve';
  static String adminVendorReject(String id) => '$_v1/admin/vendors/$id/reject';

  // Wallet
  static const String walletMe = '$_v1/wallet/me';
  static const String walletWithdraw = '$_v1/wallet/withdraw';

  // Scholaxia Intellect League (SIL)
  static const String silMeta = '$_v1/sil/meta';
  static const String silStatus = '$_v1/sil/status';
  static const String silRegister = '$_v1/sil/register';
  static const String silFaceVerify = '$_v1/sil/face-verify';
  static const String silWallet = '$_v1/sil/wallet';
  static const String silWalletBuy = '$_v1/sil/wallet/buy';
  static const String silDashboard = '$_v1/sil/dashboard';
  static const String silPractice = '$_v1/sil/matches/practice';
  static const String silAi = '$_v1/sil/matches/ai';
  static const String silStudentChallenge = '$_v1/sil/matches/student-challenge';
  static const String silClassChallenge = '$_v1/sil/matches/class-challenge';
  static const String silSchoolChallenge = '$_v1/sil/matches/school-challenge';
  static const String silFriday = '$_v1/sil/matches/friday';
  static String silMatch(String id) => '$_v1/sil/matches/$id';
  static String silMatchFinish(String id) => '$_v1/sil/matches/$id/finish';
  static String silMatchAnticheat(String id) => '$_v1/sil/matches/$id/anticheat';
  static String silMatchResume(String id) => '$_v1/sil/matches/$id/resume';
  static String silMatchHeartbeat(String id) => '$_v1/sil/matches/$id/heartbeat';
  static const String silDeviceReport = '$_v1/sil/device-report';
  static const String silLeaderboard = '$_v1/sil/leaderboard';
  static const String silHistory = '$_v1/sil/history';
  static const String silSchools = '$_v1/sil/schools';
  static const String silAdminFlagged = '$_v1/sil/admin/flagged-matches';
  static String silAdminReview(String id) => '$_v1/sil/admin/flagged-matches/$id/review';

  // Notifications
  static const String notifications = '$_v1/notifications/';
  static const String notificationsReadAll = '$_v1/notifications/read-all';
  static const String notificationsDeviceToken = '$_v1/notifications/device-token';
}
