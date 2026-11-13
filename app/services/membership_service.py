"""Monthly paid membership rules (the "subscription table").

Owner rules encoded here
------------------------
* One payment covers ONE calendar month and expires on the same day next month
  (pay on the 22nd -> expires on the 22nd of the next month). A 31st payment in
  a short month expires on that month's last day instead of skipping a month.
* If a student does not pay again, the membership lapses and they drop out of
  the paid table (`is_active = False`) — they no longer receive paid-class
  notifications and can no longer join paid classes.
* Paid classes are targeted by audience: JAMB, WAEC, NECO, BECE and Coding.
* A student's very FIRST membership period gets a one-time bonus (extra days);
  renewals never get it again.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.datetime_utils import naive_utc_now
from app.models.payment import Subscription, SubscriptionPlan
from app.models.user import ExamType, StudentProfile, User
from app.services.platform_settings import get_values

# audience key -> StudentProfile.exam_type value(s)
EXAM_AUDIENCES: dict[str, tuple[str, ...]] = {
    "jamb": (ExamType.JAMB.value,),
    "waec": (ExamType.WAEC.value,),
    "neco": (ExamType.NECO.value,),
    "bece": (ExamType.JUNIOR_WAEC.value,),
    "post_utme": (ExamType.POST_UTME.value,),
}

AUDIENCE_ALIASES = {
    "junior_waec": "bece",
    "juniorwaec": "bece",
    "junior": "bece",
    "utme": "jamb",
    "post-utme": "post_utme",
    "postutme": "post_utme",
    "skills": "coding",
    "skill": "coding",
    "programming": "coding",
    "all": "all",
    "everyone": "all",
    "any": "all",
}

AUDIENCE_LABELS = {
    "all": "All students",
    "jamb": "JAMB",
    "waec": "WAEC",
    "neco": "NECO",
    "bece": "Junior WAEC (BECE)",
    "post_utme": "Post-UTME",
    "coding": "Coding / Skills",
}

PAID_AUDIENCES = tuple(AUDIENCE_LABELS.keys())


def normalize_audience(value: str | None) -> str:
    """Map whatever the client sends onto a known audience key."""
    raw = (value or "").strip().lower().replace(" ", "_")
    if not raw:
        return "all"
    raw = AUDIENCE_ALIASES.get(raw, raw)
    return raw if raw in AUDIENCE_LABELS else "all"


def audience_label(key: str | None) -> str:
    return AUDIENCE_LABELS.get(normalize_audience(key), "All students")


def add_one_period(start: datetime, months: int = 1) -> datetime:
    """Same day next month, clamped to the last day of a shorter month."""
    total = (start.month - 1) + months
    year = start.year + total // 12
    month = total % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return start.replace(year=year, month=month, day=day)


async def _latest_subscription(db: AsyncSession, user_id) -> Subscription | None:
    try:
        uid = uuid.UUID(str(user_id))
    except (ValueError, AttributeError, TypeError):
        return None
    res = await db.execute(
        select(Subscription)
        .where(Subscription.student_id == uid)
        .order_by(Subscription.expires_at.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()


async def audience_for_user(db: AsyncSession, user_id) -> str:
    """Which paid group this student belongs to (from their profile)."""
    try:
        uid = uuid.UUID(str(user_id))
    except (ValueError, AttributeError, TypeError):
        return "all"
    res = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == uid)
    )
    profile = res.scalar_one_or_none()
    if not profile:
        return "all"
    exam = profile.exam_type.value if hasattr(profile.exam_type, "value") else (profile.exam_type or "")
    exam = str(exam or "").upper()
    for key, values in EXAM_AUDIENCES.items():
        if exam in values:
            return key
    if (profile.ssce_exam_type or "").upper() == "WAEC":
        return "waec"
    if (profile.ssce_exam_type or "").upper() == "NECO":
        return "neco"
    return "all"


async def get_active_subscription(db: AsyncSession, user_id) -> Subscription | None:
    """Active, unexpired membership — lazy-expires the row when it has lapsed."""
    sub = await _latest_subscription(db, user_id)
    if not sub:
        return None
    now = naive_utc_now()
    if not sub.is_active:
        return None
    if not sub.expires_at or sub.expires_at <= now:
        sub.is_active = False
        await _sync_profile_flag(db, sub.student_id, False)
        await db.flush()
        return None
    return sub


async def _sync_profile_flag(db: AsyncSession, user_id, active: bool) -> None:
    try:
        uid = uuid.UUID(str(user_id))
    except (ValueError, AttributeError, TypeError):
        return
    res = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == uid)
    )
    profile = res.scalar_one_or_none()
    if profile is not None and bool(profile.has_active_subscription) != active:
        profile.has_active_subscription = active


async def activate_membership(
    db: AsyncSession,
    user_id,
    *,
    plan: SubscriptionPlan | None = None,
    amount: float = 0.0,
    reference: str | None = None,
    plan_label: str | None = None,
    audience: str | None = None,
) -> Subscription:
    """Start or renew the monthly membership. Returns the row.

    Renewing while still active extends from the current expiry, so paying a day
    early never costs the student the remaining days.
    """
    uid = uuid.UUID(str(user_id))
    now = naive_utc_now()
    values = await get_values(db)
    bonus_days = int(values.get("first_period_bonus_days") or 0)

    resolved_audience = normalize_audience(audience) if audience else await audience_for_user(db, uid)

    sub = await _latest_subscription(db, uid)
    renewing = bool(sub and sub.is_active and sub.expires_at and sub.expires_at > now)

    if sub is None:
        sub = Subscription(
            student_id=uid,
            plan=plan or SubscriptionPlan.basic,
            expires_at=now,
            is_active=True,
        )
        db.add(sub)

    if renewing:
        base = sub.expires_at
        sub.renewal_count = int(sub.renewal_count or 0) + 1
        sub.is_first_period = False
    else:
        base = now
        # First-timer benefit is for a genuinely first subscription only —
        # someone who lapsed and pays again does not get it a second time.
        sub.is_first_period = not bool(sub.payment_reference)
        sub.period_start = now

    new_expiry = add_one_period(base)
    if sub.is_first_period and bonus_days:
        new_expiry = new_expiry + timedelta(days=bonus_days)

    sub.expires_at = new_expiry
    sub.is_active = True
    sub.cancelled_at = None
    sub.last_renewed_at = now
    sub.audience = resolved_audience
    if amount:
        sub.amount_paid = float(amount)
    if reference:
        sub.payment_reference = reference
    if plan_label:
        sub.plan_label = plan_label
    if plan is not None:
        sub.plan = plan
    sub.has_premium_ai = sub.plan in (SubscriptionPlan.premium, SubscriptionPlan.pro)
    sub.has_community_access = True
    sub.has_live_class_access = True
    sub.has_premium_cbt = sub.plan == SubscriptionPlan.pro

    await _sync_profile_flag(db, uid, True)
    await db.flush()
    return sub


async def has_paid_access(db: AsyncSession, user_id, audience: str | None = None) -> bool:
    """True when the user holds an active membership for this class audience."""
    sub = await get_active_subscription(db, user_id)
    if not sub:
        return False
    want = normalize_audience(audience)
    if want == "all":
        return True
    return normalize_audience(sub.audience or "all") == want


async def sweep_expired(db: AsyncSession) -> int:
    """Drop lapsed memberships out of the paid table. Returns how many lapsed."""
    now = naive_utc_now()
    res = await db.execute(
        select(Subscription).where(
            Subscription.is_active.is_(True),
            or_(Subscription.expires_at.is_(None), Subscription.expires_at <= now),
        )
    )
    lapsed = res.scalars().all()
    for sub in lapsed:
        sub.is_active = False
        sub.cancelled_at = now
        await _sync_profile_flag(db, sub.student_id, False)
    if lapsed:
        await db.flush()
    return len(lapsed)


async def _skill_member_ids(db: AsyncSession, now: datetime) -> list[uuid.UUID]:
    """Students with an active skills/coding enrollment."""
    try:
        from app.models.payment import StudentEntitlement
        from app.services.skills_enrollment import SKILL_ENTITLEMENT_TYPE

        res = await db.execute(
            select(StudentEntitlement.student_id).where(
                StudentEntitlement.entitlement_type == SKILL_ENTITLEMENT_TYPE,
                or_(
                    StudentEntitlement.expires_at.is_(None),
                    StudentEntitlement.expires_at > now,
                ),
            )
        )
        return [row for row in res.scalars().all() if row]
    except Exception:
        return []


async def paid_member_ids(db: AsyncSession, audience: str | None = "all") -> list[uuid.UUID]:
    """User ids that have paid and are still inside their month."""
    now = naive_utc_now()
    want = normalize_audience(audience)

    if want == "coding":
        # Coding students pay through a skills enrollment, not a board
        # membership — plus anyone who bought a coding membership explicitly.
        skill_ids = await _skill_member_ids(db, now)
        res = await db.execute(
            select(Subscription.student_id).where(
                Subscription.is_active.is_(True),
                Subscription.expires_at > now,
                Subscription.audience == "coding",
            )
        )
        coding_subs = [uid for uid in res.scalars().all() if uid]
        return list({*skill_ids, *coding_subs})

    res = await db.execute(
        select(Subscription.student_id).where(
            Subscription.is_active.is_(True),
            Subscription.expires_at > now,
        )
    )
    ids = [uid for uid in res.scalars().all() if uid]
    if want == "all":
        return ids

    exams = EXAM_AUDIENCES.get(want)
    if not exams:
        return ids

    # Match the profile's exam type, or the audience recorded when they paid
    # (a student who switches board keeps the month they already bought).
    res = await db.execute(
        select(Subscription.student_id)
        .outerjoin(StudentProfile, StudentProfile.user_id == Subscription.student_id)
        .where(
            Subscription.is_active.is_(True),
            Subscription.expires_at > now,
            or_(
                StudentProfile.exam_type.in_([ExamType(e) for e in exams]),
                Subscription.audience == want,
            ),
        )
    )
    return [uid for uid in res.scalars().all() if uid]


async def paid_members(db: AsyncSession, audience: str | None = "all", limit: int = 300) -> list[dict]:
    """Paid members with their details — what a teacher/admin sees."""
    now = naive_utc_now()
    want = normalize_audience(audience)
    stmt = (
        select(Subscription, User, StudentProfile)
        .join(User, User.id == Subscription.student_id)
        .outerjoin(StudentProfile, StudentProfile.user_id == Subscription.student_id)
        .where(Subscription.is_active.is_(True), Subscription.expires_at > now)
        .order_by(Subscription.expires_at.desc())
        .limit(max(1, min(limit, 1000)))
    )
    if want not in ("all", "coding") and want in EXAM_AUDIENCES:
        exams = [ExamType(e) for e in EXAM_AUDIENCES[want]]
        stmt = stmt.where(
            or_(StudentProfile.exam_type.in_(exams), Subscription.audience == want)
        )
    rows = (await db.execute(stmt)).all()

    out = []
    for sub, user, profile in rows:
        out.append(
            {
                "user_id": str(user.id),
                "name": user.full_name,
                "email": user.email,
                "phone": user.phone,
                "exam_type": (
                    profile.exam_type.value
                    if profile and hasattr(profile.exam_type, "value")
                    else (str(profile.exam_type) if profile and profile.exam_type else None)
                ),
                "audience": normalize_audience(sub.audience),
                "plan": sub.plan.value if hasattr(sub.plan, "value") else str(sub.plan or ""),
                "amount_paid": float(sub.amount_paid or 0),
                "paid_at": sub.last_renewed_at.isoformat() if sub.last_renewed_at else None,
                "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
                "days_left": max(0, (sub.expires_at - now).days) if sub.expires_at else 0,
                "is_first_period": bool(sub.is_first_period),
                "renewal_count": int(sub.renewal_count or 0),
            }
        )
    return out


def membership_view(sub: Subscription | None, values: dict[str, float] | None = None) -> dict:
    """Public shape of a membership row (student-facing)."""
    now = naive_utc_now()
    if not sub or not sub.is_active or not sub.expires_at or sub.expires_at <= now:
        return {
            "active": False,
            "paid": False,
            "expires_at": None,
            "days_left": 0,
            "monthly_price": float((values or {}).get("membership_monthly_price", 0.0)),
            "first_period_bonus_days": int((values or {}).get("first_period_bonus_days", 0) or 0),
            "message": "No active subscription. Pay once a month to stay in the paid class list.",
        }
    return {
        "active": True,
        "paid": True,
        "plan": sub.plan.value if hasattr(sub.plan, "value") else str(sub.plan or ""),
        "plan_label": sub.plan_label,
        "audience": normalize_audience(sub.audience),
        "audience_label": audience_label(sub.audience),
        "amount_paid": float(sub.amount_paid or 0),
        "expires_at": sub.expires_at.isoformat(),
        "days_left": max(0, (sub.expires_at - now).days),
        "paid_at": sub.last_renewed_at.isoformat() if sub.last_renewed_at else None,
        "is_first_period": bool(sub.is_first_period),
        "renewal_count": int(sub.renewal_count or 0),
        "monthly_price": float((values or {}).get("membership_monthly_price", 0.0)),
        "first_period_bonus_days": int((values or {}).get("first_period_bonus_days", 0) or 0),
    }
