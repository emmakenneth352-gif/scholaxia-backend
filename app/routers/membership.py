"""Monthly membership (paid subscription) endpoints.

- GET  /memberships/me          -> my status, expiry, days left, price
- GET  /memberships/audiences   -> how many paid members per group (teacher/admin)
- GET  /memberships/paid        -> the paid members list (teacher/admin)
- GET  /memberships/summary     -> counts + revenue (admin)
- POST /memberships/admin/sweep -> drop lapsed memberships now (admin)
"""
from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_teacher_or_admin
from app.models.payment import Subscription
from app.services.membership_service import (
    AUDIENCE_LABELS,
    get_active_subscription,
    membership_view,
    normalize_audience,
    paid_member_ids,
    paid_members,
    sweep_expired,
)
from app.services.platform_settings import get_values

router = APIRouter(prefix="/memberships", tags=["Memberships"])


@router.get("/me")
async def my_membership(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The signed-in student's monthly membership status."""
    sub = await get_active_subscription(db, current_user["sub"])
    values = await get_values(db)
    view = membership_view(sub, values)
    view["audiences"] = [
        {"key": key, "label": label} for key, label in AUDIENCE_LABELS.items()
    ]
    return view


@router.get("/audiences")
async def paid_audience_counts(
    current_user: dict = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Paid member counts per audience — what a teacher picks when hosting."""
    out = []
    for key, label in AUDIENCE_LABELS.items():
        ids = await paid_member_ids(db, key)
        out.append({"key": key, "label": label, "paid_students": len(ids)})
    return {"audiences": out}


@router.get("/paid")
async def list_paid_members(
    audience: str = Query("all"),
    limit: int = Query(300, ge=1, le=1000),
    current_user: dict = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Students whose monthly subscription is still active, by audience."""
    key = normalize_audience(audience)
    members = await paid_members(db, key, limit=limit)
    ids = await paid_member_ids(db, key)
    return {
        "audience": key,
        "audience_label": AUDIENCE_LABELS.get(key, "All students"),
        "count": len(ids),
        "members": members,
    }


@router.get("/summary")
async def membership_summary(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin overview: how many are paying, per group, and this month's money."""
    await sweep_expired(db)
    rows = (
        await db.execute(
            select(Subscription).where(Subscription.is_active.is_(True))
        )
    ).scalars().all()
    counts = Counter(normalize_audience(sub.audience) for sub in rows)
    return {
        "total_active": len(rows),
        "by_audience": [
            {"key": key, "label": label, "count": counts.get(key, 0)}
            for key, label in AUDIENCE_LABELS.items()
        ],
        "revenue_total": round(sum(float(sub.amount_paid or 0) for sub in rows), 2),
        "first_periods": sum(1 for sub in rows if sub.is_first_period),
        "renewals": sum(int(sub.renewal_count or 0) for sub in rows),
    }


@router.post("/admin/sweep")
async def sweep_now(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove every lapsed membership from the paid table immediately."""
    lapsed = await sweep_expired(db)
    await db.commit()
    return {"ok": True, "lapsed": lapsed}
