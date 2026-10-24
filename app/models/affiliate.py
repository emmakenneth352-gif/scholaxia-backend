"""
Affiliate ("Refer & Earn") models
---------------------------------
Every active user can become an affiliate: they get a personal referral code,
share their link (`<site>?ref=<code>`), and earn a fixed credit for every
signup that comes through it.

Payouts are MANUAL: the affiliate submits their bank account details, the
admin pays from the Scholaxia bank app and marks the request paid. The
affiliate's earnings simply disappear the moment a payout request is placed
(no double-withdrawal) and only return if the admin rejects the request.
"""
import uuid
from datetime import datetime

import enum

from sqlalchemy import String, DateTime, Float, ForeignKey, Enum, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PayoutStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    rejected = "rejected"


class AffiliateProfile(Base):
    __tablename__ = "affiliate_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), unique=True, index=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def display_link(self, origin: str = "https://scholaxia1.onrender.com") -> str:
        return f"{origin.rstrip('/')}/app/?ref={self.code}"


class AffiliateReferral(Base):
    __tablename__ = "affiliate_referrals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    affiliate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("affiliate_profiles.id"), index=True)
    referred_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), unique=True, index=True)
    referred_name: Mapped[str] = mapped_column(String(255), default="", nullable=True)
    commission: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AffiliatePayout(Base):
    __tablename__ = "affiliate_payouts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    affiliate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("affiliate_profiles.id"), index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    bank_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_number: Mapped[str] = mapped_column(String(40), nullable=False)
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[PayoutStatus] = mapped_column(Enum(PayoutStatus), default=PayoutStatus.pending, nullable=False)
    admin_note: Mapped[str] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    processed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
