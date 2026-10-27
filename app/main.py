from pathlib import Path
from contextlib import asynccontextmanager

BASE_DOMAIN = "scholaxia.com"

from fastapi import FastAPI, WebSocket, Query, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401 — register models with Base.metadata
from app.core.config import settings
from app.core.database import engine, get_db
from app.core.redis import init_redis, close_redis
from app.core.startup_db import database_ready, ensure_postgres_enums, initialize_database, probe_database

ADMIN_STATIC_DIR = Path(__file__).resolve().parent.parent / "static" / "admin"
# Prefer static/app (same deploy path as working /admin); fall back to /website.
WEBSITE_STATIC_DIR = Path(__file__).resolve().parent.parent / "static" / "app"
if not WEBSITE_STATIC_DIR.is_dir():
    WEBSITE_STATIC_DIR = Path(__file__).resolve().parent.parent / "website"

from app.routers import auth, students, admin, live_class, cbt, community, ai_tutor, notifications, payments, paystack_payments
from app.routers import developer_auth, developer_keys, public_ai_api, reviews_reports, teacher_ai, library, wallet, materials
from app.routers import flutterwave_payments
from app.routers import recommendations
from app.routers import performance
from app.routers import home
from app.routers import kind
from app.routers import profiles
from app.routers import school_groups, student_groups
from app.routers import app_meta
from app.routers import marketplace
from app.routers import kid_games
from app.routers import sil
from app.routers import cbt_coupons, cbt_practice, videos, school_office, school_cbt, school_uploads, schools, external_exams
from app.routers import study_coupons
from app.routers import cbt_subject_change
from app.routers import school_core, school_results_router
from app.routers import past_questions_shop
from app.routers import ai_tokens
from app.routers import affiliate
from app.websockets.live_class_ws import live_class_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_ok = await initialize_database()
    try:
        await ensure_postgres_enums()
    except Exception:
        pass
    try:
        await init_redis()
    except Exception:
        pass
    if db_ok:
        from app.services.live_class_scheduler import start_live_class_scheduler
        start_live_class_scheduler()
    yield
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title="Scholaxia API — Powered by Sia",
    description="Scholaxia educational ecosystem. Student AI tutor: Sia (Scholaxia Intelligent Assistant)",
    version="1.0.0",
    lifespan=lifespan,
)


# Browser clients (GitHub Pages) call the API with credentials: "omit".
# Wildcard CORS is valid and avoids Origin / preflight edge-cases that surface as
# "Failed to fetch" even when /health works.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)

