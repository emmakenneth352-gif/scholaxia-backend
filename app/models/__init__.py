# models — import all so SQLAlchemy registers them with Base.metadata
from app.models.auth_transient import AuthTransientRecord
from app.models.guest_cbt_access import GuestCbtAccess
from app.models.user import User, StudentProfile, TeacherProfile, VendorProfile, KindProfile
from app.models.payment import Subscription, Payment, StudentEntitlement
from app.models.cbt import CBTExam, CBTQuestion, CBTSession, ExamProctorLog
from app.models.cbt_settings import CbtGlobalSettings, CbtPracticeAttempt
from app.models.community import CommunityChannel, CommunityMessage, AssignmentSubmission, MessageReport, CommunityPost, PostLike, PostReaction
from app.models.live_class import LiveClass, ClassAttendance, LiveSessionRequest
from app.models.content import Book, BookPurchase, PastQuestionGuestAccess, SavedBook, BookReadProgress, Video, Note, Syllabus, BookRecommendation
from app.models.marketplace import (
    MarketplaceProduct,
    MarketplaceBooking,
    MarketplaceCartItem,
    MarketplaceOrder,
    MarketplaceOrderItem,
    VendorWithdrawalRequest,
)
from app.models.kid_games import KidGameQuestion
from app.models.notification import Notification
from app.models.school_group import SchoolGroup
from app.models.live_class_access_code import LiveClassAccessCodeDelivery
from app.models.student_group import StudentGroup, StudentGroupMember, StudentGroupJoinRequest, StudentGroupMessage
from app.models.sia_note import SiaNote
from app.models.api_key import ApiKey, ApiUsageLog, ApiDailyUsage
from app.models.review_report import Report, TeacherReview
from app.models.wallet import TeacherWallet, WalletTransaction, WithdrawalRequest
from app.models.affiliate import AffiliateProfile, AffiliateReferral, AffiliatePayout, PayoutStatus
from app.models.student_analytics import StudentLearningProfile, LessonSession
from app.models.school_campus import SchoolCampus
from app.models.cbt_coupon import CbtCoupon, CbtCouponRedemption
from app.models.study_coupon import StudyCoupon, StudyCouponRedemption
from app.models.school_office import SchoolExamCandidate
from app.models.school_subjects import SchoolSubject, SchoolSubjectOffering
from app.models.school_cbt import (
    SchoolExQuestionBank,
    SchoolExQuestion,
    SchoolExam,
    SchoolExamQuestion,
    SchoolExamAssignment,
    SchoolExamAccessCode,
    SchoolExamAttempt,
    SchoolExamAnswer,
    SchoolExamDownload,
    SchoolExamSyncLog,
    SchoolExamResult,
)
from app.models.external_exam import (
    ExternalExam,
    ExternalExamQuestion,
    ExternalExamAttempt,
    ExternalExamAnswer,
    ExternalExamResultAudit,
)
from app.models.sil import (
    SilLeagueProfile,
    SilCoinTransaction,
    SilQuestion,
    SilMatch,
    SilChallengeInvite,
    SilSchoolProfile,
    SilAntiCheatEvent,
    SilFlaggedMatch,
    SilDeviceReport,
)
from app.models.plan_overrides import PlanOverride
from app.models.school_plans import SchoolSubscription, SchoolPlanAudit
from app.models.school_results import (
    SchoolResult,
    ResultPublication,
    SchoolScratchCard,
    ScratchCardSale,
)
from app.models.ai_token import AiTokenWallet, AiTokenTransaction, AiTokenPlan
