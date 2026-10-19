"""School commercial core: plan catalog, registration, gating, Super Admin.

Spec (scholaxia.com):
- Schools register on the main site and automatically get a private link
  slug (greensprings -> greensprings.scholaxia.com).
- 3 term plans: BASIC N20,000 / STANDARD N35,000 / PREMIUM N60,000.
- Super Admin (/super-admin) sees all schools, their plans, upgrades or
  downgrades instantly, and sees income from plans + scratch cards.
"""
from __future__ import annotations

import re
import uuid as uuid_mod
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import distinct, func, select, text, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_school_staff
from app.core.security import hash_password
from app.core.datetime_utils import naive_utc_now
from app.models.school_campus import SchoolCampus
from app.models.school_plans import (
    ALL_FEATURES,
    ALL_PLANS,
    PLAN_PRICES_NGN,
    SCHOOL_FEATURE_CATALOG,
    SchoolPlanAudit,
    SchoolSubscription,
    plan_has_feature,
    plan_price_ngn,
)
from app.models.user import User, UserRole

router = APIRouter(tags=["School plans"])

BASE_DOMAIN_DEFAULT = "scholaxia.com"


# ------------------------------------------------------------- helpers ----

def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return re.sub(r"-{2,}", "-", s)


async def _unique_slug(db: AsyncSession, base: str) -> str:
    base = slugify(base)[:60] or "school"
    slug, n = base, 2
    while (await db.execute(select(SchoolCampus.id).where(SchoolCampus.slug == slug))).scalar_one_or_none():
        slug = f"{base}-{n}"
        n += 1
    return slug


