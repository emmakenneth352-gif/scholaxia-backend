"""Database schema bootstrap — runs on app startup when DATABASE_URL is reachable.

Robustness contract (learned from the 2026-09 outage where users.country/language
rolled back and every authenticated endpoint 500'd):
  1. Each migration statement runs in its own savepoint — one failure can never
     poison the transaction and roll back the statements that succeeded.
  2. After the hand-written migrations, a self-healing safety net introspects the
     live schema and adds any model column that is still missing, so a new model
     field without a hand-written migration can never take production down.
"""
import asyncio
import logging
import socket

from sqlalchemy import text
from sqlalchemy.schema import CreateColumn
from sqlalchemy.dialects import postgresql

from app.core.config import settings
from app.core.database import Base, AsyncSessionLocal, engine
from app.core.seed import seed_database

logger = logging.getLogger(__name__)

_db_initialized = False


def database_ready() -> bool:
    return _db_initialized


# ── Hand-written migrations ───────────────────────────────────────────────────
# Each statement is idempotent and runs in its own savepoint (see
# _run_schema_migrations). Order matters only for readability; failures are
# isolated and logged, never fatal for the rest of the list.
_SCHEMA_STATEMENTS = (
    # users
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(40) NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(80) NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_phone ON users (phone)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id UUID NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0",
    # sub-admin hierarchy
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_admin_permissions VARCHAR(500) NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_admin_id UUID NULL",
    "ALTER TABLE users ALTER COLUMN profile_picture TYPE VARCHAR(1000)",
    # cbt_exams
    "ALTER TABLE cbt_exams ALTER COLUMN created_by DROP NOT NULL",
    "ALTER TABLE cbt_exams ADD COLUMN IF NOT EXISTS paper_kind VARCHAR(32) NOT NULL DEFAULT 'cbt_practice'",
    "ALTER TABLE cbt_exams ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMP NULL",
    "ALTER TABLE cbt_exams ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMP NULL",
    "ALTER TABLE cbt_exams ADD COLUMN IF NOT EXISTS year INTEGER NULL",
    "ALTER TABLE cbt_exams ADD COLUMN IF NOT EXISTS assigned_student_ids JSON NULL",
    "ALTER TABLE cbt_exams ADD COLUMN IF NOT EXISTS notes_url VARCHAR(500) NULL",
    "ALTER TABLE cbt_exams ADD COLUMN IF NOT EXISTS notes_title VARCHAR(255) NULL",
    "ALTER TABLE cbt_exams ADD COLUMN IF NOT EXISTS school_id UUID NULL",
    # community posts
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'everyone'",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS cbt_exam_id UUID NULL",
    "UPDATE community_posts SET visibility = 'everyone' WHERE visibility IS NULL",
    "UPDATE community_posts SET is_anonymous = FALSE WHERE is_anonymous IS NULL",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS group_id UUID NULL REFERENCES student_groups(id)",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS media_url VARCHAR(500) NULL",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS media_type VARCHAR(50) NULL",
    "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL",
    # school_campuses — Pass 7: features the school requested at registration
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS requested_features JSON NULL",
    # school_campuses — optional custom domain hosted by Scholaxia
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255) NULL",
    # school_exam_access_codes — Pass 7: exam_id NULL = credential issued at
    # registration (printed on the slip), attached to an exam when scheduled
    "ALTER TABLE school_exam_access_codes ALTER COLUMN exam_id DROP NOT NULL",
    # student_profiles
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS jamb_subjects VARCHAR[] NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS ssce_subjects VARCHAR[] NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS ssce_exam_type VARCHAR(20) NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS waec_subjects VARCHAR[] NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS neco_subjects VARCHAR[] NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS education_level VARCHAR(50) NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS school_student_id VARCHAR(40) NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS live_plan_id VARCHAR(80) NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS live_plan_expires_at TIMESTAMP NULL",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS live_plan_sessions_used INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS community_channel_id UUID NULL",
    # live_classes
    "ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS academic_class VARCHAR(40) NULL",
    "ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS school_id UUID NULL",
    "ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'subject'",
    "ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS join_code VARCHAR(32) NULL",
    "ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS started_notified_at TIMESTAMP NULL",
    "ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS invited_student_ids TEXT NULL",
    "ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS school_group_id UUID NULL",
    # marketplace
    "ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS vendor_id UUID NULL",
    "ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'",
    "ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS source_role VARCHAR(20) NOT NULL DEFAULT 'admin'",
    "ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS stock_qty INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE marketplace_products ALTER COLUMN image_url TYPE VARCHAR(1000)",
    # teacher_profiles
    "ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS academic_classes VARCHAR[] NULL",
    "ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS school_id UUID NULL",
    "ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS location VARCHAR(255) NULL",
    "ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE",
    # school exams
    "ALTER TABLE school_exam_candidates ADD COLUMN IF NOT EXISTS school_id UUID NULL",
    "ALTER TABLE school_exam_candidates ADD COLUMN IF NOT EXISTS candidate_id VARCHAR(40) NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_school_exam_candidates_candidate_id ON school_exam_candidates (candidate_id)",
    "ALTER TABLE external_exams ADD COLUMN IF NOT EXISTS allowed_classes JSON NULL",
    "ALTER TABLE external_exam_attempts ADD COLUMN IF NOT EXISTS student_user_id UUID NULL",
    "ALTER TABLE external_exam_attempts ALTER COLUMN candidate_id DROP NOT NULL",
    # Owner spec §25: scores hidden from students until the school publishes
    "ALTER TABLE external_exam_attempts ADD COLUMN IF NOT EXISTS result_status VARCHAR(20) NULL",
    "UPDATE external_exam_attempts SET result_status = 'hidden' WHERE result_status IS NULL",
    # Owner spec OFFLINE SECURITY: single-use access codes (consumed on first
    # exam submission) + audit trail of offline synchronization.
    "ALTER TABLE school_exam_candidates ADD COLUMN IF NOT EXISTS is_used BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE school_exam_candidates ADD COLUMN IF NOT EXISTS used_at TIMESTAMP NULL",
    "ALTER TABLE school_exam_candidates ADD COLUMN IF NOT EXISTS used_for_exam_id UUID NULL",
    """
    CREATE TABLE IF NOT EXISTS offline_sync_audits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attempt_code VARCHAR(40) NULL,
        exam_id UUID NULL REFERENCES external_exams(id),
        school_id UUID NULL REFERENCES school_campuses(id),
        student_user_id UUID NULL REFERENCES users(id),
        event VARCHAR(32) NOT NULL DEFAULT 'received',
        channel VARCHAR(24) NOT NULL DEFAULT 'online',
        offline_started_at TIMESTAMP NULL,
        offline_submitted_at TIMESTAMP NULL,
        synced_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        detail JSON NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_offline_sync_audits_exam ON offline_sync_audits (exam_id)",
    "CREATE INDEX IF NOT EXISTS ix_offline_sync_audits_school ON offline_sync_audits (school_id)",
    "CREATE INDEX IF NOT EXISTS ix_offline_sync_audits_student ON offline_sync_audits (student_user_id)",
    # Owner spec §3/§7: school approval workflow + per-school feature toggles
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NULL",
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL",
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500) NULL",
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS feature_overrides JSON NULL",
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255) NULL",
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(40) NULL",
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS address VARCHAR(500) NULL",
    "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500) NULL",
    "UPDATE school_campuses SET approval_status = 'approved' WHERE approval_status IS NULL AND is_active IS TRUE",
    "UPDATE school_campuses SET approval_status = 'pending' WHERE approval_status IS NULL",
    # payments
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS flutterwave_tx_ref VARCHAR(255) NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS flutterwave_transaction_id VARCHAR(255) NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS live_class_id UUID NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS material_id UUID NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS live_plan_id VARCHAR(80) NULL",
    "ALTER TABLE payments ALTER COLUMN student_id DROP NOT NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS book_id UUID NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider VARCHAR(30) NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(255) NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_transaction_id VARCHAR(255) NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS product_type VARCHAR(40) NULL",
    "ALTER TABLE payments ADD COLUMN IF NOT EXISTS product_id VARCHAR(120) NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_provider_reference "
    "ON payments (provider_reference) WHERE provider_reference IS NOT NULL",
    # entitlements / session requests
    "ALTER TABLE student_entitlements ADD COLUMN IF NOT EXISTS details JSON NULL",
    "ALTER TABLE live_session_requests ADD COLUMN IF NOT EXISTS assigned_teacher_id UUID NULL",
    # books (library)
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS category VARCHAR(80) NOT NULL DEFAULT 'Books'",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS education_level VARCHAR(80) NULL",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS term VARCHAR(40) NULL",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS scheme_week INTEGER NULL",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS scheme_topic VARCHAR(255) NULL",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS year INTEGER NULL",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS library_target VARCHAR(20) NOT NULL DEFAULT 'student'",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS is_downloadable BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS allow_copy BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS allow_screenshot BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE books ADD COLUMN IF NOT EXISTS allow_print BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TYPE librarytarget ADD VALUE IF NOT EXISTS 'kind'",
    # videos
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'student'",
    # tables (IF NOT EXISTS — safe to re-run)
    """
    CREATE TABLE IF NOT EXISTS past_question_guest_access (
        id UUID PRIMARY KEY,
        book_id UUID NOT NULL REFERENCES books(id),
        email VARCHAR(255) NOT NULL,
        access_token VARCHAR(64) NOT NULL UNIQUE,
        payment_id UUID NULL REFERENCES payments(id),
        payment_reference VARCHAR(100) NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITHOUT TIME ZONE NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_pq_guest_access_token ON past_question_guest_access (access_token)",
    "CREATE INDEX IF NOT EXISTS ix_pq_guest_email ON past_question_guest_access (email)",
    "CREATE INDEX IF NOT EXISTS ix_pq_guest_book ON past_question_guest_access (book_id)",
    """
    CREATE TABLE IF NOT EXISTS school_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        teacher_id UUID NOT NULL REFERENCES users(id),
        school_name VARCHAR(200) NOT NULL,
        name VARCHAR(200) NOT NULL,
        student_ids TEXT NOT NULL DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS post_reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES community_posts(id),
        user_id UUID NOT NULL REFERENCES users(id),
        emoji VARCHAR(16) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (post_id, user_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS kind_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE NOT NULL REFERENCES users(id),
        age_group VARCHAR(20) NOT NULL DEFAULT '6-8',
        grade_level VARCHAR(50),
        parent_email VARCHAR(255),
        favorite_subjects TEXT[] DEFAULT '{}',
        learning_goals VARCHAR(500),
        preferred_language VARCHAR(30) DEFAULT 'english'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS vendor_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE NOT NULL REFERENCES users(id),
        business_name VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        categories TEXT[] DEFAULT '{}',
        is_approved BOOLEAN NOT NULL DEFAULT FALSE
    )
    """,
    # student groups
    "ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS is_restricted BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS image_url VARCHAR(1000)",
    "UPDATE student_groups SET is_approved = TRUE WHERE is_approved IS NULL",
    # Avoid Postgres enum mismatches on group member/join roles (500 source).
    "ALTER TABLE student_group_members ALTER COLUMN role TYPE VARCHAR(20) USING role::text",
    "ALTER TABLE student_group_join_requests ALTER COLUMN status TYPE VARCHAR(20) USING status::text",
    # vendor profiles
    "ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS address VARCHAR(500) NULL",
    "ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(40) NULL",
    "ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS nin VARCHAR(20) NULL",
    "ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS kyc_completed BOOLEAN NOT NULL DEFAULT FALSE",
    # Postgres enums (also handled one-per-transaction in ensure_postgres_enums)
    "ALTER TYPE examtype ADD VALUE IF NOT EXISTS 'POST_UTME'",
    "ALTER TYPE examtype ADD VALUE IF NOT EXISTS 'JUNIOR_WAEC'",
    "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'kind'",
    "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'vendor'",
    "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'school_admin'",
    # SIL
    "ALTER TABLE sil_anticheat_events ADD COLUMN IF NOT EXISTS severity INTEGER NOT NULL DEFAULT 1",
    # Marketplace escrow / vendor payouts
    "ALTER TABLE marketplace_order_items ADD COLUMN IF NOT EXISTS platform_fee DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE marketplace_order_items ADD COLUMN IF NOT EXISTS vendor_net DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE marketplace_order_items ADD COLUMN IF NOT EXISTS escrow_status VARCHAR(30) NOT NULL DEFAULT 'none'",
    "ALTER TABLE marketplace_order_items ADD COLUMN IF NOT EXISTS buyer_confirmed BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE marketplace_order_items ADD COLUMN IF NOT EXISTS buyer_confirmed_at TIMESTAMP NULL",
    # Pay-after-delivery-assignment flow (buyer pays only once delivery is assigned)
    "ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS delivery_fee DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS delivery_assigned BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS delivery_assigned_at TIMESTAMP NULL",
    """
    CREATE TABLE IF NOT EXISTS vendor_withdrawal_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_id UUID NOT NULL REFERENCES users(id),
        amount DOUBLE PRECISION NOT NULL,
        bank_name VARCHAR(255) NOT NULL,
        account_number VARCHAR(40) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        admin_note TEXT NULL,
        requested_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP NULL,
        processed_by UUID NULL REFERENCES users(id)
    )
    """,
)


