"""One-off: permanently delete EVERY teacher account from the live database,
plus every row that references them (live classes, school groups, materials,
wallet, reviews, assignments, posts, notifications, and all nullable
created_by/uploaded_by/processed_by columns).

Usage: .venv/Scripts/python.exe scripts/purge_teachers_direct.py
"""
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Local .env points at Render's internal hostname — rewrite to the external one
# (same convention as scripts/check_schema_drift.py and repair_live_schema.py).
# Must run BEFORE app.core.database creates the engine.
from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
_db_url = os.environ.get("DATABASE_URL", "")
if _db_url and ".oregon-postgres.render.com" not in _db_url:
    os.environ["DATABASE_URL"] = _db_url.replace(
        "dpg-d8co30jtqb8s738m3f10-a",
        "dpg-d8co30jtqb8s738m3f10-a.oregon-postgres.render.com",
    )

from sqlalchemy import delete, select, update

from app.core.database import AsyncSessionLocal
from app.models import *  # noqa: F401,F403 — registers all tables on Base.metadata
from app.models.user import TeacherProfile, User, UserRole
from app.models.cbt import CBTExam, CBTSession, ExamProctorLog
from app.models.cbt_settings import CbtPracticeAttempt, CbtGlobalSettings
from app.models.cbt_coupon import CbtCoupon, CbtCouponRedemption
from app.models.community import (
    AssignmentSubmission,
    CommunityChannel,
    CommunityMessage,
    CommunityPost,
    MessageReport,
    PostLike,
    PostReaction,
)
from app.models.content import Book, BookReadProgress, SavedBook, Video, Note
from app.models.external_exam import (
    ExternalExam,
    ExternalExamQuestion,
    ExternalExamAttempt,
    ExternalExamAnswer,
    ExternalExamResultAudit,
)
from app.models.kid_games import KidGameQuestion
from app.models.live_class import ClassAttendance, LiveClass, LiveSessionRequest
from app.models.live_class_access_code import LiveClassAccessCodeDelivery
from app.models.notification import DeviceToken, Notification
from app.models.review_report import Report, TeacherReview
from app.models.school_group import SchoolGroup
from app.models.sia_note import SiaNote
from app.models.student_analytics import LessonSession, StudentLearningProfile
from app.models.student_group import (
    StudentGroup,
    StudentGroupJoinRequest,
    StudentGroupMember,
    StudentGroupMessage,
)
from app.models.teacher_material import MaterialPurchase, TeacherMaterial
from app.models.wallet import TeacherWallet, WalletTransaction, WithdrawalRequest