async def _active_subscription(db: AsyncSession, school_id) -> SchoolSubscription | None:
    row = (
        await db.execute(
            select(SchoolSubscription)
            .where(
                SchoolSubscription.school_id == school_id,
                SchoolSubscription.is_active.is_(True),
            )
            .order_by(SchoolSubscription.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row and row.expires_at and row.expires_at < naive_utc_now():
        return None
    return row


def _features_response(plan: str | None) -> dict:
    plan = (plan or "").lower()
    return {
        "plan": plan or None,
        "features": [f for f in ALL_FEATURES if plan_has_feature(plan, f)],
    }


async def _require_super_admin(current_user: dict = Depends(require_admin)) -> dict:
    """Main platform admin (role=admin). Sub-admins are rejected."""
    if current_user.get("sub_admin_permissions") is not None:
        raise HTTPException(status_code=403, detail="Super admin only")
    return current_user


# -------------------------------------------------- feature catalog (public) ----

@router.get("/public/school-features")
async def list_school_features() -> dict:
    """Pass 7 — the school-management feature catalog for the registration
    page. Replaces the old pricing-plan cards: schools pick the features they
    want (multi-select) and the Super Admin chooses the right plan on approval."""
    return {
        "features": [
            {"id": fid, "label": label, "description": desc}
            for fid, label, desc in SCHOOL_FEATURE_CATALOG
        ]
    }


@router.get("/public/schools/check-email")
async def check_email(email: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Registration-page helper: does this email already exist on the platform?

    Registration itself never requires the old password (any email may register
    a school); this endpoint remains available for UX hints.
    """
    email = (email or "").lower().strip()
    exists = False
    if email:
        exists = (
            await db.execute(select(User.id).where(User.email == email))
        ).scalar_one_or_none() is not None
    return {"exists": exists}


# ------------------------------------------------------- registration ----

class SchoolRegisterIn(BaseModel):
    school_name: str = Field(min_length=2, max_length=255)
    city: str | None = None
    state: str | None = None
    address: str | None = Field(default=None, max_length=500)
    logo_url: str | None = Field(default=None, max_length=500)
    school_type: str | None = Field(default=None, max_length=20)  # private | public
    category: str | None = Field(default=None, max_length=20)  # mixed | boys | girls
    admin_full_name: str = Field(min_length=2, max_length=255)
    admin_email: EmailStr
    admin_phone: str | None = None
    admin_password: str = Field(min_length=8, max_length=128)
    # Owner spec §2: no plan/payment gate — plan selection is optional
    # ("choose later"); registration only creates the school account.
    plan: str | None = None
    # Pass 7 — school-management features the school WANTS (dropdown on the
    # registration page replaces the pricing-plan cards). The Super Admin
    # picks the right plan when approving.
    requested_features: list[str] = Field(default_factory=list)


@router.post("/public/schools/register", status_code=201)
async def register_school(payload: SchoolRegisterIn, db: AsyncSession = Depends(get_db)) -> dict:
    """Public school signup: creates campus + slug + admin account + plan.

    Returns the school's private link slug so the site can show
    'your link: greensprings.scholaxia.com' immediately.
    """
    plan = (payload.plan or "").lower().strip() or None
    if plan is not None and plan not in ALL_PLANS:
        raise HTTPException(status_code=422, detail=f"plan must be one of {list(ALL_PLANS)} or left empty")

    # Pass 7 — validate the requested feature ids against the catalog.
    requested_features = sorted({f.strip() for f in (payload.requested_features or []) if f.strip()})
    unknown = [f for f in requested_features if f not in ALL_FEATURES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown feature(s): {', '.join(unknown)}")

    email = payload.admin_email.lower().strip()
    existing_user = (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if existing_user is not None:
        # Any email may register a school. If the email matches an existing
        # platform account, that account is promoted to this school's admin and
        # the password entered here becomes the account password — no proof of
        # the old password is required.
        if existing_user.role == UserRole.school_admin and existing_user.school_id is not None:
            raise HTTPException(status_code=409, detail="This account already manages a school on Scholaxia")
    phone = (payload.admin_phone or "").strip() or None
    if phone:
        phone_query = select(User.id).where(User.phone == phone)
        if existing_user is not None:
            phone_query = phone_query.where(User.id != existing_user.id)
        if (await db.execute(phone_query)).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="An account with this phone number already exists")

    school_type = (payload.school_type or "").lower().strip() or None
    if school_type and school_type not in ("private", "public"):
        raise HTTPException(status_code=422, detail="school_type must be private or public")
    category = (payload.category or "").lower().strip() or None
    if category and category not in ("mixed", "boys", "girls"):
        raise HTTPException(status_code=422, detail="category must be mixed, boys or girls")

    campus = SchoolCampus(
        name=payload.school_name.strip(),
        slug=await _unique_slug(db, payload.school_name),
        city=payload.city,
        state=payload.state,
        address=payload.address,
        logo_url=payload.logo_url,
        school_type=school_type,
        category=category,
        contact_email=email,
        contact_phone=phone,
        is_active=True,
        # Owner spec §3: every registration starts as PENDING until the
        # Super Admin reviews and approves it.
        approval_status="pending",
        subscription_active=False,  # flipped on when super admin confirms payment
        subscription_plan=plan,
        requested_features=requested_features or None,
    )
    db.add(campus)
    await db.flush()

    if existing_user is not None:
        # The existing account becomes the school's admin; the password chosen
        # in this form is now the account's password.
        admin = existing_user
        admin.role = UserRole.school_admin
        admin.school_id = campus.id
        admin.hashed_password = hash_password(payload.admin_password)
        if phone:
            admin.phone = phone
        linked_account = True
    else:
        admin = User(
            email=email,
            hashed_password=hash_password(payload.admin_password),
            full_name=payload.admin_full_name.strip(),
            phone=phone,
            role=UserRole.school_admin,
            school_id=campus.id,
            is_active=True,
        )
        db.add(admin)
        linked_account = False
    await db.flush()

    sub = SchoolSubscription(
        school_id=campus.id,
        plan=plan or "basic",  # provisional; Super Admin sets the real plan on approval
        price_ngn=plan_price_ngn(plan) if plan else 0,
        term_label="pending review" if not plan else "pending payment",
        is_active=False,  # pending until super admin confirms payment
        changed_by="self-registration",
    )
    audit = SchoolPlanAudit(
        school_id=campus.id,
        old_plan=None,
        new_plan=plan or "basic",
        amount_ngn=0,  # only counted when confirmed
        term_label="pending review" if not plan else "pending payment",
        changed_by="self-registration",
    )
    db.add_all([sub, audit])
    await db.commit()

    return {
        "school_id": str(campus.id),
        "slug": campus.slug,
        "school_url": f"https://{campus.slug}.{BASE_DOMAIN_DEFAULT}/",
        "school_path_url": f"https://scholaxia1.onrender.com/school/{campus.slug}/",
        "custom_domain": campus.custom_domain,
        "live_setup": {
            "model": "scholaxia_link_with_optional_custom_domain",
            "status": "pending_review",
            "note": (
                "Your school has a unique Scholaxia link. If you later want "
                "your own domain, the Scholaxia team can host it and connect "
                "it to this same school portal."
            ),
        },
        "plan": plan,
        "price_ngn": plan_price_ngn(plan) if plan else 0,
        "requested_features": requested_features,
        "school_type": campus.school_type,
        "category": campus.category,
        "status": "pending_review",
        "approval_status": "pending",
        "account_linked": linked_account,
        "message": (
            "Registration received! Your school is now pending review by the Scholaxia "
            "team. This email is your school's admin account — sign in with the password "
            "you just created. You'll be notified once your school is approved."
            if linked_account
            else "Registration received! Your school is now pending review by the Scholaxia "
            "team. You'll be notified once your school is approved."
        ),
    }


# ------------------------------------------- school hostname resolution ----

class SchoolPublicOut(BaseModel):
    slug: str
    name: str
    city: str | None = None
    state: str | None = None
    plan: str | None = None
    logo_url: str | None = None


@router.get("/public/schools/by-slug/{slug}")
async def school_by_slug(slug: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Resolve a school's private link (greensprings.scholaxia.com)."""
    row = (
        await db.execute(
            select(SchoolCampus).where(SchoolCampus.slug == slug.lower().strip(), SchoolCampus.is_active.is_(True))
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="School not found")
    sub = await _active_subscription(db, row.id)
    return {
        "school_id": str(row.id),
        "slug": row.slug,
        "name": row.name,
        "city": row.city,
        "state": row.state,
        "plan": sub.plan if sub else None,
        "logo_url": getattr(row, "logo_url", None),
        "school_type": getattr(row, "school_type", None),
        "category": getattr(row, "category", None),
    }


@router.get("/public/schools/resolve-host")
async def resolve_host(host: str = Query(..., description="e.g. greensprings.scholaxia.com or school.example"),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """Resolve a Scholaxia subdomain or an admin-configured custom domain."""
    host = (host or "").lower().strip().split(":")[0]
    base = BASE_DOMAIN_DEFAULT
    if host.endswith(f".{base}") and host != f"www.{base}":
        slug = host[: -len(base) - 1]
        if slug and "." not in slug:
            try:
                return {"school": await school_by_slug(slug, db)}
            except HTTPException:
                return {"school": None}
    if host in (base, f"www.{base}"):
        return {"school": None}
    custom_host = host.removeprefix("www.")
    slug = (
        await db.execute(
            select(SchoolCampus.slug).where(
                func.lower(SchoolCampus.custom_domain) == custom_host,
                SchoolCampus.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not slug:
        return {"school": None}
    try:
        return {"school": await school_by_slug(slug, db)}
    except HTTPException:
        return {"school": None}


# ------------------------------------------------------ plan management ----

class PlanChangeIn(BaseModel):
    plan: str
    term_label: str = Field(default="", max_length=80)
    months: int = Field(default=0, ge=0, le=36, description="Sets expiry; 0 = open-ended")
    amount_paid_ngn: float = Field(default=0, ge=0)
    notes: str | None = None


@router.get("/school/me/plan")
async def my_plan(current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)) -> dict:
    """What the school portal uses to decide which buttons to show."""
    sid = current_user.get("school_id")
    if not sid:
        raise HTTPException(status_code=400, detail="No school linked to this account")
    campus = (
        await db.execute(select(SchoolCampus).where(SchoolCampus.id == UUID(sid)))
    ).scalar_one_or_none()
    if not campus:
        raise HTTPException(status_code=404, detail="School not found")
    sub = await _active_subscription(db, campus.id)
    plan = sub.plan if sub else campus.subscription_plan
    features = _features_response(plan)
    return {
        "school_id": sid,
        "school_name": campus.name,
        "slug": campus.slug,
        "plan": plan,
        "features": features["features"],
        "subscription_active": bool(sub),
        "expires_at": sub.expires_at.isoformat() if sub and sub.expires_at else None,
        "term_label": sub.term_label if sub else None,
        "price_ngn": plan_price_ngn(plan) if plan else 0,
    }


def require_school_feature(feature: str):
    """Dependency factory: gate any endpoint behind a plan feature.

    Owner spec §7: the check is plan + per-school overrides — the Super
    Admin's feature toggles apply here, so a disabled feature is blocked
    even if the plan includes it.

    Usage:  deps = [Depends(require_school_feature("cbt"))]
    """

    async def _inner(current_user: dict = Depends(require_school_staff), db: AsyncSession = Depends(get_db)) -> dict:
        sid = current_user.get("school_id")
        if not sid:
            raise HTTPException(status_code=400, detail="No school linked to this account")
        sub = await _active_subscription(db, UUID(sid))
        plan = sub.plan if sub else None
        override = None
        try:
            campus = (
                await db.execute(select(SchoolCampus.feature_overrides).where(SchoolCampus.id == UUID(sid)))
            ).scalar_one_or_none()
            override = (campus or {}).get(feature)
        except Exception:
            override = None
        if override is False:
            pretty = feature.replace("_", " ")
            raise HTTPException(
                status_code=403,
                detail=f"{pretty.capitalize()} has been disabled for your school by the Scholaxia team.",
            )
        if not plan or not plan_has_feature(plan, feature):
            pretty = feature.replace("_", " ")
            raise HTTPException(
                status_code=402,
                detail=f"This feature is not in your plan. Please upgrade to use {pretty}.",
            )
        return current_user

    return _inner


# -------------------------------------------------------- super admin ----

@router.get("/super-admin/schools")
async def list_schools(
    q: str | None = None,
    plan: str | None = None,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(SchoolCampus).order_by(SchoolCampus.created_at.desc()).limit(500)
    rows = (await db.execute(stmt)).scalars().all()
    out = []
    for r in rows:
        sub = await _active_subscription(db, r.id)
        plan_now = sub.plan if sub else None
        if plan and plan_now != plan.lower():
            continue
        if q and q.lower() not in (r.name or "").lower() and q.lower() not in (r.slug or ""):
            continue
        admin = (
            await db.execute(
                select(User.email, User.full_name).where(
                    User.school_id == r.id, User.role == UserRole.school_admin
                )
            )
        ).first()
        out.append(
            {
                "school_id": str(r.id),
                "name": r.name,
                "slug": r.slug,
                "city": r.city,
                "state": r.state,
                "plan": plan_now,
                "subscription_active": bool(sub),
                "expires_at": sub.expires_at.isoformat() if sub and sub.expires_at else None,
                "term_label": sub.term_label if sub else None,
                "price_ngn": plan_price_ngn(plan_now) if plan_now else 0,
                "admin_email": admin[0] if admin else None,
                "admin_name": admin[1] if admin else None,
                "is_active": r.is_active,
                "approval_status": r.approval_status or "approved",
                "approved_at": r.approved_at.isoformat() if r.approved_at else None,
                "rejection_reason": r.rejection_reason,
                "feature_overrides": r.feature_overrides or {},
                "requested_features": list(r.requested_features or []),
                "custom_domain": r.custom_domain,
                "contact_email": r.contact_email,
                "contact_phone": r.contact_phone,
                "logo_url": getattr(r, "logo_url", None),
                "school_type": getattr(r, "school_type", None),
                "category": getattr(r, "category", None),
            }
        )
    return {"schools": out, "count": len(out)}


@router.post("/super-admin/schools/{school_id}/plan", status_code=201)
async def change_school_plan(
    school_id: UUID,
    payload: PlanChangeIn,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """The one-button upgrade/downgrade. Deactivates old subs, writes a new
    active sub + an income audit row (only when money was actually paid)."""
    plan = (payload.plan or "").lower().strip()
    if plan not in ALL_PLANS:
        raise HTTPException(status_code=422, detail=f"plan must be one of {list(ALL_PLANS)}")

    campus = (
        await db.execute(select(SchoolCampus).where(SchoolCampus.id == school_id))
    ).scalar_one_or_none()
    if not campus:
        raise HTTPException(status_code=404, detail="School not found")

    current = await _active_subscription(db, school_id)
    old_plan = current.plan if current else None

    if current:
        current.is_active = False

    expires = naive_utc_now() + timedelta(days=30 * payload.months) if payload.months else None
    amount = float(payload.amount_paid_ngn or plan_price_ngn(plan))
    sub = SchoolSubscription(
        school_id=school_id,
        plan=plan,
        price_ngn=amount,
        term_label=payload.term_label,
        starts_at=naive_utc_now(),
        expires_at=expires,
        is_active=True,
        changed_by=current_user.get("email") or "super-admin",
        notes=payload.notes,
    )
    audit = SchoolPlanAudit(
        school_id=school_id,
        old_plan=old_plan,
        new_plan=plan,
        amount_ngn=amount,
        term_label=payload.term_label,
        changed_by=current_user.get("email") or "super-admin",
    )
    campus.subscription_plan = plan
    campus.subscription_active = True
    db.add_all([sub, audit])
    await db.commit()

    return {
        "school_id": str(school_id),
        "old_plan": old_plan,
        "new_plan": plan,
        "subscription_active": True,
        "expires_at": expires.isoformat() if expires else None,
    }


# ------------------------------------------- approval + feature control ----

class ReviewIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class FeatureTogglesIn(BaseModel):
    # {"attendance": true, "fees": false, ...} — omitted features are untouched
    features: dict[str, bool]


class SchoolEditIn(BaseModel):
    """Super-admin edits to a school's branding and optional hosted domain."""
    slug: str | None = Field(default=None, min_length=2, max_length=60)
    logo_url: str | None = Field(default=None, max_length=500)
    school_type: str | None = Field(default=None, max_length=20)  # private | public
    category: str | None = Field(default=None, max_length=20)  # mixed | boys | girls
    custom_domain: str | None = Field(default=None, max_length=255)  # hosted custom domain; "" clears


async def _campus_or_404(db: AsyncSession, school_id: UUID) -> SchoolCampus:
    campus = (
        await db.execute(select(SchoolCampus).where(SchoolCampus.id == school_id))
    ).scalar_one_or_none()
    if not campus:
        raise HTTPException(status_code=404, detail="School not found")
    return campus


@router.post("/super-admin/schools/{school_id}/approve")
async def approve_school(
    school_id: UUID,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Approve the school and activate its unique Scholaxia link."""
    campus = await _campus_or_404(db, school_id)
    campus.approval_status = "approved"
    campus.approved_at = naive_utc_now()
    campus.rejection_reason = None
    campus.is_active = True
    await db.commit()
    return {
        "school_id": str(campus.id),
        "approval_status": "approved",
        "slug": campus.slug,
        "school_url": f"https://{campus.slug}.{BASE_DOMAIN_DEFAULT}/",
        "custom_domain": campus.custom_domain,
        "live_setup_note": (
            "School approved. Its Scholaxia link is ready; an optional custom "
            "domain can be connected by the Scholaxia team."
        ),
    }


@router.post("/super-admin/schools/{school_id}/reject")
async def reject_school(
    school_id: UUID,
    payload: ReviewIn,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    campus = await _campus_or_404(db, school_id)
    campus.approval_status = "rejected"
    campus.rejection_reason = (payload.reason or "").strip() or None
    campus.is_active = False
    await db.commit()
    return {"school_id": str(campus.id), "approval_status": "rejected"}


@router.post("/super-admin/schools/{school_id}/suspend")
async def suspend_school(
    school_id: UUID,
    payload: ReviewIn,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    campus = await _campus_or_404(db, school_id)
    campus.approval_status = "suspended"
    campus.rejection_reason = (payload.reason or "").strip() or None
    campus.is_active = False
    await db.commit()
    return {"school_id": str(campus.id), "approval_status": "suspended"}


@router.post("/super-admin/schools/{school_id}/reactivate")
async def reactivate_school(
    school_id: UUID,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Lift a suspension — back to approved/active."""
    campus = await _campus_or_404(db, school_id)
    campus.approval_status = "approved"
    campus.rejection_reason = None
    campus.is_active = True
    await db.commit()
    return {"school_id": str(campus.id), "approval_status": "approved"}


@router.patch("/super-admin/schools/{school_id}")
async def edit_school(
    school_id: UUID,
    payload: SchoolEditIn,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Super-admin edits a school's branding and optional custom domain."""
    campus = await _campus_or_404(db, school_id)

    if payload.slug is not None:
        new_slug = slugify(payload.slug)[:60]
        if not new_slug:
            raise HTTPException(status_code=422, detail="Slug cannot be empty")
        if new_slug != campus.slug:
            clash = (
                await db.execute(select(SchoolCampus.id).where(SchoolCampus.slug == new_slug))
            ).scalar_one_or_none()
            if clash:
                raise HTTPException(status_code=409, detail=f"The link '{new_slug}' is already taken by another school")
            campus.slug = new_slug

    if payload.custom_domain is not None:
        raw = (payload.custom_domain or "").strip().lower()
        # Accept pasted URLs too: https://www.dove.com/ → dove.com.
        raw = raw.removeprefix("https://").removeprefix("http://")
        raw = raw.removeprefix("www.").rstrip("/").strip()
        if raw and not re.fullmatch(
            r"(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",
            raw,
        ):
            raise HTTPException(status_code=422, detail="Domain must look like dove.com or school.dove.com")
        if raw:
            duplicate = (
                await db.execute(
                    select(SchoolCampus.id).where(
                        func.lower(SchoolCampus.custom_domain) == raw,
                        SchoolCampus.id != campus.id,
                    )
                )
            ).scalar_one_or_none()
            if duplicate:
                raise HTTPException(status_code=409, detail="This custom domain is already assigned to another school")
        campus.custom_domain = raw or None

    if payload.logo_url is not None:
        campus.logo_url = payload.logo_url.strip() or None
    if payload.school_type is not None:
        st = payload.school_type.lower().strip() or None
        if st and st not in ("private", "public"):
            raise HTTPException(status_code=422, detail="school_type must be private or public")
        campus.school_type = st
    if payload.category is not None:
        cat = payload.category.lower().strip() or None
        if cat and cat not in ("mixed", "boys", "girls"):
            raise HTTPException(status_code=422, detail="category must be mixed, boys or girls")
        campus.category = cat

    await db.commit()
    return {
        "school_id": str(campus.id),
        "slug": campus.slug,
        "custom_domain": campus.custom_domain,
        "logo_url": campus.logo_url,
        "school_type": campus.school_type,
        "category": campus.category,
    }


@router.get("/super-admin/schools/{school_id}/features")
async def school_features(
    school_id: UUID,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Owner spec §7: every feature + whether it's on for this school
    (plan-derived, then per-school overrides on top)."""
    campus = await _campus_or_404(db, school_id)
    sub = await _active_subscription(db, school_id)
    plan = sub.plan if sub else campus.subscription_plan
    overrides = campus.feature_overrides or {}
    features = {}
    for f in ALL_FEATURES:
        plan_on = plan_has_feature(plan, f)
        override = overrides.get(f)
        if override is None:
            effective = plan_on
        else:
            effective = bool(override) and plan_on  # overrides can only turn OFF, or re-enable a plan feature
        features[f] = {
            "plan_includes": plan_on,
            "override": override,
            "enabled": effective,
        }
    return {
        "school_id": str(campus.id),
        "school_name": campus.name,
        "plan": plan,
        "features": features,
    }


@router.post("/super-admin/schools/{school_id}/features")
async def set_school_features(
    school_id: UUID,
    payload: FeatureTogglesIn,
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Owner spec §7: Super Admin enables/disables individual features per
    school, independent of the plan."""
    campus = await _campus_or_404(db, school_id)
    unknown = [k for k in payload.features if k not in ALL_FEATURES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown features: {unknown}")
    overrides = dict(campus.feature_overrides or {})
    for fname, on in payload.features.items():
        overrides[fname] = bool(on)
    campus.feature_overrides = overrides
    await db.commit()
    return {"school_id": str(campus.id), "feature_overrides": overrides}


@router.get("/super-admin/income")
async def income(
    current_user: dict = Depends(_require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """All income from subscriptions + scratch cards, for the dashboard."""
    sub_total = (
        await db.execute(select(func.coalesce(func.sum(SchoolPlanAudit.amount_ngn), 0)))
    ).scalar() or 0
    by_school = (
        await db.execute(
            select(
                SchoolPlanAudit.school_id,
                func.coalesce(func.sum(SchoolPlanAudit.amount_ngn), 0).label("total"),
            )
            .group_by(SchoolPlanAudit.school_id)
            .order_by(func.coalesce(func.sum(SchoolPlanAudit.amount_ngn), 0).desc())
        )
    ).all()
    from app.models.school_results import ScratchCardSale

    card_total = (
        await db.execute(select(func.coalesce(func.sum(ScratchCardSale.total_ngn), 0)))
    ).scalar() or 0
    school_names = {
        str(r.id): r.name
        for r in (await db.execute(select(SchoolCampus.id, SchoolCampus.name))).all()
    }
    return {
        "subscriptions_total_ngn": float(sub_total),
        "scratch_cards_total_ngn": float(card_total),
        "grand_total_ngn": float(sub_total) + float(card_total),
        "by_school": [
            {
                "school_id": str(school_id),
                "school_name": school_names.get(str(school_id), "?"),
                "subscriptions_ngn": float(total),
            }
            for school_id, total in by_school
        ],
    }