app.include_router(app_meta.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(students.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(live_class.router, prefix="/api/v1")
app.include_router(school_groups.router, prefix="/api/v1")
app.include_router(student_groups.router, prefix="/api/v1")
app.include_router(cbt.router, prefix="/api/v1")
app.include_router(cbt_practice.router, prefix="/api/v1")
app.include_router(cbt_subject_change.router, prefix="/api/v1")
app.include_router(community.router, prefix="/api/v1")
app.include_router(ai_tutor.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(payments.router, prefix="/api/v1")
app.include_router(paystack_payments.router, prefix="/api/v1")
app.include_router(paystack_payments.payments_router, prefix="/api/v1")
app.include_router(flutterwave_payments.router, prefix="/api/v1")
app.include_router(reviews_reports.router, prefix="/api/v1")
app.include_router(teacher_ai.router, prefix="/api/v1")
app.include_router(library.router, prefix="/api/v1")
app.include_router(past_questions_shop.router, prefix="/api/v1")
app.include_router(marketplace.router, prefix="/api/v1")
app.include_router(marketplace.admin_router, prefix="/api/v1")
app.include_router(marketplace.vendor_router, prefix="/api/v1")
app.include_router(kid_games.router, prefix="/api/v1")
app.include_router(kid_games.admin_router, prefix="/api/v1")
app.include_router(sil.router, prefix="/api/v1")
app.include_router(cbt_coupons.router, prefix="/api/v1")
app.include_router(study_coupons.router, prefix="/api/v1")
app.include_router(videos.router, prefix="/api/v1")
app.include_router(school_office.router, prefix="/api/v1")
app.include_router(school_office.portal_router, prefix="/api/v1")
app.include_router(school_cbt.router, prefix="/api/v1")
app.include_router(school_uploads.router, prefix="/api/v1")
app.include_router(external_exams.staff_router, prefix="/api/v1")
app.include_router(external_exams.public_router, prefix="/api/v1")
app.include_router(schools.router, prefix="/api/v1")
app.include_router(school_core.router, prefix="/api/v1")
app.include_router(school_results_router.router, prefix="/api/v1")
app.include_router(school_results_router.public_router, prefix="/api/v1")
app.include_router(materials.router, prefix="/api/v1")
app.include_router(wallet.router, prefix="/api/v1")
app.include_router(recommendations.router, prefix="/api/v1")
app.include_router(affiliate.router, prefix="/api/v1")
app.include_router(home.router, prefix="/api/v1")
app.include_router(kind.router, prefix="/api/v1")
app.include_router(performance.router, prefix="/api/v1")
app.include_router(developer_auth.router, prefix="/api/v1")
app.include_router(developer_keys.router, prefix="/api/v1")
app.include_router(public_ai_api.router, prefix="/api")
app.include_router(ai_tokens.router, prefix="/api/v1")
app.include_router(profiles.router, prefix="/api/v1")


@app.websocket("/ws/live-class/{room_id}")
async def live_class_ws(
    websocket: WebSocket,
    room_id: str,
    user_id: str = Query(...),
    role: str = Query(...),
    display_name: str = Query(""),
):
    await live_class_endpoint(websocket, room_id, user_id, role, display_name or "")


@app.get("/health")
async def health():
    ready = database_ready() or await probe_database()
    app_dir = WEBSITE_STATIC_DIR if WEBSITE_STATIC_DIR.is_dir() else None
    return {
        "status": "ok" if ready else "degraded",
        "app": settings.APP_NAME,
        "database": "connected" if ready else "unavailable",
        "database_host": settings.database_host,
        "admin_ui": "/admin/" if ADMIN_STATIC_DIR.is_dir() else None,
        "student_ui": "/app/student.html" if app_dir and (app_dir / "student.html").is_file() else None,
        "student_ui_dir": str(app_dir) if app_dir else None,
        "hint": (
            None
            if ready
            else "On Render: link a live PostgreSQL database and set DATABASE_URL to its Internal Database URL."
        ),
    }


@app.get("/db-check")
async def db_check(db: AsyncSession = Depends(get_db)):
    """Check DB tables — remove after debugging."""
    from sqlalchemy import text
    try:
        result = await db.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))
        tables = sorted([row[0] for row in result.fetchall()])
        return {"status": "ok", "tables": tables, "count": len(tables)}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.get("/debug-posts")
async def debug_posts(db: AsyncSession = Depends(get_db)):
    """Temporary debug endpoint — remove after diagnosis."""
    try:
        from sqlalchemy import text
        result = await db.execute(text(
            "SELECT id, visibility, is_anonymous FROM community_posts LIMIT 3"
        ))
        rows = [dict(r._mapping) for r in result.fetchall()]
        return {"status": "ok", "sample_rows": rows}
    except Exception as e:
        import traceback
        return {"status": "error", "detail": str(e), "trace": traceback.format_exc()}


@app.get("/debug-sia")
async def debug_sia(db: AsyncSession = Depends(get_db)):
    """Debug endpoint to test Sia directly."""
    try:
        from app.ai.prompt_builder import build_explain_prompt
        prompt = build_explain_prompt("photosynthesis", "Biology", "SS1", "english", "Test")
        return {"status": "prompt_ok", "length": len(prompt)}
    except Exception as e:
        import traceback
        return {"status": "error", "detail": str(e), "trace": traceback.format_exc()}


from fastapi.responses import FileResponse, RedirectResponse, HTMLResponse  # noqa: F811 — kept near routes for clarity


# ------------------------------------------------------- school subdomains ----
# Owner spec: each school gets its own private link (divine-light.scholaxia.com).
# DNS points *.scholaxia.com (and the root) at this Render service; the app then
# routes per Host header: school subdomains get the student app, the root/Render
# host gets the marketing site + /admin + /app.


def _request_host(request: Request) -> str:
    """Client-visible hostname (Render proxies keep it in the Host header)."""
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").strip().lower()
    return host.split(":")[0]


def _is_school_host(host: str) -> bool:
    return bool(host) and host.endswith(f".{BASE_DOMAIN}") and host != f"www.{BASE_DOMAIN}" and "." not in host[: -len(BASE_DOMAIN) - 1]


def _school_slug_from_host(host: str) -> str | None:
    if not _is_school_host(host):
        return None
    return host[: -len(BASE_DOMAIN) - 1]


def _static_file(name: str) -> FileResponse:
    if not WEBSITE_STATIC_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Student app folder missing on this deploy")
    target = WEBSITE_STATIC_DIR / name
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}
    return FileResponse(target, headers=no_cache)


