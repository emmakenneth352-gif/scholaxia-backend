from datetime import timedelta
import logging
import hashlib
import re
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cbt_packages import (
    all_cbt_packages_dict,
    get_cbt_package,
    get_plan_meta,
    refresh_cbt_overrides,
)
from app.core.database import get_db, engine
from app.core.datetime_utils import naive_utc_now
from app.core.redeem_body import extract_redeem_code
from app.core.deps import require_admin, require_student_or_kind
from app.models.cbt_coupon import CbtCoupon, CbtCouponRedemption
from app.models.guest_cbt_access import GuestCbtAccess
from app.services.cbt_access import grant_cbt_package

logger = logging.getLogger(__name__)
router = APIRouter(tags=["CBT coupons"])


def _new_code() -> str:
    return "SX-" + secrets.token_hex(4).upper()


def _normalize_code(raw: str) -> str:
    code = re.sub(r"\s+", "", (raw or "").strip().upper())
    return code.replace("–", "-").replace("—", "-")


def _as_uuid(value) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid account id") from exc


def _coupon_dict(row: CbtCoupon, redeemers: list | None = None) -> dict:
    return {
        "id": str(row.id),
        "code": row.code,
        "package_id": row.package_id,
        "max_uses": row.max_uses,
        "used_count": row.used_count,
        "is_active": row.is_active,
        "note": row.note,
        "assigned_email": (row.note or "").replace("for:", "").strip() if (row.note or "").lower().startswith("for:") else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "redeemed_by": redeemers or [],
    }


async def _ensure_coupon_tables() -> None:
    """Create coupon tables if a prior deploy missed them."""
    stmts = (
        """
        CREATE TABLE IF NOT EXISTS cbt_coupons (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code VARCHAR(40) NOT NULL UNIQUE,
            package_id VARCHAR(80) NOT NULL,
            max_uses INTEGER DEFAULT 1,
            used_count INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT TRUE,
            note TEXT NULL,
            expires_at TIMESTAMP NULL,
            created_by UUID NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_cbt_coupons_code ON cbt_coupons (code)",
        """
        CREATE TABLE IF NOT EXISTS cbt_coupon_redemptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            coupon_id UUID NOT NULL REFERENCES cbt_coupons(id),
            student_id UUID NOT NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_cbt_coupon_redemptions_coupon_id ON cbt_coupon_redemptions (coupon_id)",
        "CREATE INDEX IF NOT EXISTS ix_cbt_coupon_redemptions_student_id ON cbt_coupon_redemptions (student_id)",
    )
    try:
        async with engine.begin() as conn:
            for stmt in stmts:
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    logger.warning("coupon table stmt skipped: %s", exc)
    except Exception as exc:
        logger.warning("ensure coupon tables failed: %s", exc)


async def _find_coupon(db: AsyncSession, code: str) -> Optional[CbtCoupon]:
    """Exact match first, then case/dash-insensitive scan of active codes."""
    row = (await db.execute(select(CbtCoupon).where(CbtCoupon.code == code))).scalar_one_or_none()
    if row:
        return row
    # Also try lowercase storage variants
    row = (
        await db.execute(select(CbtCoupon).where(CbtCoupon.code == code.lower()))
    ).scalar_one_or_none()
    if row:
        return row
    compact = code.replace("-", "")
    rows = (await db.execute(select(CbtCoupon).where(CbtCoupon.is_active.is_(True)).limit(500))).scalars().all()
    for candidate in rows:
        stored = _normalize_code(candidate.code or "")
        if stored == code or stored.replace("-", "") == compact:
            return candidate
    return None


class GenerateCouponRequest(BaseModel):
    package_id: str
    count: int = Field(1, ge=1, le=50)
    max_uses: int = Field(1, ge=1, le=10000)
    note: Optional[str] = None
    student_email: Optional[str] = None
    days_valid: Optional[int] = Field(None, ge=1, le=730)


class RedeemCouponRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=40)


