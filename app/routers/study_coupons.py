"""Study activation codes — per-skill unlock for Video Tutorials (no plans).

Owner rule (v2): Video Tutorials never unlock with a subscription. The
admin/tutor issues an activation CODE for one specific skill; a code for
skill A never unlocks skill B. Each code carries a duration (access_days)
that starts when the student redeems it. Admin can also filter students by
signup month and revoke their tutorial access.
"""
from datetime import timedelta
import logging
import re
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.datetime_utils import naive_utc_now
from app.core.redeem_body import extract_redeem_code
from app.core.deps import require_admin, require_student_or_kind
from app.models.study_coupon import StudyCoupon, StudyCouponRedemption

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/study-coupons", tags=["Study coupons"])

SKILL_CHOICES = [
    "all",
    "academics",
    "web design",
    "app development",
    "software development",
    "digital marketing",
    "graphics design",
    "cyber security",
    "data analysis",
]


def _new_code() -> str:
    return "SXSTUDY-" + secrets.token_hex(4).upper()


def _normalize_code(raw: str) -> str:
    return re.sub(r"\s+", "", (raw or "").strip().upper())


def _normalize_skill(raw: Optional[str]) -> str:
    s = (raw or "all").strip().lower()
    return s if s in SKILL_CHOICES else "all"


def _as_uuid(value) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid account id") from exc


def _coupon_dict(row: StudyCoupon, redeemers: list | None = None) -> dict:
    return {
        "id": str(row.id),
        "code": row.code,
        "skill": row.skill or "all",
        "max_uses": row.max_uses,
        "used_count": row.used_count,
        "is_active": row.is_active,
        "note": row.note,
        "access_days": row.access_days,
        "assigned_email": (row.note or "").replace("for:", "").strip()
        if (row.note or "").lower().startswith("for:")
        else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "redeemed_by": redeemers or [],
    }


# ──────────────────────────── ADMIN ────────────────────────────


class CouponCreate(BaseModel):
    count: int = Field(default=1, ge=1, le=50)
    max_uses: int = Field(default=1, ge=1, le=1000)
    days_valid: int = Field(default=365, ge=1, le=3650)   # how long the CODE itself stays redeemable
    access_days: int = Field(default=30, ge=1, le=3650)   # how long STUDENT ACCESS lasts after redeem
    skill: str = Field(..., min_length=1, max_length=60)
    note: Optional[str] = None


