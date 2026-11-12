"""Admin-controlled feature locks for the student and kinder (kind) apps.

Each row is a single switch. Missing rows are treated as "open" so a fresh
deploy is never accidentally locked. The catalog below is the single source of
truth for both the admin panel and the client-side guard.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.datetime_utils import naive_utc_now


DEFAULT_MAINTENANCE_MESSAGE = (
    "We are running an update - we will be open soon. Thanks for your patience!"
)


# section: used by the admin UI to group the features.
# key: stable id consumed by the apps (student.<page> / kind.<page>).
FEATURE_CATALOG: tuple[dict, ...] = (
    # ---------------------------------------------------------------- student
    {
        "key": "student.home",
        "section": "student",
        "label": "Home",
        "description": "Student dashboard, greetings and quick actions.",
    },
    {
        "key": "student.study-materials",
        "section": "student",
        "label": "Video Tutorials",
        "description": "Skill video tutorials and activation-code redemption.",
    },
    {
        "key": "student.past-questions",
        "section": "student",
        "label": "Past Questions",
        "description": "Past-question PDFs (read, buy and download).",
    },
    {
        "key": "student.cbt",
        "section": "student",
        "label": "CBT Practice",
        "description": "JAMB, WAEC, NECO and Common Entrance practice packages.",
    },
    {
        "key": "student.school-portal",
        "section": "student",
        "label": "Examinations",
        "description": "School-published exam papers for the student's class.",
    },
    {
        "key": "student.school",
        "section": "student",
        "label": "Scholaxia Exam",
        "description": "Teacher tests, scores and scheduled exams.",
    },
    {
        "key": "student.live",
        "section": "student",
        "label": "Live Class",
        "description": "Join live lessons and see classes that are live now.",
    },
    {
        "key": "student.subscription",
        "section": "student",
        "label": "Subscription",
        "description": "Live-class plans, skills programmes and monthly access.",
    },
    {
        "key": "student.skills",
        "section": "student",
        "label": "Skills",
        "description": "Skills training programmes and enrolment.",
    },
    {
        "key": "student.library",
        "section": "student",
        "label": "Library",
        "description": "Books, notes and downloadable resources.",
    },
    {
        "key": "student.games",
        "section": "student",
        "label": "Games",
        "description": "Brain Breakers games and levels.",
    },
    {
        "key": "student.assignments",
        "section": "student",
        "label": "Assignments",
        "description": "Submit assignments and read notices.",
    },
    {
        "key": "student.sia",
        "section": "student",
        "label": "Tutor AI",
        "description": "Sia AI tutor chat and study help.",
    },
    {
        "key": "student.community",
        "section": "student",
        "label": "Community",
        "description": "Student community posts, likes and replies.",
    },
    {
        "key": "student.groups",
        "section": "student",
        "label": "Groups",
        "description": "Create or join student study groups.",
    },
    {
        "key": "student.about",
        "section": "student",
        "label": "About",
        "description": "About Scholaxia and platform information.",
    },
    {
        "key": "student.contact",
        "section": "student",
        "label": "Contact",
        "description": "Support contact page.",
    },
    {
        "key": "student.profile",
        "section": "student",
        "label": "Profile",
        "description": "Student profile, subjects and account settings.",
    },
    {
        "key": "student.affiliate",
        "section": "student",
        "label": "Refer & Earn",
        "description": "Affiliate referral page and earnings link.",
    },
    # ------------------------------------------------------------------- kind
    {
        "key": "kind.home",
        "section": "kind",
        "label": "Home",
        "description": "Kids dashboard and friendly welcome screen.",
    },
    {
        "key": "kind.sia",
        "section": "kind",
        "label": "Sia AI",
        "description": "Sia chat, lessons and homework help for kids.",
    },
    {
        "key": "kind.live",
        "section": "kind",
        "label": "Live Class",
        "description": "Join kids live classes.",
    },
    {
        "key": "kind.saved",
        "section": "kind",
        "label": "Saved",
        "description": "Saved lessons and resources.",
    },
    {
        "key": "kind.library",
        "section": "kind",
        "label": "Library",
        "description": "Kids library books and stories.",
    },
    {
        "key": "kind.videos",
        "section": "kind",
        "label": "Videos",
        "description": "Kids video lessons.",
    },
    {
        "key": "kind.games",
        "section": "kind",
        "label": "Games",
        "description": "Kids learning games and levels.",
    },
    {
        "key": "kind.cbt",
        "section": "kind",
        "label": "CBT",
        "description": "Kids practice questions and quizzes.",
    },
    {
        "key": "kind.profile",
        "section": "kind",
        "label": "Profile",
        "description": "Kids profile and preferences.",
    },
)

FEATURE_KEYS: frozenset[str] = frozenset(item["key"] for item in FEATURE_CATALOG)


class FeatureAccessLock(Base):
    """One row per feature. Missing row = feature is open."""

    __tablename__ = "feature_access_locks"

    feature_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=naive_utc_now,
        onupdate=naive_utc_now,
        nullable=False,
    )
    updated_by: Mapped[str | None] = mapped_column(String(180), nullable=True)