async def ensure_school_plans_schema() -> None:
    """Tables + columns for the school commercial core (plans, results, cards).

    New tables are covered by create_all; the slug column on the pre-existing
    school_campuses table needs an explicit ALTER on deployed databases.
    """
    stmts = (
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS slug VARCHAR(80) NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_school_campuses_slug ON school_campuses (slug)",
        "CREATE INDEX IF NOT EXISTS ix_school_results_student ON school_results (student_id)",
        "CREATE INDEX IF NOT EXISTS ix_school_results_school ON school_results (school_id)",
        "ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS term_label VARCHAR(80) NULL",
        "ALTER TABLE school_subscriptions ALTER COLUMN term_label SET DEFAULT ''",
    )
    for stmt in stmts:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("school_plans schema skipped: %s (%s)", stmt, exc)


async def ensure_school_campus_schema() -> None:
    """Add school_campuses columns that create_all skips on existing tables.

    Runs in its own transaction so a failed bulk migration does not block this.
    """
    stmts = (
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(80) NULL",
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS school_type VARCHAR(20) NULL",
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS category VARCHAR(20) NULL",
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS portal_subjects JSONB NULL",
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS portal_classes JSONB NULL",
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS portal_attendance JSONB NULL",
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS portal_fees JSONB NULL",
        "ALTER TABLE school_campuses ADD COLUMN IF NOT EXISTS portal_results JSONB NULL",
    )
    for stmt in stmts:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("school_campus schema skipped: %s (%s)", stmt, exc)


