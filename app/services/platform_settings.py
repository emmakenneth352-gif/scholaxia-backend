"""Runtime-editable money settings (admin controlled).

Every value has a sane default so the platform works before the admin touches
anything, and the affiliate-page + membership endpoints report the same numbers
that are actually used when commission is credited.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.platform_setting import PlatformSetting

# key -> default. Floats unless the key is listed in _INT_KEYS.
DEFAULTS: dict[str, float] = {
    "affiliate_signup_commission": float(settings.AFFILIATE_SIGNUP_COMMISSION),
    "affiliate_subscription_commission": 500.0,
    "affiliate_purchase_percent": 10.0,
    "affiliate_first_payment_bonus": 500.0,
    "membership_monthly_price": 1500.0,
    "first_period_bonus_days": 7.0,
}

_INT_KEYS = {"first_period_bonus_days"}


def _coerce(key: str, raw) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return DEFAULTS[key]
    if value < 0:
        return 0.0
    return float(int(value)) if key in _INT_KEYS else value


async def get_values(db: AsyncSession) -> dict[str, float]:
    """All money settings, merged over the defaults."""
    values = dict(DEFAULTS)
    try:
        rows = (await db.execute(select(PlatformSetting))).scalars().all()
    except Exception:
        return values
    for row in rows:
        if row.key in values:
            values[row.key] = _coerce(row.key, row.value)
    return values


async def set_values(db: AsyncSession, updates: dict[str, object]) -> dict[str, float]:
    """Upsert the given keys (unknown/negative values are ignored)."""
    for key, raw in (updates or {}).items():
        if key not in DEFAULTS or raw is None:
            continue
        value = _coerce(key, raw)
        row = (
            await db.execute(select(PlatformSetting).where(PlatformSetting.key == key))
        ).scalar_one_or_none()
        if row:
            row.value = str(value)
        else:
            db.add(PlatformSetting(key=key, value=str(value)))
    await db.flush()
    return await get_values(db)