_UNKNOWN_SCHOOL_PAGE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>School not found — Scholaxia</title>
<style>body{{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b1530;color:#eaf2ff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}}
.card{{max-width:420px;text-align:center;padding:40px 32px;border-radius:18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12)}}
h1{{font-size:1.3rem;margin:0 0 10px}}p{{opacity:.8;line-height:1.5;margin:0 0 18px}}a{{color:#ffd166;font-weight:600}}</style></head>
<body><div class="card"><h1>School not found</h1>
<p>No Scholaxia school is registered at <strong>{host}</strong> (or it is not approved yet). Double-check the link with your school.</p>
<a href="https://scholaxia.com/">Go to the main Scholaxia site →</a></div></body></html>"""


async def _school_host_response(request: Request, slug: str, full_path: str):
    from app.core.database import AsyncSessionLocal
    from app.routers.school_core import school_by_slug

    async with AsyncSessionLocal() as db:
        try:
            await school_by_slug(slug, db)
        except HTTPException:
            return HTMLResponse(_UNKNOWN_SCHOOL_PAGE.format(host=_request_host(request)), status_code=404)
        except Exception:
            # DB hiccup (e.g. waking from idle): fail open — serve the app and
            # let the page's own API calls surface any real error.
            pass

    path = (full_path or "").strip()
    if not path or path.endswith("/"):
        return _static_file("portal-app.html")
    # Student CBT examination portal: <slug>.scholaxia.com/exam or /exam/
    if path.strip("/") == "exam":
        return _static_file("exam-app.html")
    safe = Path(path)
    if ".." in safe.parts:
        raise HTTPException(status_code=400, detail="Invalid path")
    full = (WEBSITE_STATIC_DIR / safe).resolve()
    try:
        full.relative_to(WEBSITE_STATIC_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")
    if full.is_file():
        no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}
        return FileResponse(full, headers=no_cache)
    # Unknown file → the portal SPA entry (deep links stay inside the school app).
    return _static_file("portal-app.html")
    return _static_file("portal-app.html")


async def _custom_school_slug_from_host(host: str) -> str | None:
    """Find a school whose configured custom domain matches this request host."""
    from sqlalchemy import func, select
    from app.core.database import AsyncSessionLocal
    from app.models.school_campus import SchoolCampus

    normalized = host.lower().strip()
    candidates = [normalized]
    if normalized.startswith("www."):
        candidates.append(normalized[4:])
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                select(SchoolCampus.slug)
                .where(
                    func.lower(SchoolCampus.custom_domain).in_(candidates),
                    SchoolCampus.is_active.is_(True),
                )
                .limit(1)
            )
        ).scalar_one_or_none()


# Explicit routes so /app works even if StaticFiles mount order is flaky on Render.
@app.get("/app")
async def app_home_redirect():
    """Redirect /app → /app/ so relative asset paths (css/..., js/...) resolve."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/app/", status_code=307)


@app.get("/exam")
async def exam_home_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/exam/", status_code=307)


@app.get("/exam/")
async def exam_home():
    """Internal Examination portal (reg number + access code login).
    Same app school subdomains serve at <slug>.scholaxia.com/exam."""
    return _static_file("exam-app.html")


@app.get("/app/")
async def app_home():
    if not WEBSITE_STATIC_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Student app folder missing on this deploy")
    index = WEBSITE_STATIC_DIR / "index.html"
    student = WEBSITE_STATIC_DIR / "student.html"
    target = index if index.is_file() else student
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Student app not packaged on this deploy")
    no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}
    return FileResponse(target, headers=no_cache)


@app.get("/app/{asset_path:path}")
async def app_assets(asset_path: str):
    if not WEBSITE_STATIC_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Student app folder missing on this deploy")
    # Prevent path traversal
    safe = Path(asset_path)
    if ".." in safe.parts:
        raise HTTPException(status_code=400, detail="Invalid path")
    full = (WEBSITE_STATIC_DIR / safe).resolve()
    root = WEBSITE_STATIC_DIR.resolve()
    try:
        full.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")
    if not full.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}
    return FileResponse(full, headers=no_cache)