async def ensure_ai_token_schema() -> None:
    """AI token wallets + transactions + ai_tokens override column.

    create_all covers the new tables; the ALTER covers the plan_overrides
    column on databases that already have the table.
    """
    stmts = (
        "ALTER TABLE plan_overrides ADD COLUMN IF NOT EXISTS ai_tokens INTEGER NULL",
        "ALTER TABLE ai_token_wallets ADD COLUMN IF NOT EXISTS last_refill_at TIMESTAMP NULL",
        "CREATE INDEX IF NOT EXISTS ix_ai_token_tx_user ON ai_token_transactions (user_id)",
    )
    for stmt in stmts:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("ai_token schema skipped: %s (%s)", stmt, exc)


async def ensure_postgres_enums() -> None:
    """Commit each new enum label in its own transaction so it can be used immediately."""
    from app.models.community import AssignmentFileType
    from app.models.user import ExamType, UserRole

    labels = [f"ALTER TYPE userrole ADD VALUE IF NOT EXISTS '{e.value}'" for e in UserRole]
    labels += [f"ALTER TYPE examtype ADD VALUE IF NOT EXISTS '{e.value}'" for e in ExamType]
    labels += [
        f"ALTER TYPE assignmentfiletype ADD VALUE IF NOT EXISTS '{e.value}'"
        for e in AssignmentFileType
    ]
    for stmt in labels:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("enum migrate skipped: %s (%s)", stmt, exc)


