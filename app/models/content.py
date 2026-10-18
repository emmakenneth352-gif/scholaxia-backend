import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text, Integer, Enum, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from app.core.database import Base
import enum


class LibraryTarget(str, enum.Enum):
    student = "student"   # visible in student library
    teacher = "teacher"   # visible in teacher library only
    kind = "kind"         # visible in Kids app / kind.html library only


class Book(Base):
    __tablename__ = "books"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    author: Mapped[str] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    exam_type: Mapped[str] = mapped_column(String(20), nullable=True)
    file_key: Mapped[str] = mapped_column(String(500), nullable=False)   # S3 object key (never exposed directly)
    cover_image_url: Mapped[str] = mapped_column(String(500), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    total_pages: Mapped[int] = mapped_column(Integer, nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="Books", nullable=False)
    education_level: Mapped[str] = mapped_column(String(80), nullable=True)
    term: Mapped[str] = mapped_column(String(40), nullable=True)
    scheme_week: Mapped[int] = mapped_column(Integer, nullable=True)
    scheme_topic: Mapped[str] = mapped_column(String(255), nullable=True)
    year: Mapped[int] = mapped_column(Integer, nullable=True)

    # Library target — who can see this book
    library_target: Mapped[LibraryTarget] = mapped_column(
        Enum(LibraryTarget), default=LibraryTarget.student, nullable=False
    )

    # DRM / protection rules — same rules apply to both students and teachers
    is_downloadable: Mapped[bool] = mapped_column(Boolean, default=False)  # admin can allow device download
    allow_copy: Mapped[bool] = mapped_column(Boolean, default=False)        # no text selection/copy
    allow_screenshot: Mapped[bool] = mapped_column(Boolean, default=False)  # frontend enforces this
    allow_print: Mapped[bool] = mapped_column(Boolean, default=False)

    # Scholaxia materials — admin can mark free or paid (Flutterwave unlock)
    is_free: Mapped[bool] = mapped_column(Boolean, default=True)
    price: Mapped[float] = mapped_column(Float, default=0.0)

    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    saved_by: Mapped[list["SavedBook"]] = relationship("SavedBook", back_populates="book")
    read_progress: Mapped[list["BookReadProgress"]] = relationship("BookReadProgress", back_populates="book")


class BookPurchase(Base):
    """Student paid access to a Scholaxia library book."""
    __tablename__ = "book_purchases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    book_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("books.id"), index=True)
    payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("payments.id"), nullable=True)
    purchased_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PastQuestionGuestAccess(Base):
    """Guest (no student account) paid access to a Past Questions PDF."""
    __tablename__ = "past_question_guest_access"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    book_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("books.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    access_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("payments.id"), nullable=True)
    payment_reference: Mapped[str] = mapped_column(String(100), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)


class SavedBook(Base):
    """
    User saves a book inside the app (no download — in-app only).
    Works for both students and teachers.
    """
    __tablename__ = "saved_books"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    book_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False)
    saved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    book: Mapped["Book"] = relationship("Book", back_populates="saved_by")


class BookReadProgress(Base):
    """
    Tracks which page a user is on so they can continue reading.
    """
    __tablename__ = "book_read_progress"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    book_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False)
    current_page: Mapped[int] = mapped_column(Integer, default=1)
    last_read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    book: Mapped["Book"] = relationship("Book", back_populates="read_progress")


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    tutor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    exam_type: Mapped[str] = mapped_column(String(20), nullable=True)
    video_url: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_url: Mapped[str] = mapped_column(String(500), nullable=True)
    # Skill/category bucket shown in Video Tutorials chips
    # (academics | web design | app development | software development |
    #  digital marketing | graphics design | cyber security | data analysis)
    category: Mapped[str] = mapped_column(String(40), default="academics", nullable=False, server_default="academics")
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # student = student site Video Tutorials; kind = Kids app only
    audience: Mapped[str] = mapped_column(String(20), default="student", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=True)
    exam_type: Mapped[str] = mapped_column(String(20), nullable=True)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Syllabus(Base):
    __tablename__ = "syllabi"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    exam_type: Mapped[str] = mapped_column(String(20), nullable=False)
    topics: Mapped[list] = mapped_column(ARRAY(String), default=[])
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ── Book Recommendations ──────────────────────────────────────────────────────

class RecommendationTarget(str, enum.Enum):
    all = "all"           # both students and teachers
    student = "student"
    teacher = "teacher"


class BookRecommendation(Base):
    """
    Admin posts a book recommendation — can reference an existing library book
    or be a standalone recommendation with an external link.
    """
    __tablename__ = "book_recommendations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    author: Mapped[str] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(100), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    cover_image_url: Mapped[str] = mapped_column(String(500), nullable=True)

    # Optional: link to an internal library book
    book_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("books.id"), nullable=True
    )
    # Optional: external link (Amazon, PDF, etc.)
    external_url: Mapped[str] = mapped_column(String(500), nullable=True)

    target: Mapped[RecommendationTarget] = mapped_column(
        Enum(RecommendationTarget), default=RecommendationTarget.all
    )
    exam_type: Mapped[str] = mapped_column(String(20), nullable=True)  # JAMB | WAEC | NECO | ALL
    education_level: Mapped[str] = mapped_column(String(50), nullable=True)  # SS1, SS2, SS3, JAMB

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
