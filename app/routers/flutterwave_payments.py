from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import uuid

from app.core.database import get_db
from app.core.deps import require_student, get_current_user
from app.core.config import settings
from app.core.live_class_plans import (
    all_plans_dict,
    get_plan,
    suggest_plan_ids,
)
from app.core.skills_programs import (
    get_skill_program,
    skill_plan_key,
    is_skill_plan_key,
    skill_id_from_plan_key,
    first_installment_amount,
    payment_amount_for_mode,
)
from app.models.payment import Payment, PaymentStatus
from app.models.live_class import LiveClass
from app.models.teacher_material import TeacherMaterial, MaterialPurchase
from app.models.content import Book, BookPurchase
from app.models.user import User, StudentProfile
from app.core.datetime_utils import naive_utc_now
from app.services.flutterwave_service import verify_transaction, verify_transaction_by_reference
from app.services.live_class_access import (
    activate_live_plan,
    get_live_access_info,
    parse_uuid,
    live_class_requires_subscription,
    is_free_live_class,
)

router = APIRouter(prefix="/payments", tags=["Payments"])


class FlutterwaveVerifyRequest(BaseModel):
    transaction_id: str
    class_id: Optional[str] = None
    material_id: Optional[str] = None
    book_id: Optional[str] = None
    plan_id: Optional[str] = None
    skill_id: Optional[str] = None
    tx_ref: Optional[str] = None


class SkillEnrollInitRequest(BaseModel):
    full_name: str = ""
    phone: str = ""
    email: Optional[str] = None
    location: Optional[str] = None
    preferred_start: Optional[str] = None
    notes: Optional[str] = None
    # once = full fee now; half = pay half now, balance by midpoint
    payment_mode: Optional[str] = "half"
    installment: Optional[int] = 1


class LivePlanInitRequest(BaseModel):
    plan_id: str
    class_id: Optional[str] = None


class ReconcilePlanRequest(BaseModel):
    tx_ref: Optional[str] = None


