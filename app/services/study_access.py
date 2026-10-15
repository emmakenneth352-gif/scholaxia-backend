"""Study access — activation CODE ONLY (owner rule v2).

Video Tutorials do NOT unlock with any subscription/plan. Access is granted
per skill by an admin/tutor activation code (study_coupons). Each redemption
grants ONE skill (or all skills) for a duration starting at redeem time.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.datetime_utils import naive_utc_now


def _reason(source: str, plan_name: str, expires_at=None) -> dict:
    return {
        "unlocked": True,
        "source": source,
        "plan_name": plan_name,
        "expires_at": expires_at.isoformat() if expires_at else None,
    }


async def get_study_access_info(db: AsyncSession, student_id: str) -> dict:
    """Access gates for this student, activation codes only.

    Returns {unlocked, skills: {skill: {active, expires_at}}, ...} —
    the student sees exactly the skills whose codes they activated and that
    have not expired. 'all' grants every skill.
    """
    from app.models.study_coupon import StudyCoupon, StudyCouponRedemption

    now = naive_utc_now()
    skills: dict = {}
    try:
        rows = (
            await db.execute(
                select(StudyCouponRedemption, StudyCoupon)
                .join(StudyCoupon, StudyCoupon.id == StudyCouponRedemption.coupon_id)
                .where(StudyCouponRedemption.student_id == _parse(student_id))
                .order_by(StudyCouponRedemption.created_at.desc())
            )
        ).all()
        for redemption, coupon in rows:
            until = redemption.expires_at or (
                (naive_utc_now() + __import__("datetime").timedelta(days=coupon.access_days or 30))
                if coupon.access_days
                else None
            )
            skill = redemption.skill or coupon.skill or "all"
            active = until is None or until >= now
            prev = skills.get(skill)
            if not prev or (prev.get("expires_at_iso") or "") < (until.isoformat() if until else ""):
                skills[skill] = {
                    "active": active,
                    "expires_at": until.isoformat() if until else None,
                    "code": coupon.code,
                    "expires_at_iso": until.isoformat() if until else "",
                }
    except Exception:
        pass

    # "all" active → everything unlocked
    all_active = any(
        v.get("active") for k, v in skills.items() if k == "all"
    )
    unlocked = bool(all_active or any(v.get("active") for v in skills.values()))
    return {
        "unlocked": unlocked,
        "all_unlocked": bool(all_active),
        "skills": {k: {"active": v.get("active"), "expires_at": v.get("expires_at")} for k, v in skills.items()},
        "source": "coupon" if unlocked else None,
        "plan_name": None,
        "expires_at": None,
    }


def _parse(value: str):
    import uuid as uuid_lib
    return uuid_lib.UUID(str(value))
