import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class StudyCoupon(Base):
    """Admin-generated activation code for Video Tutorials — per skill.

    Owner rule: Video Tutorials do NOT unlock with any plan. Each skill
    (Web Design, Cyber Security, Academics...) has its own activation code
    the tutor/admin gives the student. A code for one skill never unlocks
    another. `skill` = "all" (whole page), "academics", or one of the seven
    skill categories; `access_days` = how long access lasts AFTER redemption.
    """
    __tablename__ = "study_coupons"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    # Which skill this code unlocks: all | academics | web design | app
    # development | software development | digital marketing | graphics
    # design | cyber security | data analysis
    skill: Mapped[str] = mapped_column(String(60), default="all", nullable=False)
    max_uses: Mapped[int] = mapped_column(Integer, default=1)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)  # code valid-by date
    access_days: Mapped[int] = mapped_column(Integer, default=30, nullable=True)  # access duration after redeem
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StudyCouponRedemption(Base):
    """One redemption row per (coupon, student) — stores the granted skill + expiry."""
    __tablename__ = "study_coupon_redemptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coupon_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("study_coupons.id"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    # Skill granted by this redemption + when access ends (duration from redeem).
    skill: Mapped[str] = mapped_column(String(60), default="all", nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