@router.get("/flutterwave/skills/enrollments")
async def list_my_skill_enrollments(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    from app.services.skills_enrollment import (
        list_skill_entitlements,
        refresh_skill_entitlement_status,
        serialize_skill_enrollment,
    )

    ents = await list_skill_entitlements(db, current_user["sub"])
    out = []
    for ent in ents:
        await refresh_skill_entitlement_status(db, ent)
        out.append(serialize_skill_enrollment(ent))
    return {"enrollments": out}


@router.post("/flutterwave/skills/{skill_id}/init")
async def init_skill_enrollment_payment(
    skill_id: str,
    payload: SkillEnrollInitRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    if not settings.FLUTTERWAVE_PUBLIC_KEY or not settings.FLUTTERWAVE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payment system is not configured.")

    program = get_skill_program(skill_id)
    if not program:
        raise HTTPException(status_code=404, detail="Training program not found")

    payment_mode = (payload.payment_mode or "half").strip().lower()
    if payment_mode not in ("once", "half"):
        raise HTTPException(status_code=400, detail="payment_mode must be once or half")
    installment = int(payload.installment or 1)
    if installment not in (1, 2):
        raise HTTPException(status_code=400, detail="installment must be 1 or 2")
    if payment_mode == "once" and installment != 1:
        raise HTTPException(status_code=400, detail="Full payment uses installment 1 only")

    from app.services.skills_enrollment import (
        get_skill_entitlement,
        refresh_skill_entitlement_status,
        serialize_skill_enrollment,
    )

    existing_ent = await get_skill_entitlement(db, current_user["sub"], skill_id)
    if existing_ent:
        await refresh_skill_entitlement_status(db, existing_ent)
        details = dict(existing_ent.details or {})
        status = (details.get("status") or "").lower()
        paid_n = int(details.get("installments_paid") or 0)
        if status == "completed" or (details.get("payment_mode") == "once" and paid_n >= 1):
            return {
                "already_paid": True,
                "enrollment": serialize_skill_enrollment(existing_ent),
                "program_title": program["title"],
            }
        if installment == 2:
            if status == "suspended":
                raise HTTPException(
                    status_code=403,
                    detail="Enrollment was shut down because the balance was not paid on time. Contact support.",
                )
            if paid_n < 1:
                raise HTTPException(status_code=400, detail="Pay the first installment before the balance.")
            if paid_n >= 2:
                return {
                    "already_paid": True,
                    "enrollment": serialize_skill_enrollment(existing_ent),
                    "program_title": program["title"],
                }
            payment_mode = "half"
        elif installment == 1 and paid_n >= 1 and status == "active":
            raise HTTPException(
                status_code=400,
                detail="First installment already paid. Pay the balance installment when due.",
            )

    full_name = (payload.full_name or "").strip()
    phone = (payload.phone or "").strip()
    location = (payload.location or "").strip()
    if installment == 1 and (not full_name or not phone):
        raise HTTPException(status_code=400, detail="Full name and phone are required")

    user_res = await db.execute(select(User).where(User.id == current_user["sub"]))
    user = user_res.scalar_one_or_none()
    email = (payload.email or "").strip() or (user.email if user else "") or f"{current_user['sub']}@scholaxia.local"
    amount = payment_amount_for_mode(program["fee"], payment_mode, installment)

    tx_ref = f"scholaxia-skill-{skill_id[:12]}-{uuid.uuid4().hex[:16]}"
    mode_label = "full payment" if payment_mode == "once" else f"installment {installment}"

    payment = Payment(
        student_id=parse_uuid(current_user["sub"]),
        amount=amount,
        currency="NGN",
        status=PaymentStatus.pending,
        flutterwave_tx_ref=tx_ref,
        live_plan_id=skill_plan_key(skill_id),
        product_type="skill_enrollment",
        product_id=skill_id,
        description=(
            f"Skills enroll: {program['title']} | mode={payment_mode} | installment={installment}"
            f" | {full_name or 'student'} | {phone or '-'}"
            + (f" | {location}" if location else "")
        )[:255],
    )
    db.add(payment)
    await db.flush()

    return {
        "already_paid": False,
        "payment_id": str(payment.id),
        "tx_ref": tx_ref,
        "amount": amount,
        "currency": "NGN",
        "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        "program_title": program["title"],
        "program_duration": program["duration"],
        "payment_mode": payment_mode,
        "installment": installment,
        "total_fee": program["fee"],
        "mode_label": mode_label,
        "customer": {"email": email, "name": full_name or (user.full_name if user else "Student")},
    }


@router.get("/live-class/plans")
async def list_live_class_plans(
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    prof_res = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == current_user["sub"])
    )
    profile = prof_res.scalar_one_or_none()
    education_level = profile.education_level if profile else None
    exam_type = profile.exam_type.value if profile and profile.exam_type else None
    suggested = suggest_plan_ids(education_level, exam_type)
    access = await get_live_access_info(db, current_user["sub"])
    active = access.get("active_plan")
    can_join = bool(access.get("can_join"))
    return {
        "plans": all_plans_dict(),
        "suggested_plan_ids": suggested,
        "active_plan": {
            **active,
            "expires_at": active["expires_at"].isoformat() if active and active.get("expires_at") else None,
        } if active else None,
        "paid": can_join,
        "can_join": can_join,
        "need_plan": not can_join,
        "sessions_left": access.get("sessions_left", 0),
        "currency": "NGN",
        "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
    }


@router.get("/live-class/{class_id}/access")
async def live_class_access(
    class_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(LiveClass).where(LiveClass.id == class_id))
    live_class = result.scalar_one_or_none()
    if not live_class:
        raise HTTPException(status_code=404, detail="Class not found")

    if not live_class_requires_subscription(live_class.visibility):
        return {
            "paid": True,
            "can_join": True,
            "need_plan": False,
            "requires_payment": False,
            "is_free": True,
            "monthly_pass": False,
            "sessions_left": 0,
            "active_plan": None,
            "valid_until": None,
            "visibility": live_class.visibility,
            "currency": "NGN",
            "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        }

    access = await get_live_access_info(db, current_user["sub"], class_id)
    valid_until = access.get("valid_until")
    active = access.get("active_plan")
    can_join = bool(access.get("can_join"))
    need_plan = bool(access.get("need_plan", not can_join))
    return {
        "paid": can_join,
        "can_join": can_join,
        "need_plan": need_plan,
        "requires_payment": need_plan,
        "monthly_pass": access.get("monthly_pass", False),
        "sessions_left": access.get("sessions_left", 0),
        "active_plan": active,
        "valid_until": valid_until.isoformat() if valid_until else None,
        "visibility": live_class.visibility,
        "currency": "NGN",
        "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
    }


@router.get("/material/{material_id}/access")
async def material_access_payment(
    material_id: str,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TeacherMaterial).where(TeacherMaterial.id == material_id))
    material = result.scalar_one_or_none()
    if not material or not material.is_active:
        raise HTTPException(status_code=404, detail="Material not found")
    has_access = await _student_has_material_access(db, current_user["sub"], material_id)
    return {
        "has_access": has_access,
        "is_free": material.is_free,
        "paid": has_access,
        "amount": material.price if not material.is_free else 0,
        "currency": "NGN",
        "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        "title": material.title,
    }


@router.post("/flutterwave/live-plan/init")
async def init_live_plan_payment(
    payload: LivePlanInitRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    if not settings.FLUTTERWAVE_PUBLIC_KEY or not settings.FLUTTERWAVE_SECRET_KEY:
        raise HTTPException(
            status_code=503,
            detail="Payment system is not configured. Contact Scholaxia support.",
        )

    plan = get_plan(payload.plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if await _student_has_live_access(db, current_user["sub"], payload.class_id or ""):
        return {
            "already_paid": True,
            "plan_id": plan.id,
            "amount": plan.price,
            "currency": "NGN",
            "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        }

    if payload.class_id:
        result = await db.execute(select(LiveClass).where(LiveClass.id == payload.class_id))
        live_class = result.scalar_one_or_none()
        now = naive_utc_now()
        in_window = (
            live_class
            and live_class.start_time
            and live_class.start_time <= now
            and (live_class.end_time is None or live_class.end_time > now)
        )
        if not live_class or (not live_class.is_live and not in_window):
            raise HTTPException(status_code=404, detail="Class not live")

    user_res = await db.execute(select(User).where(User.id == current_user["sub"]))
    user = user_res.scalar_one_or_none()
    email = user.email if user else f"{current_user['sub']}@scholaxia.local"
    name = user.full_name if user else "Student"

    tx_ref = f"scholaxia-plan-{plan.id[:12]}-{uuid.uuid4().hex[:12]}"

    payment = Payment(
        student_id=parse_uuid(current_user["sub"]),
        amount=plan.price,
        currency="NGN",
        status=PaymentStatus.pending,
        flutterwave_tx_ref=tx_ref,
        live_plan_id=plan.id,
        live_class_id=parse_uuid(payload.class_id) if payload.class_id else None,
        description=f"Live plan: {plan.name}",
    )
    db.add(payment)
    await db.flush()

    return {
        "already_paid": False,
        "payment_id": str(payment.id),
        "plan_id": plan.id,
        "plan_name": plan.name,
        "tx_ref": tx_ref,
        "amount": plan.price,
        "currency": "NGN",
        "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        "class_id": payload.class_id,
        "customer": {"email": email, "name": name},
    }


@router.post("/flutterwave/live-class/{class_id}/init")
async def init_live_class_payment(
    class_id: str,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Legacy endpoint — redirects clients to choose a monthly plan."""
    if await _student_has_live_access(db, current_user["sub"], class_id):
        return {"already_paid": True, "need_plan": False}
    raise HTTPException(
        status_code=402,
        detail="Choose a Scholaxia One-on-One Live Class plan before joining.",
    )


@router.post("/flutterwave/material/{material_id}/init")
async def init_material_payment(
    material_id: str,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    if not settings.FLUTTERWAVE_PUBLIC_KEY or not settings.FLUTTERWAVE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payment system is not configured.")

    result = await db.execute(select(TeacherMaterial).where(TeacherMaterial.id == material_id))
    material = result.scalar_one_or_none()
    if not material or not material.is_active:
        raise HTTPException(status_code=404, detail="Material not found")
    if material.is_free:
        return {"already_paid": True, "is_free": True, "has_access": True}

    if await _student_has_material_access(db, current_user["sub"], material_id):
        return {
            "already_paid": True,
            "amount": material.price,
            "currency": "NGN",
            "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        }

    user_res = await db.execute(select(User).where(User.id == current_user["sub"]))
    user = user_res.scalar_one_or_none()
    email = user.email if user else f"{current_user['sub']}@scholaxia.local"
    name = user.full_name if user else "Student"

    tx_ref = f"scholaxia-mat-{material_id[:8]}-{uuid.uuid4().hex[:16]}"

    payment = Payment(
        student_id=parse_uuid(current_user["sub"]),
        amount=material.price,
        currency="NGN",
        status=PaymentStatus.pending,
        flutterwave_tx_ref=tx_ref,
        material_id=material.id,
        description=f"Material: {material.title}",
    )
    db.add(payment)
    await db.flush()

    return {
        "already_paid": False,
        "payment_id": str(payment.id),
        "tx_ref": tx_ref,
        "amount": material.price,
        "currency": "NGN",
        "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        "material_title": material.title,
        "material_subject": material.subject,
        "customer": {"email": email, "name": name},
    }


@router.get("/book/{book_id}/access")
async def book_access_payment(
    book_id: str,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book or not book.is_active:
        raise HTTPException(status_code=404, detail="Book not found")
    has_access = await _student_has_book_access(db, current_user["sub"], book_id)
    return {
        "has_access": has_access,
        "is_free": book.is_free,
        "paid": has_access,
        "amount": book.price if not book.is_free else 0,
        "currency": "NGN",
        "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        "title": book.title,
    }


@router.post("/flutterwave/book/{book_id}/init")
async def init_book_payment(
    book_id: str,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    if not settings.FLUTTERWAVE_PUBLIC_KEY or not settings.FLUTTERWAVE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payment system is not configured.")

    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book or not book.is_active:
        raise HTTPException(status_code=404, detail="Book not found")
    if book.is_free:
        return {"already_paid": True, "is_free": True, "has_access": True}

    if await _student_has_book_access(db, current_user["sub"], book_id):
        return {
            "already_paid": True,
            "amount": book.price,
            "currency": "NGN",
            "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        }

    user_res = await db.execute(select(User).where(User.id == current_user["sub"]))
    user = user_res.scalar_one_or_none()
    email = user.email if user else f"{current_user['sub']}@scholaxia.local"
    name = user.full_name if user else "Student"

    tx_ref = f"scholaxia-book-{book_id[:8]}-{uuid.uuid4().hex[:16]}"

    payment = Payment(
        student_id=parse_uuid(current_user["sub"]),
        amount=book.price,
        currency="NGN",
        status=PaymentStatus.pending,
        flutterwave_tx_ref=tx_ref,
        book_id=book.id,
        description=f"Scholaxia material: {book.title}",
    )
    db.add(payment)
    await db.flush()

    return {
        "already_paid": False,
        "payment_id": str(payment.id),
        "tx_ref": tx_ref,
        "amount": book.price,
        "currency": "NGN",
        "public_key": settings.FLUTTERWAVE_PUBLIC_KEY,
        "book_title": book.title,
        "book_subject": book.subject,
        "customer": {"email": email, "name": name},
    }


@router.post("/flutterwave/reconcile-plan")
async def reconcile_plan_payment(
    payload: ReconcilePlanRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Activate a plan when payment succeeded but the return page was missed."""
    sid = parse_uuid(current_user["sub"])
    payment = None

    if payload.tx_ref:
        pay_res = await db.execute(
            select(Payment).where(
                Payment.flutterwave_tx_ref == payload.tx_ref,
                Payment.student_id == sid,
            )
        )
        payment = pay_res.scalar_one_or_none()

    if not payment:
        pending_res = await db.execute(
            select(Payment)
            .where(
                Payment.student_id == sid,
                Payment.live_plan_id.isnot(None),
                Payment.status == PaymentStatus.pending,
            )
            .order_by(Payment.created_at.desc())
            .limit(1)
        )
        payment = pending_res.scalar_one_or_none()

    if not payment or not payment.live_plan_id:
        access = await get_live_access_info(db, current_user["sub"])
        return {
            "reconciled": False,
            "paid": access["paid"],
            "active_plan": access.get("active_plan"),
        }

    plan = get_plan(payment.live_plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Unknown plan")

    if payment.status == PaymentStatus.success:
        access = await get_live_access_info(db, current_user["sub"])
        if access["paid"]:
            active = access.get("active_plan") or {}
            expires = active.get("expires_at")
            return {
                "reconciled": True,
                "paid": True,
                "plan_id": plan.id,
                "active_plan": {
                    **active,
                    "expires_at": expires.isoformat() if hasattr(expires, "isoformat") else expires,
                },
            }
        activated = await activate_live_plan(db, current_user["sub"], plan.id)
        await db.flush()
        access = await get_live_access_info(db, current_user["sub"])
        return {
            "reconciled": True,
            "paid": access["paid"],
            "plan_id": plan.id,
            "active_plan": {
                **activated,
                "expires_at": activated["expires_at"].isoformat(),
            },
        }

    tx_ref = payment.flutterwave_tx_ref
    if not tx_ref:
        raise HTTPException(status_code=400, detail="Payment reference missing")

    try:
        data = await verify_transaction_by_reference(tx_ref)
    except Exception as exc:
        access = await get_live_access_info(db, current_user["sub"])
        return {
            "reconciled": False,
            "paid": access["paid"],
            "message": str(exc),
        }

    if (data.get("status") or "").lower() != "successful":
        access = await get_live_access_info(db, current_user["sub"])
        return {
            "reconciled": False,
            "paid": access["paid"],
            "message": "Payment not completed yet",
        }

    amount_paid = float(data.get("amount") or data.get("charged_amount") or 0)
    expected_amount = float(payment.amount) if payment.amount else plan.price
    if amount_paid + 1 < expected_amount and amount_paid + 1 < plan.price:
        raise HTTPException(status_code=400, detail="Incorrect payment amount")

    payment.status = PaymentStatus.success
    payment.live_plan_id = plan.id
    payment.flutterwave_transaction_id = str(data.get("id") or "")
    payment.flutterwave_tx_ref = data.get("tx_ref") or tx_ref

    activated = await activate_live_plan(db, current_user["sub"], plan.id)
    await db.flush()
    access = await get_live_access_info(db, current_user["sub"])
    return {
        "reconciled": True,
        "paid": access["paid"],
        "plan_id": plan.id,
        "payment_id": str(payment.id),
        "active_plan": {
            **activated,
            "expires_at": activated["expires_at"].isoformat(),
        },
    }


@router.post("/flutterwave/verify")
async def verify_flutterwave_payment(
    payload: FlutterwaveVerifyRequest,
    current_user: dict = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    plan_id = payload.plan_id
    skill_id = payload.skill_id
    if not payload.class_id and not payload.material_id and not payload.book_id and not plan_id and not skill_id:
        if payload.tx_ref:
            pay_lookup = await db.execute(
                select(Payment).where(
                    Payment.flutterwave_tx_ref == payload.tx_ref,
                    Payment.student_id == parse_uuid(current_user["sub"]),
                )
            )
            existing = pay_lookup.scalar_one_or_none()
            if existing and existing.live_plan_id:
                if is_skill_plan_key(existing.live_plan_id):
                    skill_id = skill_id or skill_id_from_plan_key(existing.live_plan_id)
                else:
                    plan_id = plan_id or existing.live_plan_id
        if not plan_id and not payload.material_id and not payload.book_id and not payload.class_id and not skill_id:
            raise HTTPException(status_code=400, detail="class_id, plan_id, material_id, book_id, or skill_id required")

    if payload.class_id and await _student_has_live_access(db, current_user["sub"], payload.class_id):
        return {"paid": True, "class_id": payload.class_id}

    if payload.material_id and await _student_has_material_access(db, current_user["sub"], payload.material_id):
        return {"paid": True, "material_id": payload.material_id, "has_access": True}

    if payload.book_id and await _student_has_book_access(db, current_user["sub"], payload.book_id):
        return {"paid": True, "book_id": payload.book_id, "has_access": True}

    try:
        data = await verify_transaction(payload.transaction_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Payment verification failed: {exc}")

    if (data.get("status") or "").lower() != "successful":
        raise HTTPException(status_code=400, detail="Payment was not successful")

    amount_paid = float(data.get("amount") or 0)
    tx_ref = data.get("tx_ref") or payload.tx_ref
    payment = None
    if tx_ref:
        pay_res = await db.execute(
            select(Payment).where(
                Payment.flutterwave_tx_ref == tx_ref,
                Payment.student_id == parse_uuid(current_user["sub"]),
            )
        )
        payment = pay_res.scalar_one_or_none()

    plan_id = plan_id or (payment.live_plan_id if payment else None)
    if not plan_id and payment and payment.live_plan_id:
        plan_id = payment.live_plan_id

    if skill_id or (plan_id and is_skill_plan_key(plan_id)):
        resolved_skill = skill_id or skill_id_from_plan_key(plan_id)
        program = get_skill_program(resolved_skill)
        if not program:
            raise HTTPException(status_code=400, detail="Unknown skills program")

        expected_amount = first_installment_amount(program["fee"])
        payment_mode = "half"
        installment = 1
        if payment and payment.amount:
            expected_amount = float(payment.amount)
        if payment and payment.description:
            desc = payment.description
            if "mode=once" in desc:
                payment_mode = "once"
            if "installment=2" in desc:
                installment = 2
                payment_mode = "half"
        if amount_paid + 1 < expected_amount:
            raise HTTPException(status_code=400, detail="Incorrect payment amount")

        if not payment:
            payment = Payment(
                student_id=parse_uuid(current_user["sub"]),
                amount=amount_paid,
                currency=data.get("currency") or "NGN",
                live_plan_id=skill_plan_key(resolved_skill),
                product_type="skill_enrollment",
                product_id=resolved_skill,
                description=f"Skills enroll: {program['title']} | mode={payment_mode} | installment={installment}",
            )
            db.add(payment)

        payment.status = PaymentStatus.success
        payment.live_plan_id = skill_plan_key(resolved_skill)
        payment.product_type = "skill_enrollment"
        payment.product_id = resolved_skill
        payment.flutterwave_transaction_id = str(data.get("id") or payload.transaction_id)
        if tx_ref:
            payment.flutterwave_tx_ref = tx_ref
        await db.flush()

        from app.services.skills_enrollment import (
            grant_or_update_skill_enrollment,
            serialize_skill_enrollment,
        )

        contact = {}
        if payment.description:
            # description: Skills enroll: TITLE | mode=... | installment=... | name | phone
            parts = [p.strip() for p in payment.description.split("|")]
            if len(parts) >= 4:
                contact["full_name"] = parts[3]
            if len(parts) >= 5:
                contact["phone"] = parts[4]

        ent = await grant_or_update_skill_enrollment(
            db,
            student_id=current_user["sub"],
            skill_id=resolved_skill,
            payment_mode=payment_mode,
            installment=installment,
            amount_paid=amount_paid,
            payment_id=payment.id,
            contact=contact,
        )

        return {
            "paid": True,
            "skill_id": resolved_skill,
            "program_title": program["title"],
            "enrollment": True,
            "payment_mode": payment_mode,
            "installment": installment,
            "payment_id": str(payment.id),
            "skill_enrollment": serialize_skill_enrollment(ent),
            "live_class_access": True,
        }

    if plan_id and not is_skill_plan_key(plan_id):
        plan_id = plan_id or payment.live_plan_id
        plan = get_plan(plan_id)
        if not plan:
            raise HTTPException(status_code=400, detail="Unknown plan")

        expected_amount = float(payment.amount) if payment and payment.amount else plan.price
        if amount_paid + 1 < expected_amount and amount_paid + 1 < plan.price:
            raise HTTPException(status_code=400, detail="Incorrect payment amount")

        if payment and payment.status == PaymentStatus.success and payment.live_plan_id:
            activated = await activate_live_plan(db, current_user["sub"], payment.live_plan_id)
            await db.flush()
            return {
                "paid": True,
                "plan_id": payment.live_plan_id,
                "class_id": payload.class_id,
                "payment_id": str(payment.id),
                "active_plan": {
                    **activated,
                    "expires_at": activated["expires_at"].isoformat(),
                },
            }

        if not payment:
            payment = Payment(
                student_id=parse_uuid(current_user["sub"]),
                amount=amount_paid,
                currency=data.get("currency") or "NGN",
                live_plan_id=plan.id,
                description=f"Live plan: {plan.name}",
            )
            db.add(payment)

        payment.status = PaymentStatus.success
        payment.live_plan_id = plan.id
        payment.flutterwave_transaction_id = str(data.get("id") or payload.transaction_id)
        if tx_ref:
            payment.flutterwave_tx_ref = tx_ref
        activated = await activate_live_plan(db, current_user["sub"], plan.id)
        payment.product_type = payment.product_type or "class_package"
        await db.flush()
        try:
            from app.services.monetization_hooks import on_payment_success

            await on_payment_success(db, payment)
        except Exception:
            pass
        return {
            "paid": True,
            "plan_id": plan.id,
            "class_id": payload.class_id,
            "payment_id": str(payment.id),
            "active_plan": {
                **activated,
                "expires_at": activated["expires_at"].isoformat(),
            },
        }

    if payload.material_id:
        mat_res = await db.execute(select(TeacherMaterial).where(TeacherMaterial.id == payload.material_id))
        material = mat_res.scalar_one_or_none()
        if not material or not material.is_active:
            raise HTTPException(status_code=404, detail="Material not found")
        if material.is_free:
            return {"paid": True, "material_id": payload.material_id, "has_access": True}

        if amount_paid < material.price:
            raise HTTPException(status_code=400, detail="Incorrect payment amount")

        if not payment:
            payment = Payment(
                student_id=parse_uuid(current_user["sub"]),
                amount=amount_paid,
                currency=data.get("currency") or "NGN",
                material_id=material.id,
                description=f"Material: {material.title}",
            )
            db.add(payment)

        payment.status = PaymentStatus.success
        payment.flutterwave_transaction_id = str(data.get("id") or payload.transaction_id)
        if tx_ref:
            payment.flutterwave_tx_ref = tx_ref
        await db.flush()

        existing = await db.execute(
            select(MaterialPurchase).where(
                MaterialPurchase.student_id == current_user["sub"],
                MaterialPurchase.material_id == material.id,
            )
        )
        if not existing.scalar_one_or_none():
            db.add(MaterialPurchase(
                student_id=current_user["sub"],
                material_id=material.id,
                payment_id=payment.id,
            ))
            await db.flush()

        try:
            from app.services.monetization_hooks import on_payment_success

            await on_payment_success(db, payment)
        except Exception:
            pass
        return {"paid": True, "material_id": payload.material_id, "has_access": True, "payment_id": str(payment.id)}

    if payload.book_id:
        book_res = await db.execute(select(Book).where(Book.id == payload.book_id))
        book = book_res.scalar_one_or_none()
        if not book or not book.is_active:
            raise HTTPException(status_code=404, detail="Book not found")
        if book.is_free:
            return {"paid": True, "book_id": payload.book_id, "has_access": True}

        if amount_paid < book.price:
            raise HTTPException(status_code=400, detail="Incorrect payment amount")

        if not payment:
            payment = Payment(
                student_id=parse_uuid(current_user["sub"]),
                amount=amount_paid,
                currency=data.get("currency") or "NGN",
                book_id=book.id,
                description=f"Scholaxia material: {book.title}",
            )
            db.add(payment)

        payment.status = PaymentStatus.success
        payment.flutterwave_transaction_id = str(data.get("id") or payload.transaction_id)
        if tx_ref:
            payment.flutterwave_tx_ref = tx_ref
        await db.flush()

        existing = await db.execute(
            select(BookPurchase).where(
                BookPurchase.student_id == current_user["sub"],
                BookPurchase.book_id == book.id,
            )
        )
        if not existing.scalar_one_or_none():
            db.add(BookPurchase(
                student_id=current_user["sub"],
                book_id=book.id,
                payment_id=payment.id,
            ))
            await db.flush()

        return {"paid": True, "book_id": payload.book_id, "has_access": True, "payment_id": str(payment.id)}

    raise HTTPException(status_code=400, detail="Could not verify payment")
