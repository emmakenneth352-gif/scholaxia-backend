import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class GuestCbtAccess(Base):
    __tablename__ = "guest_cbt_access"
    __table_args__ = (
        Index("ix_guest_cbt_access_expires_at", "expires_at"),
        Index("ix_guest_cbt_access_payment_id", "payment_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    package_id: Mapped[str] = mapped_column(String(80), nullable=False)
    boards: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id"), nullable=True
    )
    coupon_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cbt_coupons.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