async def probe_database() -> bool:
    """Live ping. Startup may have failed while Postgres later became reachable."""
    global _db_initialized
    try:
        async with engine.connect() as conn:
            await asyncio.wait_for(conn.execute(text("SELECT 1")), timeout=5)
        _db_initialized = True
        return True
    except Exception as exc:
        logger.warning("Database probe failed for host %r: %s", settings.database_host, exc)
        return False


async def _run_schema_migrations() -> None:
    """Run create_all + every hand-written migration, each in its OWN transaction.

    A single failing statement (bad SQL *or* a dropped connection) logs a warning
    and moves on — it can never roll back the successful ones (the old
    single-transaction version did exactly that: one bad ALTER wiped
    users.country/language and 500'd the whole API).
    """
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as exc:
        logger.error("create_all failed (continuing with column migrations): %s", exc)

    for stmt in _SCHEMA_STATEMENTS:
        label = " ".join(stmt.split())[:100]
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("schema stmt skipped: %s -> %s", label, exc)


async def ensure_model_columns() -> None:
    """Self-healing safety net: add any model column missing from the live DB.

    Introspects information_schema and compares it against SQLAlchemy metadata.
    Guarantees a deploy can never 500 every authenticated endpoint just because
    a new model field was not mirrored by a hand-written migration.
    Each ALTER runs in its own transaction (fresh pooled connection) so one
    failure or a dropped connection cannot affect the others.
    """
    added = []
    try:
        async with engine.connect() as conn:
            result = await conn.execute(text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema='public'"
            ))
            live = {}
            for t, c in result.fetchall():
                live.setdefault(t, set()).add(c)

        for table in Base.metadata.sorted_tables:
            existing_cols = live.get(table.name)
            if existing_cols is None:
                continue  # missing tables are create_all's job (needs full FK graph)
            for col in table.columns:
                if col.name in existing_cols or col.primary_key:
                    continue
                try:
                    col_ddl = str(CreateColumn(col).compile(dialect=postgresql.dialect()))
                except Exception:
                    continue
                # NOT NULL without a server default breaks ADD COLUMN on a
                # non-empty table — give scalar columns a safe default,
                # add everything else as nullable.
                suffix = ""
                if not col.nullable and col.server_default is None:
                    type_name = type(col.type).__name__
                    if type_name == "Boolean":
                        suffix = " DEFAULT FALSE"
                    elif type_name in ("Integer", "BigInteger", "Float", "Numeric"):
                        suffix = " DEFAULT 0"
                    else:
                        col_ddl = col_ddl.replace(" NOT NULL", "")
                stmt = f"ALTER TABLE {table.name} ADD COLUMN IF NOT EXISTS {col_ddl}{suffix}"
                try:
                    async with engine.begin() as conn:
                        await conn.execute(text(stmt))
                    added.append(f"{table.name}.{col.name}")
                    logger.info("ensure_model_columns: added %s.%s", table.name, col.name)
                except Exception as exc:
                    logger.warning(
                        "ensure_model_columns skipped %s.%s: %s", table.name, col.name, exc
                    )
    except Exception as exc:
        logger.warning("ensure_model_columns failed: %s", exc)
    if added:
        logger.info("ensure_model_columns: %d column(s) added: %s", len(added), ", ".join(added))


async def ensure_cbt_coupon_tables() -> None:
    """Make sure CBT coupon tables exist (create_all can miss them on older deploys)."""
    stmts = (
        """
        CREATE TABLE IF NOT EXISTS cbt_coupons (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code VARCHAR(40) NOT NULL UNIQUE,
            package_id VARCHAR(80) NOT NULL,
            max_uses INTEGER DEFAULT 1,
            used_count INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT TRUE,
            note TEXT NULL,
            expires_at TIMESTAMP NULL,
            created_by UUID NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_cbt_coupons_code ON cbt_coupons (code)",
        "CREATE INDEX IF NOT EXISTS ix_cbt_coupons_package_id ON cbt_coupons (package_id)",
        """
        CREATE TABLE IF NOT EXISTS cbt_coupon_redemptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            coupon_id UUID NOT NULL REFERENCES cbt_coupons(id),
            student_id UUID NOT NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_cbt_coupon_redemptions_coupon_id ON cbt_coupon_redemptions (coupon_id)",
        "CREATE INDEX IF NOT EXISTS ix_cbt_coupon_redemptions_student_id ON cbt_coupon_redemptions (student_id)",
    )
    try:
        async with engine.begin() as conn:
            for stmt in stmts:
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    logger.warning("cbt coupon schema stmt skipped: %s", exc)
    except Exception as exc:
        logger.warning("cbt coupon schema skipped: %s", exc)


