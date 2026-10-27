"""SCHOLAXIA — reusable subject catalogue for question-bank uploads.

Two tables:

    school_subjects            — one row per subject name per scope.
                               school_id NULL  = global shared subject.
                               school_id set   = private to that school.
    school_subject_offerings   — which level/class a subject is offered in,
                               and whether it is enabled there.
                               school_id NULL  = global default offering.
                               school_id set   = this school's override.

A teacher sees: every active global subject (+offering) plus their own
school's private subjects. Custom subjects are private to the school that
created them unless an admin shares them (copies to global scope).
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# School levels used by the Upload Questions flow.
LEVEL_PRIMARY = "primary"
LEVEL_JSS = "jss"
LEVEL_SSS = "sss"
SUBJECT_LEVELS = (LEVEL_PRIMARY, LEVEL_JSS, LEVEL_SSS)

# Exact class labels shown in the UI (spec §1).
LEVEL_CLASSES: dict[str, list[str]] = {
    LEVEL_PRIMARY: ["Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6"],
    LEVEL_JSS: ["JSS 1", "JSS 2", "JSS 3"],
    LEVEL_SSS: ["SS1", "SS2", "SS3"],
}


def normalize_subject_name(name: str | None) -> str:
    """Canonical key for duplicate detection (case/space-insensitive)."""
    import re

    return re.sub(r"\s+", " ", (name or "").strip().lower())


def normalize_class_name(name: str | None) -> str:
    """Canonical key for class matching (JSS 1 == jss1 == JSS1)."""
    import re

    return re.sub(r"\s+", "", (name or "").strip().upper())


class SchoolSubject(Base):
    __tablename__ = "school_subjects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized: Mapped[str] = mapped_column(String(140), nullable=False, index=True)
    # NULL = global shared subject; set = private to one school.
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    offerings: Mapped[list["SchoolSubjectOffering"]] = relationship(
        "SchoolSubjectOffering", back_populates="subject", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_school_subjects_school_norm", "school_id", "normalized"),
    )


class SchoolSubjectOffering(Base):
    __tablename__ = "school_subject_offerings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_subjects.id"), nullable=False, index=True
    )
    # NULL = global default offering; set = this school's override.
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=True, index=True
    )
    level: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    class_name: Mapped[str] = mapped_column(String(40), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    subject: Mapped["SchoolSubject"] = relationship("SchoolSubject", back_populates="offerings")

    __table_args__ = (
        Index("ix_subject_offering_lookup", "school_id", "level", "class_name"),
    )
