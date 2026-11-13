"""Affiliate money events.

The affiliate earns on THREE kinds of event (all admin-configurable):

* signup      — credited when the invited account is created (existing flow, kept)
* subscription— fixed amount whenever the invited user pays for a membership
* purchase    — a percentage of anything else the invited user buys
* first_payment_bonus — a one-time extra the FIRST time an invited user pays;
  it is never paid again on later renewals or purchases.

Every row carries a unique `reference`, so a replayed Paystack/Flutterwave
webhook can never credit the same payment twice.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.affiliate import AffiliateEarning, AffiliateProfile, AffiliateReferral
from app.models.payment import Payment
from app.services.notification_service import send_user_notification
from app.services.platform_settings import get_values

# Payments that count as "a subscription" rather than a one-off purchase.
SUBSCRIPTION_PRODUCTS = {"class_package", "membership", "subscription"}


def _uuid(value) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


async def _referral_for(db: AsyncSession, user_id) -> AffiliateReferral | None:
    uid = _uuid(user_id)
    if not uid:
        return None
    res = await db.execute(
        select(AffiliateReferral).where(AffiliateReferral.referred_user_id == uid)
    )
    return res.scalar_one_or_none()


async def _add_earning(
    db: AsyncSession,
    *,
    profile: AffiliateProfile,
    referred_user_id,
    source: str,
    amount: float,
    reference: str,
    note: str | None = None,
) -> bool:
    """Insert one earning row unless this reference already paid out."""
    if amount <= 0:
        return False
    existing = (
        await db.execute(
            select(AffiliateEarning.id).where(AffiliateEarning.reference == reference)
        )
    ).scalar_one_or_none()
    if existing:
        return False
    db.add(
        AffiliateEarning(
            affiliate_id=profile.id,
            referred_user_id=_uuid(referred_user_id),
            source=source,
            amount=round(float(amount), 2),
            reference=reference,
            note=note,
        )
    )
    return True


async def credit_for_payment(
    db: AsyncSession, payment: Payment, *, first_success: bool = True
) -> float:
    """Credit the affiliate who invited this payer. Returns total credited.

    Safe to call repeatedly — idempotent per payment reference.
    """
    if not first_success or payment is None or not payment.student_id:
        return 0.0
    amount_paid = float(payment.amount or 0)
    if amount_paid <= 0:
        return 0.0

    referral = await _referral_for(db, payment.student_id)
    if not referral:
        return 0.0
    profile = (
        await db.execute(
            select(AffiliateProfile).where(AffiliateProfile.id == referral.affiliate_id)
        )
    ).scalar_one_or_none()
    if not profile or not profile.is_active:
        return 0.0
    if str(profile.user_id) == str(payment.student_id):
        return 0.0  # never pay people for referring themselves

    values = await get_values(db)
    product = (payment.product_type or "").lower()
    is_subscription = product in SUBSCRIPTION_PRODUCTS or bool(payment.live_plan_id)

    if is_subscription:
        commission = float(values["affiliate_subscription_commission"])
        source = "subscription"
    else:
        pct = float(values["affiliate_purchase_percent"])
        commission = round(amount_paid * pct / 100.0, 2)
        source = "purchase"

    ref_base = payment.provider_reference or str(payment.id)
    credited = 0.0
    if await _add_earning(
        db,
        profile=profile,
        referred_user_id=payment.student_id,
        source=source,
        amount=commission,
        reference=f"pay:{ref_base}:{source}",
        note=f"{source} commission on ₦{amount_paid:,.2f}",
    ):
        credited += commission

    # One-time first-payment bonus — never repeated.
    if not referral.first_bonus_paid:
        bonus = float(values["affiliate_first_payment_bonus"])
        if await _add_earning(
            db,
            profile=profile,
            referred_user_id=payment.student_id,
            source="first_payment_bonus",
            amount=bonus,
            reference=f"firstpay:{referral.id}",
            note="First payment bonus (one time only)",
        ):
            credited += bonus
        referral.first_bonus_paid = True
        referral.first_paid_at = datetime.utcnow()

    await db.flush()

    if credited > 0:
        try:
            await send_user_notification(
                db,
                str(profile.user_id),
                title="Affiliate commission added 💰",
                body=(
                    f"Your invite paid ₦{amount_paid:,.2f}. "
                    f"₦{credited:,.2f} was added to your affiliate balance."
                ),
                notification_type="affiliate",
            )
        except Exception:
            pass
    return credited


async def earnings_total(db: AsyncSession, profile_id) -> float:
    res = await db.execute(
        select(func.coalesce(func.sum(AffiliateEarning.amount), 0.0)).where(
            AffiliateEarning.affiliate_id == profile_id
        )
    )
    return float(res.scalar() or 0.0)


async def earnings_list(db: AsyncSession, profile_id, limit: int = 50) -> list[dict]:
    rows = (
        await db.execute(
            select(AffiliateEarning)
            .where(AffiliateEarning.affiliate_id == profile_id)
            .order_by(AffiliateEarning.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [
        {
            "source": row.source,
            "amount": float(row.amount),
            "note": row.note,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]
