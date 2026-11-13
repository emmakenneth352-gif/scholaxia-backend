import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SchoolFeatureLock(Base):
    """A teacher feature the SCHOOL switched off for its own staff.

    Separate from the platform-wide FeatureAccessLock: this one only affects
    the teachers of one school, and it is managed by that school's admin.
    """
    __tablename__ = "school_feature_locks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(String(80), nullable=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    message: Mapped[str | None] = mapped_column(String(300), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ux_school_feature_locks", "school_id", "feature_key", unique=True),
    )
