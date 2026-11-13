"""Glue run after a payment is marked successful.

Keeps the payment routers thin: one call activates the monthly membership and
pays affiliate commission, never raising into the payment flow.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payment import Payment

logger = logging.getLogger(__name__)


async def on_payment_success(
    db: AsyncSession, payment: Payment, *, first_success: bool = True
) -> None:
    if payment is None:
        return

    product = (payment.product_type or "").lower()
    try:
        if product in ("class_package", "membership", "subscription") and payment.student_id:
            from app.models.payment import SubscriptionPlan
            from app.services.membership_service import activate_membership

            await activate_membership(
                db,
                payment.student_id,
                plan=SubscriptionPlan.premium if product != "class_package" else None,
                amount=float(payment.amount or 0),
                reference=payment.provider_reference or str(payment.id),
                plan_label=payment.description or payment.product_id,
            )
    except Exception as exc:  # never break fulfillment over membership bookkeeping
        logger.warning("membership activation skipped for %s: %s", payment.id, exc)

    try:
        from app.services.affiliate_commissions import credit_for_payment

        await credit_for_payment(db, payment, first_success=first_success)
    except Exception as exc:
        logger.warning("affiliate commission skipped for %s: %s", payment.id, exc)