# Admin website (same host as API): https://scholaxia1.onrender.com/admin/
if ADMIN_STATIC_DIR.is_dir():
    app.mount(
        "/admin",
        StaticFiles(directory=str(ADMIN_STATIC_DIR), html=True),
        name="admin_ui",
    )


# ── Desktop installer downloads (GET /downloads/<file>.exe) ──────────────────
# The update popup links APP_DESKTOP_URL. Point that setting at this route
# (e.g. http://<host>/downloads/Scholaxia-Student-Setup-1.0.8.exe) or at any
# public host that has the installer uploaded.
import re as _re
import os as _os

_DESKTOP_INSTALLER_DIR = Path(
    _os.environ.get("DESKTOP_INSTALLER_DIR", "")
    or (Path(__file__).resolve().parent.parent / "scholaxia-desktop" / "dist")
)
_FILENAME_RE = _re.compile(r"^[\w.\-]+\.exe$")


@app.get("/downloads/{filename}", include_in_schema=False)
async def desktop_installer_download(filename: str):
    if not _FILENAME_RE.match(filename or ""):
        raise HTTPException(status_code=404, detail="Not found")
    target = (_DESKTOP_INSTALLER_DIR / filename).resolve()
    try:
        target.relative_to(_DESKTOP_INSTALLER_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Installer not found on this server")
    return FileResponse(
        target,
        media_type="application/vnd.microsoft.portable-executable",
        filename=filename,
    )


# ── Path-based school links (work TODAY on https://scholaxia1.onrender.com/school/<slug>/
# while DNS for *.scholaxia.com is being set up; the subdomain catch-all below
# keeps serving them once the wildcard exists). ──
@app.get("/school/{slug}", include_in_schema=False)
async def school_path_link(slug: str, request: Request):
    """Redirect /school/<slug> → /school/<slug>/ so relative assets resolve."""
    return RedirectResponse(url=f"/school/{slug}/", status_code=307)


@app.get("/school/{slug}/{asset_path:path}", include_in_schema=False)
async def school_path_link_assets(slug: str, asset_path: str, request: Request):
    """Serve the school-branded student SPA at /school/<slug>/… on ANY host
    (no DNS needed). Deep links to unknown files fall back to the SPA entry."""
    return await _school_host_response(request, slug.lower().strip(), asset_path)


# ── School subdomain catch-all — MUST stay last so /api, /docs, /app, /admin …
# are matched by their explicit routes first. ──
@app.get("/{full_path:path}", include_in_schema=False)
async def school_host_router(request: Request, full_path: str):
    """Final catch-all:
    - school subdomains and configured custom domains → the school portal;
    - the main hosts (scholaxia.com, www, scholaxia1.onrender.com) → the
      marketing/student site, so pointing the root domain at Render is safe;
    - anything else → 404."""
    host = _request_host(request)
    slug = _school_slug_from_host(host)
    if slug:
        return await _school_host_response(request, slug, full_path)
    main_hosts = {
        BASE_DOMAIN,
        f"www.{BASE_DOMAIN}",
        "scholaxia1.onrender.com",
        "localhost",
        "127.0.0.1",
        "testserver",
    }
    if host not in main_hosts and not host.endswith(f".{BASE_DOMAIN}"):
        custom_slug = await _custom_school_slug_from_host(host)
        if custom_slug:
            return await _school_host_response(request, custom_slug, full_path)
    if host not in main_hosts:
        raise HTTPException(status_code=404, detail="Not found")
    # Unknown API paths must be a JSON 404 — never the marketing page, or
    # clients end up parsing HTML as JSON.
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")
    if not full_path or full_path.endswith("/"):
        return _static_file("index.html")
    safe = Path(full_path)
    if ".." in safe.parts:
        raise HTTPException(status_code=400, detail="Invalid path")
    full = (WEBSITE_STATIC_DIR / safe).resolve()
    try:
        full.relative_to(WEBSITE_STATIC_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")
    if full.is_file():
        no_cache = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}
        return FileResponse(full, headers=no_cache)
    return _static_file("index.html")