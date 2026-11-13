"""Delete a user row together with everything that points at it.

None of our foreign keys use ON DELETE CASCADE, so deleting a student used to
fail the moment they owned a wallet row, a notification, a school record or an
exam attempt: Postgres refused the delete and the request died with a 500.
This walks every table that references users.id, clears the rows that belong to
the user (children first, repeated until nothing changes) and then removes the
user itself — so "Delete student" really deletes.
"""

from fastapi import HTTPException
from sqlalchemy import delete

from app.core.database import Base


# Records that must never be swept away with an account.
SKIP_TABLES = {"schools", "school_campuses", "school_students", "users"}


def _user_fk_pairs():
    """[(table, column)] for every column that references users.id."""
    pairs = []
    for table in Base.metadata.sorted_tables:
        if table.name in SKIP_TABLES:
            continue
        for col in table.columns:
            for fk in col.foreign_keys:
                target = getattr(fk, "target_fullname", "") or ""
                if target == "users.id":
                    pairs.append((table, col))
                    break
    return pairs


async def purge_user(db, user_id) -> None:
    """Remove every row owned by `user_id`, then the user."""
    from app.models.user import User

    pairs = _user_fk_pairs()
    # Children first, then again: a table may reference another table that also
    # references the user (a post's comments, an attempt's answers…). A table
    # that cannot be cleared yet (still referenced by a child) is simply retried
    # on the next pass; one that is missing from the schema is skipped.
    for _ in range(6):
        changed = False
        for table, col in reversed(pairs):
            try:
                res = await db.execute(delete(table).where(col == user_id))
            except Exception:
                await db.rollback()
                continue
            if res.rowcount and res.rowcount > 0:
                await db.commit()
                changed = True
        if not changed:
            break
    try:
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Some of this student's records could not be removed — try again in a moment.",
        )
