import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Float, Enum, JSON, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base
import enum


class SubscriptionPlan(str, enum.Enum):
    basic = "basic"
    premium = "premium"
    pro = "pro"


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    success = "success"
    failed = "failed"
    refunded = "refunded"


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    plan: Mapped[SubscriptionPlan] = mapped_column(Enum(SubscriptionPlan), nullable=False)
    stripe_subscription_id: Mapped[str] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # Access flags
    has_premium_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    has_community_access: Mapped[bool] = mapped_column(Boolean, default=False)
    has_live_class_access: Mapped[bool] = mapped_column(Boolean, default=False)
    has_premium_cbt: Mapped[bool] = mapped_column(Boolean, default=False)
    # ── Monthly paid membership ──────────────────────────────────────────────
    # One payment covers one calendar month and expires on the same day next
    # month (pay on the 22nd → expires on the 22nd). `audience` records which
    # paid group the student joined under (jamb / waec / neco / bece / coding).
    audience: Mapped[str] = mapped_column(String(20), default="all", server_default="all")
    amount_paid: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    plan_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    period_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_first_period: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    renewal_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_renewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Nullable for guest Past Questions purchases (no Scholaxia student account).
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="NGN")
    status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus), default=PaymentStatus.pending)
    stripe_payment_intent_id: Mapped[str] = mapped_column(String(255), nullable=True)
    flutterwave_tx_ref: Mapped[str] = mapped_column(String(255), nullable=True, index=True)
    flutterwave_transaction_id: Mapped[str] = mapped_column(String(255), nullable=True)
    # Generic provider metadata (Paystack and future gateways)
    provider: Mapped[str] = mapped_column(String(30), nullable=True, index=True)
    provider_reference: Mapped[str] = mapped_column(String(255), nullable=True, index=True)
    provider_transaction_id: Mapped[str] = mapped_column(String(255), nullable=True)
    # What was purchased — e.g. product_type="library_book", product_id="<book uuid>"
    product_type: Mapped[str] = mapped_column(String(40), nullable=True, index=True)
    product_id: Mapped[str] = mapped_column(String(120), nullable=True, index=True)
    live_class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    material_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    book_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    live_plan_id: Mapped[str] = mapped_column(String(80), nullable=True, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StudentEntitlement(Base):
    """Time-boxed access granted by a purchase (e.g. a CBT practice package)."""
    __tablename__ = "student_entitlements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    entitlement_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)  # e.g. "cbt_package"
    entitlement_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)  # e.g. package id
    payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("payments.id"), nullable=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    # Purchase-time subjects. Changing a paid subject invalidates board access
    # until the student buys a package for the new selection.
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