async def main() -> int:
    async with AsyncSessionLocal() as db:
        teacher_ids = (
            await db.execute(select(User.id).where(User.role == UserRole.teacher))
        ).scalars().all()
        print(f"Teachers found: {len(teacher_ids)}")
        if not teacher_ids:
            print("Nothing to delete.")
            return 0

        # ── Live classes owned by teachers (with all child rows) ────────────
        class_ids = (
            await db.execute(select(LiveClass.id).where(LiveClass.teacher_id.in_(teacher_ids)))
        ).scalars().all()
        if class_ids:
            await db.execute(
                update(LiveSessionRequest)
                .where(LiveSessionRequest.linked_class_id.in_(class_ids))
                .values(linked_class_id=None)
            )
            await db.execute(
                update(WalletTransaction)
                .where(WalletTransaction.live_class_id.in_(class_ids))
                .values(live_class_id=None)
            )
            await db.execute(
                update(TeacherReview)
                .where(TeacherReview.live_class_id.in_(class_ids))
                .values(live_class_id=None)
            )
            await db.execute(delete(ClassAttendance).where(ClassAttendance.live_class_id.in_(class_ids)))
            await db.execute(
                delete(LiveClassAccessCodeDelivery).where(LiveClassAccessCodeDelivery.live_class_id.in_(class_ids))
            )
            await db.execute(delete(LiveClass).where(LiveClass.id.in_(class_ids)))
        print(f"  live classes removed: {len(class_ids)}")

        # ── Teacher-scoped tables ────────────────────────────────────────────
        r = await db.execute(delete(WalletTransaction).where(WalletTransaction.teacher_id.in_(teacher_ids)))
        print(f"  wallet transactions removed: {r.rowcount}")
        r = await db.execute(delete(WithdrawalRequest).where(WithdrawalRequest.teacher_id.in_(teacher_ids)))
        print(f"  withdrawal requests removed: {r.rowcount}")
        wallet_ids = (
            await db.execute(select(TeacherWallet.id).where(TeacherWallet.teacher_id.in_(teacher_ids)))
        ).scalars().all()
        r = await db.execute(delete(TeacherWallet).where(TeacherWallet.teacher_id.in_(teacher_ids)))
        print(f"  wallets removed: {r.rowcount}")

        r = await db.execute(delete(TeacherReview).where(TeacherReview.teacher_id.in_(teacher_ids)))
        print(f"  teacher reviews removed: {r.rowcount}")
        r = await db.execute(delete(SchoolGroup).where(SchoolGroup.teacher_id.in_(teacher_ids)))
        print(f"  school groups removed: {r.rowcount}")
        r = await db.execute(delete(TeacherMaterial).where(TeacherMaterial.teacher_id.in_(teacher_ids)))
        print(f"  teacher materials removed: {r.rowcount}")

        # ── Rows where the teacher is the author/reporter/etc. ─────────────
        post_ids = (
            await db.execute(select(CommunityPost.id).where(CommunityPost.author_id.in_(teacher_ids)))
        ).scalars().all()
        if post_ids:
            await db.execute(delete(PostLike).where(PostLike.post_id.in_(post_ids)))
            await db.execute(delete(PostReaction).where(PostReaction.post_id.in_(post_ids)))
        r = await db.execute(delete(PostLike).where(PostLike.user_id.in_(teacher_ids)))
        print(f"  post likes removed: {r.rowcount}")
        r = await db.execute(delete(PostReaction).where(PostReaction.user_id.in_(teacher_ids)))
        print(f"  post reactions removed: {r.rowcount}")
        r = await db.execute(delete(CommunityPost).where(CommunityPost.author_id.in_(teacher_ids)))
        print(f"  community posts removed: {r.rowcount}")

        msg_ids = (
            await db.execute(select(CommunityMessage.id).where(CommunityMessage.sender_id.in_(teacher_ids)))
        ).scalars().all()
        if msg_ids:
            await db.execute(delete(MessageReport).where(MessageReport.message_id.in_(msg_ids)))
        r = await db.execute(delete(MessageReport).where(MessageReport.reported_by.in_(teacher_ids)))
        print(f"  message reports removed: {r.rowcount}")
        r = await db.execute(delete(CommunityMessage).where(CommunityMessage.sender_id.in_(teacher_ids)))
        print(f"  community messages removed: {r.rowcount}")

        r = await db.execute(
            delete(AssignmentSubmission).where(AssignmentSubmission.tagged_teacher_id.in_(teacher_ids))
        )
        print(f"  assignment submissions removed: {r.rowcount}")

        r = await db.execute(delete(Report).where(Report.reporter_id.in_(teacher_ids)))
        print(f"  reports removed: {r.rowcount}")
        r = await db.execute(delete(Report).where(Report.target_id.in_(teacher_ids)))
        print(f"  reports (target) removed: {r.rowcount}")

        r = await db.execute(delete(Notification).where(Notification.user_id.in_(teacher_ids)))
        print(f"  notifications removed: {r.rowcount}")
        r = await db.execute(delete(DeviceToken).where(DeviceToken.user_id.in_(teacher_ids)))
        print(f"  device tokens removed: {r.rowcount}")

        r = await db.execute(delete(BookReadProgress).where(BookReadProgress.user_id.in_(teacher_ids)))
        print(f"  book progress removed: {r.rowcount}")
        r = await db.execute(delete(SavedBook).where(SavedBook.user_id.in_(teacher_ids)))
        print(f"  saved books removed: {r.rowcount}")

        r = await db.execute(delete(LessonSession).where(LessonSession.student_id.in_(teacher_ids)))
        print(f"  lesson sessions removed: {r.rowcount}")
        r = await db.execute(delete(StudentLearningProfile).where(StudentLearningProfile.student_id.in_(teacher_ids)))
        print(f"  learning profiles removed: {r.rowcount}")
        r = await db.execute(delete(SiaNote).where(SiaNote.student_id.in_(teacher_ids)))
        print(f"  sia notes removed: {r.rowcount}")

        # CBT sessions created by teachers
        r = await db.execute(delete(CBTSession).where(CBTSession.student_id.in_(teacher_ids)))
        print(f"  cbt sessions removed: {r.rowcount}")
        r = await db.execute(delete(ExamProctorLog).where(ExamProctorLog.student_id.in_(teacher_ids)))
        print(f"  proctor logs removed: {r.rowcount}")
        exam_ids = (
            await db.execute(select(CBTExam.id).where(CBTExam.created_by.in_(teacher_ids)))
        ).scalars().all()
        if exam_ids:
            await db.execute(delete(CbtPracticeAttempt).where(CbtPracticeAttempt.exam_id.in_(exam_ids)))
        r = await db.execute(delete(CBTExam).where(CBTExam.created_by.in_(teacher_ids)))
        print(f"  cbt exams removed: {r.rowcount}")

        r = await db.execute(delete(CbtCoupon).where(CbtCoupon.created_by.in_(teacher_ids)))
        print(f"  cbt coupons removed: {r.rowcount}")

        # ── Content authored by teachers: hard-delete books is risky for
        # purchased copies, so keep books but NULL the uploader. ────────────
        r = await db.execute(
            update(Book).where(Book.uploaded_by.in_(teacher_ids)).values(uploaded_by=None)
        )
        print(f"  books re-owned (uploader nulled): {r.rowcount}")
        r = await db.execute(update(Video).where(Video.uploaded_by.in_(teacher_ids)).values(uploaded_by=None))
        print(f"  videos re-owned: {r.rowcount}")
        r = await db.execute(delete(Note).where(Note.uploaded_by.in_(teacher_ids)))
        print(f"  notes removed: {r.rowcount}")

        # External exams authored by teachers
        ext_ids = (
            await db.execute(select(ExternalExam.id).where(ExternalExam.created_by.in_(teacher_ids)))
        ).scalars().all()
        if ext_ids:
            await db.execute(delete(ExternalExamResultAudit).where(ExternalExamResultAudit.exam_id.in_(ext_ids)))
            await db.execute(delete(ExternalExamAnswer).where(ExternalExamAnswer.attempt_id.in_(
                select(ExternalExamAttempt.id).where(ExternalExamAttempt.exam_id.in_(ext_ids))
            )))
            await db.execute(delete(ExternalExamAttempt).where(ExternalExamAttempt.exam_id.in_(ext_ids)))
            await db.execute(delete(ExternalExamQuestion).where(ExternalExamQuestion.exam_id.in_(ext_ids)))
            await db.execute(delete(ExternalExam).where(ExternalExam.id.in_(ext_ids)))
        r = await db.execute(delete(ExternalExam).where(ExternalExam.created_by.in_(teacher_ids)))
        print(f"  external exams removed: {r.rowcount}")

        # Kid games / marketplace created_by
        r = await db.execute(delete(KidGameQuestion).where(KidGameQuestion.created_by.in_(teacher_ids)))
        print(f"  kid game questions removed: {r.rowcount}")

        # Student groups created by teachers
        sg_ids = (
            await db.execute(select(StudentGroup.id).where(StudentGroup.creator_id.in_(teacher_ids)))
        ).scalars().all()
        if sg_ids:
            await db.execute(delete(StudentGroupMessage).where(StudentGroupMessage.group_id.in_(sg_ids)))
            await db.execute(delete(StudentGroupJoinRequest).where(StudentGroupJoinRequest.group_id.in_(sg_ids)))
            await db.execute(delete(StudentGroupMember).where(StudentGroupMember.group_id.in_(sg_ids)))
            await db.execute(delete(CommunityPost).where(CommunityPost.group_id.in_(sg_ids)))
        r = await db.execute(delete(StudentGroup).where(StudentGroup.creator_id.in_(teacher_ids)))
        print(f"  student groups removed: {r.rowcount}")

        # Memberships of teachers inside groups they don't own
        r = await db.execute(delete(StudentGroupMember).where(StudentGroupMember.user_id.in_(teacher_ids)))
        print(f"  group memberships removed: {r.rowcount}")

        # School exam candidates created_by teachers
        from app.models.school_office import SchoolExamCandidate
        r = await db.execute(
            update(SchoolExamCandidate).where(SchoolExamCandidate.created_by.in_(teacher_ids)).values(created_by=None)
        )
        print(f"  school exam candidates re-owned: {r.rowcount}")

        # CBT global settings updated_by teachers (nullable FK)
        from app.models.cbt_settings import CbtGlobalSettings as _CGS
        if hasattr(_CGS, "updated_by"):
            r = await db.execute(
                update(_CGS).where(_CGS.updated_by.in_(teacher_ids)).values(updated_by=None)
            )
            print(f"  cbt settings re-owned: {r.rowcount}")

        # ── Finally: profiles + user rows ───────────────────────────────────
        r = await db.execute(delete(TeacherProfile).where(TeacherProfile.user_id.in_(teacher_ids)))
        print(f"  teacher profiles removed: {r.rowcount}")
        r = await db.execute(delete(User).where(User.id.in_(teacher_ids), User.role == UserRole.teacher))
        print(f"  TEACHER USERS REMOVED: {r.rowcount}")

        await db.commit()

        left = (
            await db.execute(select(User.id).where(User.role == UserRole.teacher))
        ).scalars().all()
        print(f"Teachers remaining after purge: {len(left)}")
        return 0 if not left else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