@router.post("/admin/create")
async def admin_create_coupons(
    payload: CouponCreate,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Issue N codes at once for ONE skill with an access duration."""
    now = naive_utc_now()
    expires = now + timedelta(days=payload.days_valid)
    skill = (payload.skill or "").strip().lower()
    if skill not in SKILL_CHOICES:
        raise HTTPException(
            status_code=400,
            detail="Select a valid category for this activation code.",
        )
    codes = []
    for _ in range(payload.count):
        row = StudyCoupon(
            code=_new_code(),
            skill=skill,
            max_uses=payload.max_uses,
            is_active=True,
            note=(payload.note or "").strip() or None,
            expires_at=expires,
            access_days=payload.access_days,
            created_by=_as_uuid(current_user["sub"]),
        )
        db.add(row)
        codes.append(row.code)
    await db.flush()
    return {
        "ok": True,
        "codes": codes,
        "skill": skill,
        "access_days": payload.access_days,
        "expires_at": expires.isoformat(),
    }


@router.get("/admin/list")
async def admin_list_coupons(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        (await db.execute(select(StudyCoupon).order_by(StudyCoupon.created_at.desc()).limit(300)))
        .scalars()
        .all()
    )
    ids = [r.id for r in rows]
    redeemers: dict[uuid.UUID, list] = {}
    if ids:
        res = await db.execute(
            select(
                StudyCouponRedemption.coupon_id,
                StudyCouponRedemption.student_id,
                StudyCouponRedemption.created_at,
            ).where(StudyCouponRedemption.coupon_id.in_(ids))
        )
        for coupon_id, student_id, when in res.all():
            redeemers.setdefault(coupon_id, []).append(
                {
                    "student_id": str(student_id),
                    "redeemed_at": when.isoformat() if when else None,
                }
            )
    return {"coupons": [_coupon_dict(r, redeemers.get(r.id, [])) for r in rows]}


@router.post("/admin/{coupon_id}/activate")
async def admin_activate_coupon(
    coupon_id: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(select(StudyCoupon).where(StudyCoupon.id == _as_uuid(coupon_id)))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Coupon not found")
    row.is_active = True
    await db.flush()
    return {"ok": True, "coupon": _coupon_dict(row)}


@router.post("/admin/{coupon_id}/deactivate")
async def admin_deactivate_coupon(
    coupon_id: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(select(StudyCoupon).where(StudyCoupon.id == _as_uuid(coupon_id)))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Coupon not found")
    row.is_active = False
    await db.flush()
    return {"ok": True, "coupon": _coupon_dict(row)}


# ── Admin: students list / permission management ─────────────────────────────


class RevokeRequest(BaseModel):
    student_id: str
    skill: Optional[str] = None


@router.get("/admin/students")
async def admin_students_access(
    month: Optional[str] = None,
    skill: Optional[str] = None,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Students with their per-skill tutorial access.

    month=YYYY-MM filters by signup month (owner: restrict/delete a cohort).
    skill narrows to one skill's access.
    """
    import datetime as dt

    q = select(StudyCouponRedemption)
    rows = (await db.execute(q)).scalars().all()
    by_student: dict[uuid.UUID, list] = {}
    for r in rows:
        by_student.setdefault(r.student_id, []).append(r)

    from app.models.user import User

    out = []
    for student_id, reds in by_student.items():
        user = (
            await db.execute(select(User).where(User.id == student_id))
        ).scalar_one_or_none()
        if not user:
            continue
        if month:
            created = getattr(user, "created_at", None)
            if not created:
                continue
            m = created if isinstance(created, dt.datetime) else None
            if m and m.strftime("%Y-%m") != month:
                continue
        access = []
        for r in reds:
            active = r.expires_at is None or r.expires_at >= naive_utc_now()
            if skill and (r.skill or "all") != _normalize_skill(skill):
                continue
            access.append(
                {
                    "skill": r.skill or "all",
                    "active": active,
                    "expires_at": r.expires_at.isoformat() if r.expires_at else None,
                    "redemption_id": str(r.id),
                }
            )
        if skill and not access:
            continue
        out.append(
            {
                "student_id": str(student_id),
                "name": user.full_name,
                "email": user.email,
                "signed_up_month": getattr(user, "created_at", None).strftime("%Y-%m")
                if getattr(user, "created_at", None)
                else None,
                "access": access,
            }
        )
    return {"students": out, "count": len(out)}


@router.post("/admin/revoke")
async def admin_revoke_access(
    payload: "RevokeRequest",
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a student's tutorial access — whole account or one skill."""
    sid = _as_uuid(payload.student_id)
    reds = (
        await db.execute(select(StudyCouponRedemption).where(StudyCouponRedemption.student_id == sid))
    ).scalars().all()
    if not reds:
        raise HTTPException(status_code=404, detail="No tutorial access found for this student")
    now = naive_utc_now()
    revoked = 0
    for r in reds:
        if payload.skill and (r.skill or "all") != _normalize_skill(payload.skill):
            continue
        if r.expires_at is None or r.expires_at >= now:
            r.expires_at = now
            await db.execute(
                text("UPDATE study_coupons SET is_active = FALSE WHERE id = :cid"),
                {"cid": str(r.coupon_id)},
            )
            revoked += 1
    await db.flush()
    return {"ok": True, "revoked": revoked}


# ─────────────────────────── STUDENT ───────────────────────────


class CouponRedeem(BaseModel):
    code: str = Field(min_length=4, max_length=60)


@router.post("/redeem", response_model=None)
async def redeem_coupon(
    request: Request,
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    """Activate a per-skill code — grants that skill (or all) for access_days."""
    # NOTE: deliberately NO pydantic body param. FastAPI validates that before
    # the handler runs, so a quirky body would 422 before we could recover it.
    # Older clients send the code as a double-encoded JSON string or a bare
    # token; extract_redeem_code accepts every sensible shape instead.
    raw_code = await extract_redeem_code(request)
    if not raw_code:
        raise HTTPException(status_code=400, detail="Enter an activation code")
    code = _normalize_code(raw_code)
    if not code:
        raise HTTPException(status_code=400, detail="Enter an activation code")

    row = (
        await db.execute(select(StudyCoupon).where(StudyCoupon.code == code))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Activation code not found")
    if not row.is_active:
        raise HTTPException(status_code=400, detail="This activation code is not active")
    if row.expires_at and row.expires_at < naive_utc_now():
        raise HTTPException(status_code=400, detail="This activation code has expired")
    if row.used_count >= row.max_uses:
        raise HTTPException(status_code=400, detail="This activation code has been fully used")

    sid = _as_uuid(current_user["sub"])
    already = (
        await db.execute(
            select(StudyCouponRedemption).where(
                StudyCouponRedemption.coupon_id == row.id,
                StudyCouponRedemption.student_id == sid,
            )
        )
    ).scalar_one_or_none()
    if already:
        return {
            "ok": True,
            "already_redeemed": True,
            "skill": row.skill or "all",
            "message": "Activation code already used on this account",
        }

    days = row.access_days if row.access_days else 30
    skill = row.skill or "all"
    access_until = naive_utc_now() + timedelta(days=days)
    db.add(
        StudyCouponRedemption(
            coupon_id=row.id, student_id=sid, skill=skill, expires_at=access_until
        )
    )
    row.used_count = (row.used_count or 0) + 1
    await db.flush()
    label = "all skills" if skill == "all" else skill.title()
    return {
        "ok": True,
        "skill": skill,
        "access_days": days,
        "expires_at": access_until.isoformat(),
        "message": "🎉 Code accepted — %s unlocked for %d days!" % (label, days),
        "code": row.code,
    }