async def ensure_study_coupon_tables() -> None:
    """Study coupons unlock Video Tutorials without a payment (owner request)."""
    stmts = (
        """
        CREATE TABLE IF NOT EXISTS study_coupons (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code VARCHAR(40) NOT NULL UNIQUE,
            skill VARCHAR(60) NOT NULL DEFAULT 'all',
            max_uses INTEGER DEFAULT 1,
            used_count INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT TRUE,
            note TEXT NULL,
            expires_at TIMESTAMP NULL,
            access_days INTEGER NULL,
            created_by UUID NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_study_coupons_code ON study_coupons (code)",
        "ALTER TABLE study_coupons ADD COLUMN IF NOT EXISTS skill VARCHAR(60) NOT NULL DEFAULT 'all'",
        "ALTER TABLE study_coupons ADD COLUMN IF NOT EXISTS access_days INTEGER NULL",
        """
        CREATE TABLE IF NOT EXISTS study_coupon_redemptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            coupon_id UUID NOT NULL REFERENCES study_coupons(id),
            student_id UUID NOT NULL REFERENCES users(id),
            skill VARCHAR(60) NULL,
            expires_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_study_coupon_redemptions_coupon_id ON study_coupon_redemptions (coupon_id)",
        "CREATE INDEX IF NOT EXISTS ix_study_coupon_redemptions_student_id ON study_coupon_redemptions (student_id)",
        "ALTER TABLE study_coupon_redemptions ADD COLUMN IF NOT EXISTS skill VARCHAR(60) NULL",
        "ALTER TABLE study_coupon_redemptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL",
    )
    try:
        async with engine.begin() as conn:
            for stmt in stmts:
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    logger.warning("study coupon schema stmt skipped: %s", exc)
    except Exception as exc:
        logger.warning("study coupon schema skipped: %s", exc)


