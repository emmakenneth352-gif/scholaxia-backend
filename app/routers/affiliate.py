"""
Affiliate ("Refer & Earn") router
---------------------------------
- POST /api/v1/affiliate/join            → activate, get a referral code + link
- GET  /api/v1/affiliate/me              → dashboard: code, referrals, earnings, payouts
- POST /api/v1/affiliate/payout          → submit bank details (MANUAL payout, admin pays)
- GET  /api/v1/affiliate/admin/payouts   → list payout requests (admin)
- POST /api/v1/affiliate/admin/payouts/{id}/process → mark paid/rejected (admin)

Earnings model: a fixed commission (settings.AFFILIATE_SIGNUP_COMMISSION) is
credited to the affiliate every time a new user signs up through their code.
Balance = total commissions − (pending + paid payouts). When the admin rejects
a payout the amount is returned to the balance so the affiliate can request it
again.
"""
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.affiliate import AffiliateProfile, AffiliateReferral, AffiliatePayout, PayoutStatus
from app.models.user import User
from app.services.notification_service import send_user_notification

router = APIRouter(prefix="/affiliate", tags=["Affiliate"])

# Where the referral link points. Keep in one place so admin/deploy can change it.
AFFILIATE_LINK_ORIGIN = "https://scholaxia1.onrender.com/app/"

async def credit_referral(db: AsyncSession, ref_code: str | None, new_user) -> None:
    """Called right after a new account is created. Credits the affiliate whose
    code was used (if any). Best-effort — exceptions must not break signup."""
    code = (ref_code or "").strip().upper()
    if not code or code == "NONE":
        return
    profile = (
        await db.execute(select(AffiliateProfile).where(AffiliateProfile.code == code))
    ).scalar_one_or_none()
    if not profile or not profile.is_active:
        return
    if profile.user_id == new_user.id:
        return  # self-referral
    # One commission per referred account ever.
    dup = (
        await db.execute(
            select(AffiliateReferral).where(
                AffiliateReferral.referred_user_id == new_user.id
            )
        )
    ).scalar_one_or_none()
    if dup:
        return
    db.add(
        AffiliateReferral(
            affiliate_id=profile.id,
            referred_user_id=new_user.id,
            referred_name=(new_user.full_name or new_user.email or "Student")[:255],
            commission=float(settings.AFFILIATE_SIGNUP_COMMISSION),
        )
    )
    try:
        await send_user_notification(
            db,
            str(profile.user_id),
            title="New referral signed up 🎉",
            body=(
                f"{new_user.full_name or 'A student'} joined Scholaxia with your code "
                f"{code} — ₦{float(settings.AFFILIATE_SIGNUP_COMMISSION):,.2f} added to your balance."
            ),
            notification_type="affiliate",
        )
    except Exception:
        pass

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _normalize_code(raw: str | None) -> str:
    return (raw or "").strip().upper()


async def _get_profile_for_user(db: AsyncSession, user_id: str) -> AffiliateProfile | None:
    res = await db.execute(
        select(AffiliateProfile).where(AffiliateProfile.user_id == _uuid_or_none(user_id))
    )
    return res.scalar_one_or_none()