@router.get("/admin/cbt-coupons")
async def list_coupons(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_coupon_tables()
    from app.models.user import User
    from app.models.cbt_coupon import CbtCouponRedemption

    rows = (
        await db.execute(select(CbtCoupon).order_by(CbtCoupon.created_at.desc()).limit(200))
    ).scalars().all()
    coupon_ids = [r.id for r in rows]
    redeemers_by_coupon: dict = {str(cid): [] for cid in coupon_ids}
    if coupon_ids:
        red_rows = (
            await db.execute(
                select(CbtCouponRedemption, User)
                .join(User, User.id == CbtCouponRedemption.student_id)
                .where(CbtCouponRedemption.coupon_id.in_(coupon_ids))
                .order_by(CbtCouponRedemption.created_at.desc())
            )
        ).all()
        for red, user in red_rows:
            redeemers_by_coupon.setdefault(str(red.coupon_id), []).append(
                {
                    "name": user.full_name or user.email,
                    "email": user.email,
                    "at": red.created_at.isoformat() if red.created_at else None,
                }
            )
    await refresh_cbt_overrides(db)
    return {
        "coupons": [
            _coupon_dict(r, redeemers_by_coupon.get(str(r.id), []))
            for r in rows
        ],
        "packages": all_cbt_packages_dict(),
    }


@router.post("/admin/cbt-coupons", status_code=201)
async def generate_coupons(
    payload: GenerateCouponRequest,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_coupon_tables()
    await refresh_cbt_overrides(db)
    if not get_cbt_package(payload.package_id) and not get_plan_meta(payload.package_id):
        raise HTTPException(status_code=400, detail="Unknown CBT package")
    expires = None
    if payload.days_valid:
        expires = naive_utc_now() + timedelta(days=payload.days_valid)
    created_by = None
    try:
        created_by = _as_uuid(current_user["sub"])
    except HTTPException:
        created_by = None
    note = (payload.note or "").strip() or None
    email = (payload.student_email or "").strip().lower()
    if email:
        note = f"for:{email}" + (f" | {note}" if note else "")
    created = []
    for _ in range(payload.count):
        row = CbtCoupon(
            code=_new_code(),
            package_id=payload.package_id.strip().lower(),
            max_uses=payload.max_uses,
            note=note,
            expires_at=expires,
            created_by=created_by,
        )
        db.add(row)
        await db.flush()
        created.append(_coupon_dict(row))
    return {"coupons": created}


@router.post("/admin/cbt-coupons/{coupon_id}/deactivate")
async def deactivate_coupon(
    coupon_id: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(CbtCoupon).where(CbtCoupon.id == coupon_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Coupon not found")
    row.is_active = False
    await db.flush()
    return _coupon_dict(row)


@router.post("/cbt/coupons/redeem")
async def redeem_coupon(
    request: Request,
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    """Redeem a coupon and grant CBT package access."""
    await _ensure_coupon_tables()

    # NOTE: deliberately NO pydantic body param — FastAPI would 422 a quirky
    # body before the handler could recover it. Older clients send the code
    # as a double-encoded JSON string or a bare token; extract_redeem_code
    # accepts every sensible shape instead.
    raw_code = await extract_redeem_code(request)
    if not raw_code:
        raise HTTPException(status_code=400, detail="Enter a valid coupon code")
    code = _normalize_code(raw_code)
    if len(code) < 4:
        raise HTTPException(status_code=400, detail="Enter a valid coupon code")

    try:
        row = await _find_coupon(db, code)
    except Exception as exc:
        logger.exception("coupon lookup failed")
        raise HTTPException(
            status_code=503,
            detail="Coupon table is not ready yet. Wait one minute after deploy, then try again.",
        ) from exc

    if not row or not row.is_active:
        raise HTTPException(status_code=400, detail="Invalid coupon code")
    now = naive_utc_now()
    if row.expires_at and row.expires_at < now:
        raise HTTPException(status_code=400, detail="This coupon has expired")
    if int(row.used_count or 0) >= int(row.max_uses or 1):
        raise HTTPException(status_code=400, detail="This coupon has already been used up")

    package_id = (row.package_id or "").strip().lower()
    await refresh_cbt_overrides(db)
    if not get_cbt_package(package_id) and not get_plan_meta(package_id):
        raise HTTPException(
            status_code=400,
            detail=f"Coupon package '{row.package_id}' is not valid. Ask admin to regenerate.",
        )

    student_id = _as_uuid(current_user["sub"])

    already = None
    try:
        async with db.begin_nested():
            already = (
                await db.execute(
                    select(CbtCouponRedemption).where(
                        CbtCouponRedemption.coupon_id == row.id,
                        CbtCouponRedemption.student_id == student_id,
                    )
                )
            ).scalar_one_or_none()
    except Exception:
        logger.warning("coupon redemption lookup skipped", exc_info=True)
        already = None

    if already:
        try:
            await grant_cbt_package(db, str(student_id), package_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("re-grant after coupon failed")
            detail = str(getattr(exc, "orig", None) or exc).replace("\n", " ")[:180]
            raise HTTPException(
                status_code=503,
                detail=f"Could not refresh CBT access: {detail}",
            ) from exc
        await db.flush()
        await db.commit()
        return {
            "ok": True,
            "package_id": package_id,
            "message": "Coupon already applied. CBT access refreshed.",
            "boards": _plan_boards(),
        }

    try:
        await grant_cbt_package(db, str(student_id), package_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("grant_cbt_package failed during redeem")
        detail = str(getattr(exc, "orig", None) or exc).replace("\n", " ")[:180]
        raise HTTPException(
            status_code=503,
            detail=f"Could not unlock CBT package: {detail}",
        ) from exc

    # Boards granted by this plan (built-in or custom)
    def _plan_boards() -> list:
        pkg = get_cbt_package(package_id)
        if pkg is not None:
            return list(pkg.boards)
        meta = get_plan_meta(package_id)
        return list(meta["boards"]) if meta else []

    try:
        db.add(CbtCouponRedemption(id=uuid.uuid4(), coupon_id=row.id, student_id=student_id))
        row.used_count = int(row.used_count or 0) + 1
        row.package_id = package_id
        await db.flush()
    except Exception as exc:
        logger.exception("coupon redemption record failed")
        # Access may already be granted — commit grant so Start can see it
        try:
            await db.commit()
        except Exception:
            pass
        return {
            "ok": True,
            "package_id": package_id,
            "message": "CBT access unlocked with coupon.",
            "boards": _plan_boards(),
            "warning": f"Redeem note failed ({type(exc).__name__})",
        }

    # Commit BEFORE response so the next Start/download request sees access
    await db.commit()
    return {
        "ok": True,
        "package_id": package_id,
        "message": "CBT access unlocked with coupon.",
        "boards": _plan_boards(),
    }


@router.post("/cbt/coupons/guest/redeem")
async def redeem_guest_coupon(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Redeem a CBT coupon without an account or email address."""
    await _ensure_coupon_tables()
    raw_code = await extract_redeem_code(request)
    if not raw_code:
        raise HTTPException(status_code=400, detail="Enter a valid coupon code")
    code = _normalize_code(raw_code)
    if len(code) < 4:
        raise HTTPException(status_code=400, detail="Enter a valid coupon code")

    try:
        found = await _find_coupon(db, code)
    except Exception as exc:
        logger.exception("guest coupon lookup failed")
        raise HTTPException(status_code=503, detail="Could not check this coupon. Try again shortly.") from exc
    if not found:
        raise HTTPException(status_code=400, detail="Invalid coupon code")

    row = (
        await db.execute(
            select(CbtCoupon).where(CbtCoupon.id == found.id).with_for_update()
        )
    ).scalar_one_or_none()
    if not row or not row.is_active:
        raise HTTPException(status_code=400, detail="Invalid coupon code")
    now = naive_utc_now()
    if row.expires_at and row.expires_at < now:
        raise HTTPException(status_code=400, detail="This coupon has expired")
    if int(row.used_count or 0) >= int(row.max_uses or 1):
        raise HTTPException(status_code=400, detail="This coupon has already been used up")

    package_id = (row.package_id or "").strip().lower()
    await refresh_cbt_overrides(db)
    package = get_cbt_package(package_id)
    meta = get_plan_meta(package_id)
    if not package and not meta:
        raise HTTPException(status_code=400, detail="This coupon refers to an invalid CBT package")
    duration_days = int(package.duration_days if package else meta.get("duration_days") or 365)
    boards = list(package.boards) if package else list(meta.get("boards") or [])
    token = secrets.token_urlsafe(32)
    access = GuestCbtAccess(
        token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        package_id=package_id,
        boards=boards,
        coupon_id=row.id,
        is_active=True,
        expires_at=now + timedelta(days=duration_days),
    )
    db.add(access)
    row.used_count = int(row.used_count or 0) + 1
    await db.flush()
    return {
        "ok": True,
        "package_id": package_id,
        "boards": boards,
        "guest_token": f"guest-cbt.{token}",
        "expires_at": access.expires_at.isoformat(),
        "message": "Coupon applied. CBT is unlocked on this device.",
    }


@router.get("/cbt/coupons/access")
async def coupon_access(
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    """Check if student has an active coupon (grants full CBT access)."""
    await _ensure_coupon_tables()
    
    student_id = _as_uuid(current_user["sub"])
    
    # Check if student has any coupon redemption
    from app.models.cbt_coupon import CbtCouponRedemption
    from app.models.cbt_coupon import CbtCoupon
    
    # Get recent coupon redemptions for this student
    redemptions = (
        await db.execute(
            select(CbtCouponRedemption, CbtCoupon)
            .join(CbtCoupon, CbtCoupon.id == CbtCouponRedemption.coupon_id)
            .where(CbtCouponRedemption.student_id == student_id)
            .order_by(CbtCouponRedemption.created_at.desc())
            .limit(10)
        )
    ).all()
    
    # Check if any active coupon grants access
    has_active_coupon = False
    package_boards = []
    
    for redemption, coupon in redemptions:
        if coupon.is_active and (coupon.expires_at is None or coupon.expires_at > naive_utc_now()):
            package = get_cbt_package(coupon.package_id)
            if package:
                has_active_coupon = True
                package_boards = list(package.boards)
                break
    
    return {
        "has_active_coupon": has_active_coupon,
        "boards": package_boards,
    }
