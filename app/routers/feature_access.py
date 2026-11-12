"""Feature access / maintenance APIs.

Public endpoint: the apps read which features are locked.
Admin endpoints: the admin panel reads the full catalog and toggles locks.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_admin
from app.models.feature_access import (
    DEFAULT_MAINTENANCE_MESSAGE,
    FEATURE_CATALOG,
    FEATURE_KEYS,
    FeatureAccessLock,
)

router = APIRouter(prefix="/feature-access", tags=["Feature Access"])
admin_router = APIRouter(prefix="/admin/feature-access", tags=["Admin Feature Access"])


class FeatureLockUpdate(BaseModel):
    key: str = Field(..., min_length=1, max_length=80)
    locked: bool
    message: str | None = Field(default=None, max_length=1000)


class FeatureBulkUpdate(BaseModel):
    updates: list[FeatureLockUpdate] = Field(default_factory=list)


def _clean_message(value: str | None) -> str | None:
    text = (value or "").strip()
    return text[:1000] if text else None


def _feature_meta(key: str) -> dict | None:
    for item in FEATURE_CATALOG:
        if item["key"] == key:
            return item
    return None


async def _lock_rows(db: AsyncSession) -> dict[str, FeatureAccessLock]:
    rows = (await db.execute(select(FeatureAccessLock))).scalars().all()
    return {row.feature_key: row for row in rows}


def _public_lock(row: FeatureAccessLock | None) -> dict | None:
    if row is None or not row.is_locked:
        return None
    return {
        "message": _clean_message(row.message) or DEFAULT_MAINTENANCE_MESSAGE,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("")
async def get_public_feature_access(
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Everything the student / kind apps need to guard their screens."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    rows = await _lock_rows(db)
    locks = {}
    for key, row in rows.items():
        item = _public_lock(row)
        if item:
            locks[key] = item
    return {
        "locks": locks,
        "default_message": DEFAULT_MAINTENANCE_MESSAGE,
        "features": [
            {
                "key": item["key"],
                "section": item["section"],
                "label": item["label"],
            }
            for item in FEATURE_CATALOG
        ],
    }


def _admin_feature(item: dict, row: FeatureAccessLock | None) -> dict:
    return {
        "key": item["key"],
        "section": item["section"],
        "label": item["label"],
        "description": item["description"],
        "locked": bool(row and row.is_locked),
        "message": _clean_message(row.message) if row else None,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
        "updated_by": row.updated_by if row else None,
    }


@admin_router.get("")
async def list_feature_access(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await _lock_rows(db)
    return {
        "features": [_admin_feature(item, rows.get(item["key"])) for item in FEATURE_CATALOG],
        "default_message": DEFAULT_MAINTENANCE_MESSAGE,
        "sections": [
            {"id": "student", "label": "Student app"},
            {"id": "kind", "label": "Kind (kids) app"},
        ],
    }


async def _apply_update(
    update: FeatureLockUpdate,
    current_user: dict,
    rows: dict[str, FeatureAccessLock],
    db: AsyncSession,
) -> FeatureAccessLock:
    if update.key not in FEATURE_KEYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown feature key: {update.key}",
        )
    row = rows.get(update.key)
    if row is None:
        row = FeatureAccessLock(feature_key=update.key, is_locked=False)
        db.add(row)
        rows[update.key] = row
    row.is_locked = bool(update.locked)
    if update.message is not None:
        row.message = _clean_message(update.message)
    row.updated_by = (
        str(current_user.get("email") or current_user.get("full_name") or current_user.get("sub") or "")[:180]
        or None
    )
    return row


@admin_router.patch("/{feature_key}")
async def update_feature_access(
    feature_key: str,
    payload: FeatureLockUpdate,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if feature_key not in FEATURE_KEYS:
        raise HTTPException(status_code=404, detail="Unknown feature")
    rows = await _lock_rows(db)
    body = payload.model_copy(update={"key": feature_key})
    row = await _apply_update(body, current_user, rows, db)
    await db.flush()
    item = _feature_meta(feature_key)
    return {"feature": _admin_feature(item or {}, row)}


@admin_router.put("")
async def bulk_update_feature_access(
    payload: FeatureBulkUpdate,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await _lock_rows(db)
    for update in payload.updates:
        await _apply_update(update, current_user, rows, db)
    await db.flush()
    return {
        "features": [
            _admin_feature(item, rows.get(item["key"])) for item in FEATURE_CATALOG
        ]
    }


@admin_router.post("/unlock-all")
async def unlock_all_features(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await _lock_rows(db)
    for item in FEATURE_CATALOG:
        row = rows.get(item["key"])
        if row is not None and row.is_locked:
            row.is_locked = False
            row.updated_by = (
                str(current_user.get("email") or current_user.get("full_name") or current_user.get("sub") or "")[:180]
                or None
            )
    await db.flush()
    return {"ok": True, "unlocked": len(FEATURE_CATALOG)}