def _uuid_or_none(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


async def _generate_code(db: AsyncSession) -> str:
    """Short, human-friendly, collision-checked referral code."""
    for _ in range(8):
        candidate = "SX" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        dup = await db.execute(
            select(AffiliateProfile).where(AffiliateProfile.code == candidate)
        )
        if not dup.scalar_one_or_none():
            return candidate
    return "SX" + uuid.uuid4().hex[:6].upper()



# ── Join / dashboard ─────────────────────────────────────────────────────────


@router.post("/join")
async def join_affiliate(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Activate the affiliate program for the signed-in user → code + link."""
    uid = _uuid_or_none(current_user["sub"])
    if not uid:
        raise HTTPException(status_code=400, detail="Invalid account")

    profile = await _get_profile_for_user(db, uid)
    if not profile:
        profile = AffiliateProfile(user_id=uid, code=await _generate_code(db))
        db.add(profile)
        await db.flush()

    if not profile.is_active:
        profile.is_active = True
        await db.flush()

    return await _profile_out(db, profile)


@router.get("/me")
async def affiliate_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uid = _uuid_or_none(current_user["sub"])
    profile = await _get_profile_for_user(db, uid)
    return await _profile_out(db, profile)


async def _profile_out(db: AsyncSession, profile: AffiliateProfile | None) -> dict:
    if not profile:
        return {"joined": False, "code": None, "link": None, "commission_per_referral": float(settings.AFFILIATE_SIGNUP_COMMISSION)}

    ref_res = await db.execute(
        select(
            func.count(AffiliateReferral.id),
            func.coalesce(func.sum(AffiliateReferral.commission), 0.0),
        ).where(AffiliateReferral.affiliate_id == profile.id)
    )
    ref_count, total_earned = ref_res.one()
    paid_res = await db.execute(
        select(func.coalesce(func.sum(AffiliatePayout.amount), 0.0)).where(
            AffiliatePayout.affiliate_id == profile.id,
            AffiliatePayout.status.in_([PayoutStatus.pending, PayoutStatus.paid]),
        )
    )
    paid_out = paid_res.scalar() or 0.0
    balance = float(total_earned) - float(paid_out)

    payouts = (
        await db.execute(
            select(AffiliatePayout)
            .where(AffiliatePayout.affiliate_id == profile.id)
            .order_by(AffiliatePayout.requested_at.desc())
            .limit(20)
        )
    ).scalars().all()

    referrals = (
        await db.execute(
            select(AffiliateReferral)
            .where(AffiliateReferral.affiliate_id == profile.id)
            .order_by(AffiliateReferral.created_at.desc())
            .limit(50)
        )
    ).scalars().all()

    return {
        "joined": True,
        "code": profile.code,
        "link": f"{AFFILIATE_LINK_ORIGIN}?ref={profile.code}",
        "currency": "NGN",
        "commission_per_referral": float(settings.AFFILIATE_SIGNUP_COMMISSION),
        "referrals_count": int(ref_count),
        "total_earned": float(total_earned),
        "balance": float(balance),
        "payouts": [
            {
                "id": str(p.id),
                "amount": float(p.amount),
                "bank_name": p.bank_name,
                "account_number": p.account_number,
                "account_name": p.account_name,
                "status": p.status.value if hasattr(p.status, "value") else str(p.status),
                "admin_note": p.admin_note,
                "requested_at": p.requested_at.isoformat() if p.requested_at else None,
            }
            for p in payouts
        ],
        "referrals": [
            {
                "id": str(r.id),
                "name": r.referred_name or "Student",
                "commission": float(r.commission),
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in referrals
        ],
    }


# ── Payout request (manual — admin pays and marks it paid) ────────────────────


class PayoutRequest(BaseModel):
    bank_name: str = Field(..., min_length=2, max_length=255)
    account_number: str = Field(..., min_length=4, max_length=40)
    account_name: str = Field(..., min_length=2, max_length=255)


@router.post("/payout")
async def request_payout(
    payload: PayoutRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_profile_for_user(db, current_user["sub"])
    if not profile:
        raise HTTPException(status_code=400, detail="Join the affiliate program first")

    out = await _profile_out(db, profile)
    balance = float(out.get("balance") or 0.0)
    if balance <= 0:
        raise HTTPException(
            status_code=400,
            detail="No balance available to withdraw yet. Earn more referrals first.",
        )
    pending = [
        p for p in out.get("payouts", []) if p.get("status") == PayoutStatus.pending.value
    ]
    if pending:
        raise HTTPException(
            status_code=400,
            detail="You already have a payout request waiting to be paid. Wait for the admin to process it.",
        )

    payout = AffiliatePayout(
        affiliate_id=profile.id,
        amount=balance,  # withdraw everything — balance resets to zero
        bank_name=payload.bank_name.strip(),
        account_number=payload.account_number.strip(),
        account_name=payload.account_name.strip(),
    )
    db.add(payout)
    await db.flush()

    try:
        await send_user_notification(
            db,
            str(profile.user_id),
            title="Payout request received",
            body=(
                f"Your ₦{balance:,.2f} payout request was submitted. "
                "Our team pays manually from the Scholaxia account — expect it soon."
            ),
            notification_type="affiliate",
        )
    except Exception:
        pass

    fresh = await _profile_out(db, profile)
    fresh["message"] = "Payout request submitted. The admin pays manually — you will get a notification."
    return fresh


# ── Admin: review & process payout requests ──────────────────────────────────


@router.get("/admin/payouts")
async def list_payouts(
    status_filter: str = "",
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(AffiliatePayout, AffiliateProfile, User).join(
        AffiliateProfile, AffiliateProfile.id == AffiliatePayout.affiliate_id
    ).join(User, User.id == AffiliateProfile.user_id)
    if status_filter:
        try:
            st = PayoutStatus(status_filter.lower())
            q = q.where(AffiliatePayout.status == st)
        except ValueError:
            pass
    q = q.order_by(AffiliatePayout.requested_at.desc()).limit(100)
    rows = (await db.execute(q)).all()
    return [
        {
            "id": str(p.id),
            "amount": float(p.amount),
            "bank_name": p.bank_name,
            "account_number": p.account_number,
            "account_name": p.account_name,
            "status": p.status.value if hasattr(p.status, "value") else str(p.status),
            "requested_at": p.requested_at.isoformat() if p.requested_at else None,
            "admin_note": p.admin_note,
            "affiliate": {
                "name": u.full_name,
                "email": u.email,
                "code": prof.code,
            },
        }
        for p, prof, u in rows
    ]


class PayoutProcessRequest(BaseModel):
    status: str  # paid | rejected
    admin_note: str = ""


@router.post("/admin/payouts/{payout_id}/process")
async def process_payout(
    payout_id: str,
    payload: PayoutProcessRequest,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    pid = _uuid_or_none(payout_id)
    if not pid:
        raise HTTPException(status_code=400, detail="Invalid payout id")
    payout = (await db.execute(select(AffiliatePayout).where(AffiliatePayout.id == pid))).scalar_one_or_none()
    if not payout:
        raise HTTPException(status_code=404, detail="Payout request not found")
    wanted = payload.status.strip().lower()
    if wanted not in ("paid", "rejected"):
        raise HTTPException(status_code=400, detail="status must be 'paid' or 'rejected'")

    from datetime import datetime as _dt

    profile = (await db.execute(
        select(AffiliateProfile).where(AffiliateProfile.id == payout.affiliate_id)
    )).scalar_one_or_none()

    if wanted == "paid":
        payout.status = PayoutStatus.paid
        note = payload.admin_note or "Paid manually by admin."
        user_title, user_body = (
            "Payout sent",
            f"Our bank paid your ₦{payout.amount:,.2f} to {payout.bank_name} "
            f"{payout.account_number} ({payout.account_name}). Check your account."
        )
    else:
        payout.status = PayoutStatus.rejected
        # Rejected payouts are excluded from the balance sum → commissions auto-return.
        note = payload.admin_note or "Rejected — amount returned to your balance."
        user_title, user_body = (
            "Payout request rejected",
            f"Your ₦{payout.amount:,.2f} payout request was not processed."
            + (f" Reason: {note}" if payload.admin_note else " The amount is back in your balance.")
        )
    payout.admin_note = note
    payout.processed_at = _dt.utcnow()
    await db.flush()

    if profile:
        try:
            await send_user_notification(
                db,
                str(profile.user_id),
                title=user_title,
                body=user_body,
                notification_type="affiliate",
            )
        except Exception:
            pass

    return {"ok": True, "id": str(payout.id), "status": wanted}
