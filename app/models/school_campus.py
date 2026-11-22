import uuid
from datetime import datetime
from sqlalchemy import JSON, String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class SchoolCampus(Base):
    """A school added by the main Scholaxia admin. Each campus has its own school admin."""
    __tablename__ = "school_campuses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # URL identifier for the school's private link: greensprings.scholaxia.com
    slug: Mapped[str | None] = mapped_column(String(80), unique=True, index=True, nullable=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=True)
    city: Mapped[str] = mapped_column(String(120), nullable=True)
    state: Mapped[str] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Owner spec §3: registration → pending → super-admin review → approved/rejected.
    # suspended = previously approved but temporarily disabled by the Super Admin.
    approval_status: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)  # pending | approved | rejected | suspended
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Owner spec §7: per-school feature toggles (Super Admin). Merged over the
    # plan's feature set at runtime: {"attendance": true, "fees": false, ...}
    feature_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 6-digit PIN the school admin sets to open/manage the control panel.
    # Teachers never see it, and only the hash is stored.
    admin_pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # private | public (set at registration, editable by the Super Admin)
    school_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # mixed | boys | girls (single-sex schools)
    category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # School-portal data (branded admin dashboard): subject/class registries,
    # attendance registers and fee records — JSON keeps each school's data
    # self-contained without extra tables.
    portal_subjects: Mapped[list | None] = mapped_column(JSON, nullable=True)
    portal_classes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Subjects the school added per class ({"GS1": ["Mathematics", ...]}).
    # Registration lists exactly these for the chosen class instead of the
    # whole national curriculum.
    portal_class_subjects: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    portal_attendance: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # date -> {student_id: status}
    portal_fees: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Report-card template: colors, logo, category weights (percentages),
    # remarks, signatures — edited by the school on the Result Template tab.
    result_template: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Owner addition — uploaded result sheets, same self-contained JSON
    # pattern as portal_fees: [{id, class_name, subject, term, session,
    # max_score, uploaded_at, rows: [{student_name, reg_number, ca, exam,
    # total, percentage, grade}]}]
    portal_results: Mapped[list | None] = mapped_column(JSON, nullable=True)
    subscription_active: Mapped[bool] = mapped_column(Boolean, default=False)
    subscription_plan: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Pass 7 — features the school REQUESTED at registration (replaces the old
    # pricing-plan cards): list of ids from the school-management feature
    # catalog, e.g. ["results","cbt","attendance"]. The Super Admin uses this
    # to pick the right plan when approving the school.
    requested_features: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Pass 8 — the school's OWN domain (e.g. dove.com for Dove School). The
    # Scholaxia admin buys and hosts this domain for the school and settles
    # payment directly with the school — NOT on this platform. Empty until
    # the admin sets it; the school system goes live once approved + hosted.
    custom_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
