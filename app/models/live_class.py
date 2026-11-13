import uuid
from datetime import datetime
import enum
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class LiveSessionRequestStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    scheduled = "scheduled"
    dismissed = "dismissed"


class LiveClassVisibility(str, enum.Enum):
    """How a live class is discovered and who may join."""
    subject = "subject"          # legacy: subject-matched students
    public = "public"            # platform-wide — all students
    private = "private"          # invited students only
    school_group = "school_group"  # members of a school group only
    class_level = "class_level"  # JSS1 / JSS2 / SS1 etc.


class LiveClass(Base):
    __tablename__ = "live_classes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacher_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    is_live: Mapped[bool] = mapped_column(Boolean, default=False)
    is_recording_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    recording_url: Mapped[str] = mapped_column(String(500), nullable=True)
    room_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    visibility: Mapped[str] = mapped_column(String(20), default=LiveClassVisibility.subject.value, nullable=False)
    join_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=True, index=True)
    invited_student_ids: Mapped[str] = mapped_column(Text, nullable=True)
    school_group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("school_groups.id"), nullable=True)
    academic_class: Mapped[str] = mapped_column(String(40), nullable=True, index=True)
    # Paid audience for this class: "all" = everyone, otherwise only paying
    # members of that group (jamb / waec / neco / bece / coding). Such classes
    # need no join code — the membership IS the ticket.
    audience: Mapped[str] = mapped_column(String(20), default="all", server_default="all", nullable=False)
    school_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_campuses.id"), nullable=True, index=True
    )
    # Set the first time the scheduler announces "class is live" — prevents
    # re-notifying every tick if the flag is healed/flipped afterwards.
    started_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    attendances: Mapped[list["ClassAttendance"]] = relationship("ClassAttendance", back_populates="live_class")


class ClassAttendance(Base):
    __tablename__ = "class_attendances"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    live_class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("live_classes.id"))
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    left_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    is_muted: Mapped[bool] = mapped_column(Boolean, default=False)  # open mic unless teacher mutes
    is_removed: Mapped[bool] = mapped_column(Boolean, default=False)

    live_class: Mapped["LiveClass"] = relationship("LiveClass", back_populates="attendances")


class LiveSessionRequest(Base):
    """Student requests a live class on a subject — teachers/admins can review."""
    __tablename__ = "live_session_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    topic: Mapped[str] = mapped_column(String(255), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=True)
    preferred_time: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    status: Mapped[LiveSessionRequestStatus] = mapped_column(
        Enum(LiveSessionRequestStatus), default=LiveSessionRequestStatus.pending
    )
    reviewed_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    assigned_teacher_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    linked_class_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("live_classes.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