async def ensure_videos_table() -> None:
    """Ensure video tutorials table exists for admin publish + student watch."""
    stmts = (
        """
        CREATE TABLE IF NOT EXISTS videos (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title VARCHAR(255) NOT NULL,
            subject VARCHAR(100) NOT NULL,
            exam_type VARCHAR(20) NULL,
            video_url VARCHAR(500) NOT NULL,
            thumbnail_url VARCHAR(500) NULL,
            duration_seconds INTEGER NULL,
            uploaded_by UUID NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_videos_subject ON videos (subject)",
        "CREATE INDEX IF NOT EXISTS ix_videos_created_at ON videos (created_at)",
    )
    try:
        async with engine.begin() as conn:
            for stmt in stmts:
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    logger.warning("videos schema stmt skipped: %s", exc)
    except Exception as exc:
        logger.warning("ensure_videos_table failed: %s", exc)


async def ensure_community_posts_columns() -> None:
    """Guarantee Community/Groups feed columns land even if the bulk migration rolled back.

    Each ALTER runs in its own transaction so one failure cannot undo the others.
    """
    stmts = (
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS group_id UUID NULL",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS media_url VARCHAR(500) NULL",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS media_type VARCHAR(50) NULL",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'everyone'",
        "ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS cbt_exam_id UUID NULL",
        "ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS is_restricted BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS image_url VARCHAR(1000)",
        "ALTER TABLE student_group_members ALTER COLUMN role TYPE VARCHAR(20) USING role::text",
        "ALTER TABLE student_group_join_requests ALTER COLUMN status TYPE VARCHAR(20) USING status::text",
    )
    for stmt in stmts:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("community/groups column migrate skipped: %s (%s)", stmt, exc)


async def ensure_school_cbt_schema() -> None:
    """SCHOLAXIA CBT engine (spec §31): exam bank, exams, access codes,
    attempts, answers, downloads, sync logs, results.

    New tables are create_all's job at boot; these statements cover the
    tenant/index safety nets on databases where they pre-exist.
    Runs ONLY from initialize_database() at boot — never per request
    (per-request ALTERs deadlocked table locks and hung every portal tab).
    """
    stmts = (
        """
        CREATE TABLE IF NOT EXISTS school_ex_question_banks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            name VARCHAR(200) NOT NULL,
            subject VARCHAR(120) NOT NULL,
            class_name VARCHAR(40) NOT NULL,
            description TEXT NULL,
            status VARCHAR(12) NOT NULL DEFAULT 'active',
            created_by UUID NULL REFERENCES users(id),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_school_ex_question_banks_school ON school_ex_question_banks (school_id)",
        "ALTER TABLE school_ex_question_banks ADD COLUMN IF NOT EXISTS school_level VARCHAR(20) NULL",
        """
        CREATE TABLE IF NOT EXISTS school_subjects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(120) NOT NULL,
            normalized VARCHAR(140) NOT NULL,
            school_id UUID NULL REFERENCES school_campuses(id),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            is_custom BOOLEAN NOT NULL DEFAULT FALSE,
            created_by UUID NULL REFERENCES users(id),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_school_subjects_school_norm ON school_subjects (school_id, normalized)",
        """
        CREATE TABLE IF NOT EXISTS school_subject_offerings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            subject_id UUID NOT NULL REFERENCES school_subjects(id),
            school_id UUID NULL REFERENCES school_campuses(id),
            level VARCHAR(20) NOT NULL,
            class_name VARCHAR(40) NOT NULL,
            is_enabled BOOLEAN NOT NULL DEFAULT TRUE
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_subject_offering_lookup ON school_subject_offerings (school_id, level, class_name)",
        """
        CREATE TABLE IF NOT EXISTS school_ex_questions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            bank_id UUID NOT NULL REFERENCES school_ex_question_banks(id),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            question_text TEXT NOT NULL,
            option_a TEXT NOT NULL DEFAULT '',
            option_b TEXT NOT NULL DEFAULT '',
            option_c TEXT NOT NULL DEFAULT '',
            option_d TEXT NOT NULL DEFAULT '',
            correct_option VARCHAR(12) NOT NULL DEFAULT 'A',
            question_type VARCHAR(16) NOT NULL DEFAULT 'mcq',
            topic VARCHAR(255) NULL,
            sub_topic VARCHAR(255) NULL,
            marks INTEGER NOT NULL DEFAULT 1,
            difficulty VARCHAR(10) NOT NULL DEFAULT 'medium',
            explanation TEXT NULL,
            year VARCHAR(20) NULL,
            tags JSON NULL,
            image_url VARCHAR(500) NULL,
            status VARCHAR(12) NOT NULL DEFAULT 'active'
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_school_ex_questions_bank ON school_ex_questions (bank_id)",
        "CREATE INDEX IF NOT EXISTS ix_school_ex_questions_school ON school_ex_questions (school_id)",
        """
        CREATE TABLE IF NOT EXISTS school_exams (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            title VARCHAR(255) NOT NULL,
            subject VARCHAR(120) NOT NULL,
            class_name VARCHAR(40) NOT NULL,
            exam_type VARCHAR(30) NOT NULL DEFAULT 'SCHOOL',
            session VARCHAR(30) NULL,
            term VARCHAR(30) NULL,
            instructions TEXT NULL,
            exam_mode VARCHAR(10) NOT NULL DEFAULT 'ONLINE',
            total_mark INTEGER NOT NULL DEFAULT 100,
            duration_minutes INTEGER NOT NULL DEFAULT 60,
            questions_to_display INTEGER NOT NULL DEFAULT 0,
            questions_to_answer INTEGER NOT NULL DEFAULT 0,
            randomize_questions BOOLEAN NOT NULL DEFAULT FALSE,
            randomize_options BOOLEAN NOT NULL DEFAULT FALSE,
            allow_review BOOLEAN NOT NULL DEFAULT TRUE,
            allow_previous BOOLEAN NOT NULL DEFAULT TRUE,
            allow_flagging BOOLEAN NOT NULL DEFAULT TRUE,
            bank_ids JSON NULL,
            selected_question_ids JSON NULL,
            auto_pick_count INTEGER NOT NULL DEFAULT 0,
            exam_date TIMESTAMP NULL,
            scheduled_start TIMESTAMP NULL,
            scheduled_end TIMESTAMP NULL,
            assigned_student_ids JSON NULL,
            assigned_class_names JSON NULL,
            access_code_expires_at TIMESTAMP NULL,
            max_attempts INTEGER NOT NULL DEFAULT 1,
            retake_student_ids JSON NULL,
            results_published BOOLEAN NOT NULL DEFAULT FALSE,
            status VARCHAR(12) NOT NULL DEFAULT 'draft',
            is_published BOOLEAN NOT NULL DEFAULT FALSE,
            created_by UUID NULL REFERENCES users(id),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_school_exams_school ON school_exams (school_id)",
        "CREATE INDEX IF NOT EXISTS ix_school_exams_status ON school_exams (status)",
        """
        CREATE TABLE IF NOT EXISTS school_exam_questions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            exam_id UUID NOT NULL REFERENCES school_exams(id),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            bank_question_id UUID NULL REFERENCES school_ex_questions(id),
            question_text TEXT NOT NULL,
            option_a TEXT NOT NULL DEFAULT '',
            option_b TEXT NOT NULL DEFAULT '',
            option_c TEXT NOT NULL DEFAULT '',
            option_d TEXT NOT NULL DEFAULT '',
            correct_option VARCHAR(12) NOT NULL DEFAULT 'A',
            question_type VARCHAR(16) NOT NULL DEFAULT 'mcq',
            topic VARCHAR(255) NULL,
            marks INTEGER NOT NULL DEFAULT 1,
            position INTEGER NOT NULL DEFAULT 0
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_school_exam_questions_exam ON school_exam_questions (exam_id)",
        """
        CREATE TABLE IF NOT EXISTS school_exam_assignments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            exam_id UUID NOT NULL REFERENCES school_exams(id),
            student_id UUID NOT NULL REFERENCES users(id),
            class_name VARCHAR(40) NULL,
            subject VARCHAR(120) NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """,
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_school_exam_assignments ON school_exam_assignments (exam_id, student_id)",
        "CREATE INDEX IF NOT EXISTS ix_school_exam_assignments_student ON school_exam_assignments (student_id)",
        """
        CREATE TABLE IF NOT EXISTS school_exam_access_codes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            exam_id UUID NOT NULL REFERENCES school_exams(id),
            student_id UUID NOT NULL REFERENCES users(id),
            reg_number VARCHAR(40) NOT NULL,
            access_code VARCHAR(40) NOT NULL,
            is_used BOOLEAN NOT NULL DEFAULT FALSE,
            used_at TIMESTAMP NULL,
            expires_at TIMESTAMP NULL,
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TIMESTAMP NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """,
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_school_exam_codes ON school_exam_access_codes (exam_id, student_id)",
        "CREATE INDEX IF NOT EXISTS ix_school_exam_codes_reg ON school_exam_access_codes (reg_number)",
        "CREATE INDEX IF NOT EXISTS ix_school_exam_codes_code ON school_exam_access_codes (access_code)",
        """
        CREATE TABLE IF NOT EXISTS school_exam_attempts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            exam_id UUID NOT NULL REFERENCES school_exams(id),
            student_id UUID NOT NULL REFERENCES users(id),
            access_code_id UUID NULL REFERENCES school_exam_access_codes(id),
            started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            deadline_at TIMESTAMP NULL,
            submitted_at TIMESTAMP NULL,
            is_auto_submitted BOOLEAN NOT NULL DEFAULT FALSE,
            status VARCHAR(12) NOT NULL DEFAULT 'in_progress',
            sync_status VARCHAR(24) NULL,
            question_order JSON NULL,
            option_order JSON NULL,
            retake_granted BOOLEAN NOT NULL DEFAULT FALSE
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_school_exam_attempts_exam ON school_exam_attempts (exam_id)",
        "CREATE INDEX IF NOT EXISTS ix_school_exam_attempts_student ON school_exam_attempts (student_id)",
        """
        CREATE TABLE IF NOT EXISTS school_exam_answers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            attempt_id UUID NOT NULL REFERENCES school_exam_attempts(id),
            exam_question_id UUID NOT NULL REFERENCES school_exam_questions(id),
            student_id UUID NOT NULL REFERENCES users(id),
            answer VARCHAR(50) NULL,
            is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
            synced_offline BOOLEAN NOT NULL DEFAULT FALSE
        )
        """,
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_school_exam_answers ON school_exam_answers (attempt_id, exam_question_id)",
        """
        CREATE TABLE IF NOT EXISTS school_exam_downloads (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            exam_id UUID NOT NULL REFERENCES school_exams(id),
            student_id UUID NOT NULL REFERENCES users(id),
            checksum VARCHAR(80) NULL,
            verified BOOLEAN NOT NULL DEFAULT TRUE,
            question_order JSON NULL,
            option_order JSON NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_school_exam_downloads_exam ON school_exam_downloads (exam_id)",
        "CREATE INDEX IF NOT EXISTS ix_school_exam_downloads_student ON school_exam_downloads (student_id)",
        """
        CREATE TABLE IF NOT EXISTS school_exam_sync_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            exam_id UUID NOT NULL REFERENCES school_exams(id),
            attempt_id UUID NULL REFERENCES school_exam_attempts(id),
            student_id UUID NOT NULL REFERENCES users(id),
            event VARCHAR(32) NOT NULL,
            channel VARCHAR(16) NOT NULL DEFAULT 'online',
            detail JSON NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_school_exam_sync_logs_exam ON school_exam_sync_logs (exam_id)",
        "CREATE INDEX IF NOT EXISTS ix_school_exam_sync_logs_student ON school_exam_sync_logs (student_id)",
        """
        CREATE TABLE IF NOT EXISTS school_exam_results (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            school_id UUID NOT NULL REFERENCES school_campuses(id),
            exam_id UUID NOT NULL REFERENCES school_exams(id),
            student_id UUID NOT NULL REFERENCES users(id),
            attempt_id UUID NULL REFERENCES school_exam_attempts(id),
            total_questions INTEGER NOT NULL DEFAULT 0,
            questions_answered INTEGER NOT NULL DEFAULT 0,
            correct_count INTEGER NOT NULL DEFAULT 0,
            wrong_count INTEGER NOT NULL DEFAULT 0,
            raw_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            raw_total DOUBLE PRECISION NOT NULL DEFAULT 0,
            total_mark INTEGER NOT NULL DEFAULT 100,
            final_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            percentage DOUBLE PRECISION NOT NULL DEFAULT 0,
            grade VARCHAR(5) NULL,
            is_published BOOLEAN NOT NULL DEFAULT FALSE,
            published_at TIMESTAMP NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
        """,
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_school_exam_results ON school_exam_results (exam_id, student_id)",
    )
    for stmt in stmts:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("school CBT schema skipped: %.100s (%s)", stmt, exc)


async def ensure_live_class_schema() -> None:
    """Columns/tables required for Join live + Access codes (avoids Internal Server Error)."""
    stmts = (
        "ALTER TABLE class_attendances ADD COLUMN IF NOT EXISTS is_removed BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE class_attendances ADD COLUMN IF NOT EXISTS is_muted BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE class_attendances ADD COLUMN IF NOT EXISTS left_at TIMESTAMP NULL",
        """
        CREATE TABLE IF NOT EXISTS live_class_access_codes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id UUID NOT NULL REFERENCES users(id),
            live_class_id UUID NOT NULL REFERENCES live_classes(id),
            join_code VARCHAR(32) NOT NULL,
            title VARCHAR(255) NOT NULL,
            subject VARCHAR(120) NULL,
            teacher_name VARCHAR(200) NULL,
            visibility VARCHAR(32) NOT NULL DEFAULT 'public',
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            is_used BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE (student_id, live_class_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_live_class_access_codes_student_id ON live_class_access_codes (student_id)",
        "CREATE INDEX IF NOT EXISTS ix_live_class_access_codes_live_class_id ON live_class_access_codes (live_class_id)",
        "CREATE INDEX IF NOT EXISTS ix_live_class_access_codes_join_code ON live_class_access_codes (join_code)",
    )
    for stmt in stmts:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("live class schema skipped: %s (%s)", stmt, exc)


async def initialize_database() -> bool:
    """Create tables, run migrations, and seed. Returns False if DATABASE_URL is invalid."""
    global _db_initialized
    try:
        await _run_schema_migrations()
    except (socket.gaierror, OSError, ConnectionRefusedError) as exc:
        logger.error(
            "DATABASE_URL host %r cannot be resolved (%s). "
            "On Render: create or link a PostgreSQL database and set DATABASE_URL "
            "to its Internal Database URL, then redeploy.",
            settings.database_host,
            exc,
        )
        return False
    except Exception as exc:
        logger.error(
            "Database schema migration failed for host %r: %s",
            settings.database_host,
            exc,
        )
    try:
        await ensure_school_campus_schema()
    except Exception as exc:
        logger.warning("ensure_school_campus_schema: %s", exc)
    try:
        await ensure_school_plans_schema()
    except Exception as exc:
        logger.warning("ensure_school_plans_schema: %s", exc)
    try:
        await ensure_ai_token_schema()
    except Exception as exc:
        logger.warning("ensure_ai_token_schema: %s", exc)
    try:
        await ensure_cbt_coupon_tables()
    except Exception as exc:
        logger.warning("ensure_cbt_coupon_tables: %s", exc)
    try:
        await ensure_videos_table()
    except Exception as exc:
        logger.warning("ensure_videos_table: %s", exc)
    try:
        await ensure_study_coupon_tables()
    except Exception as exc:
        logger.warning("ensure_study_coupon_tables: %s", exc)
    try:
        await ensure_community_posts_columns()
    except Exception as exc:
        logger.warning("ensure_community_posts_columns: %s", exc)
    try:
        await ensure_live_class_schema()
    except Exception as exc:
        logger.warning("ensure_live_class_schema: %s", exc)
    try:
        await ensure_school_cbt_schema()
    except Exception as exc:
        logger.warning("ensure_school_cbt_schema: %s", exc)
    try:
        from app.services.cbt_access import ensure_student_entitlements_schema
        await ensure_student_entitlements_schema()
    except Exception as exc:
        logger.warning("ensure_student_entitlements_schema: %s", exc)
    try:
        from app.services.cbt_engine import ensure_cbt_settings_schema
        await ensure_cbt_settings_schema()
    except Exception as exc:
        logger.warning("ensure_cbt_settings_schema: %s", exc)
    # One-time self-heal: re-label question-bank exams whose title names a
    # different board than their exam_type (made WAEC/NECO serve JAMB questions).
    try:
        async with AsyncSessionLocal() as _db:
            from app.services.cbt_engine import relabel_mislabeled_bank_exams
            fixed = await relabel_mislabeled_bank_exams(_db)
            if fixed:
                logger.info("relabel_mislabeled_bank_exams: fixed %s exams", fixed)
    except Exception as exc:
        logger.warning("relabel_mislabeled_bank_exams: %s", exc)
    # Self-healing: guarantee every model column exists (last line of defence).
    try:
        await ensure_model_columns()
    except Exception as exc:
        logger.warning("ensure_model_columns: %s", exc)
    try:
        await ensure_postgres_enums()
        _db_initialized = True
    except Exception as exc:
        logger.error(
            "Database startup failed for host %r: %s",
            settings.database_host,
            exc,
        )
        return False
    try:
        async with AsyncSessionLocal() as db:
            await seed_database(db)
            try:
                from app.core.subject_catalog_seed import seed_subject_catalogue

                counts = await seed_subject_catalogue(db)
                await db.commit()
                logger.info("Subject catalogue seeded: %s", counts)
            except Exception as exc:
                await db.rollback()
                logger.warning("Subject catalogue seed skipped: %s", exc)
    except Exception as exc:
        logger.error("Database seed failed (login can still work): %s", exc)
    logger.info("Database ready (host=%s)", settings.database_host)
    return True
