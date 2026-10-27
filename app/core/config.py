from pydantic import field_validator
from pydantic_settings import BaseSettings
from typing import List
from urllib.parse import urlparse


def normalize_database_url(url: str) -> str:
    """Render provides postgresql:// — SQLAlchemy async needs postgresql+asyncpg://."""
    if not url:
        return url
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]
    return url


class Settings(BaseSettings):
    APP_NAME: str = "Scholaxia"
    DEBUG: bool = False
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    APPLE_CLIENT_ID: str = ""
    APPLE_TEAM_ID: str = ""
    APPLE_KEY_ID: str = ""
    APPLE_PRIVATE_KEY: str = ""

    # Cloudinary
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # Mobile app version gating. Bump these each time you publish to the store
    # so older installs get an in-app "update available" prompt.
    APP_LATEST_VERSION: str = "1.0.0"
    APP_LATEST_BUILD: int = 1  # must be > client build to prompt an update
    APP_MIN_SUPPORTED_BUILD: int = 1  # builds below this are force-updated
    APP_UPDATE_ANDROID_URL: str = (
        "https://play.google.com/store/apps/details?id=com.scholaxia.scholaxia"
    )
    APP_UPDATE_IOS_URL: str = ""
    APP_UPDATE_MESSAGE: str = (
        "A new version of Scholaxia is available with improvements and new features."
    )
    # Desktop app (Electron) update support — the desktop checks /app/version
    # and shows a download banner when its version is older. Set this to the
    # public download link for the newest Scholaxia-Student-Setup installer.
    APP_LATEST_DESKTOP_VERSION: str = "1.0.10"
    # Serve the installer from the cPanel site's downloads/ folder (uploaded
    # with Scholaxia-Website-cPanel.zip). The 160 MB exe is too large to push
    # through GitHub, so the static-file host is the reliable download path.
    APP_DESKTOP_URL: str = (
        "https://scholaxia.com/downloads/Scholaxia-Student-Setup-1.0.10.exe"
    )
    APP_DESKTOP_UPDATE_MESSAGE: str = (
        "A new version of the Scholaxia desktop app is available. Please download "
        "and install the latest update."
    )

    # Flutterwave (live class payments)
    FLUTTERWAVE_PUBLIC_KEY: str = ""
    FLUTTERWAVE_SECRET_KEY: str = ""
    FLUTTERWAVE_SECRET_HASH: str = ""  # optional webhook hash
    LIVE_CLASS_JOIN_AMOUNT: float = 2000.0  # NGN per live class session
    # Refer & Earn — NGN credited to the affiliate for every signup through
    # their code. Payouts are manual (admin pays from the bank account).
    AFFILIATE_SIGNUP_COMMISSION: float = 200.0
    LIVE_CLASS_MONTHLY_DAYS: int = 30  # one payment unlocks all live classes for 30 days

    # Paystack (library books, CBT packages, class packages)
    PAYSTACK_PUBLIC_KEY: str = ""
    PAYSTACK_SECRET_KEY: str = ""
    # AI token packs are priced in USD; admins set the NGN conversion rate.
    AI_USD_TO_NGN: float = 1600.0
    # Optional browser redirect after Paystack checkout (left blank for mobile SDK flows)
    PAYSTACK_CALLBACK_URL: str = ""

    # Firebase — use FIREBASE_CREDENTIALS_JSON on Render (paste full JSON), or file locally
    FIREBASE_CREDENTIALS_PATH: str = "firebase-credentials.json"
    FIREBASE_CREDENTIALS_JSON: str = ""

    # Email OTP provider — "gmail" | "sendgrid" | "mailgun" | "brevo"
    # Prefer "gmail" when From is a Gmail address (better inbox delivery).
    # Prefer "sendgrid" only with an authenticated custom domain (not @gmail.com).
    EMAIL_PROVIDER: str = "sendgrid"

    # Gmail SMTP (recommended for @gmail.com senders — authenticates as real Gmail)
    # Create an App Password: Google Account → Security → 2-Step Verification → App passwords
    GMAIL_SMTP_EMAIL: str = ""
    GMAIL_SMTP_APP_PASSWORD: str = ""
    GMAIL_SMTP_NAME: str = "Scholaxia"

    # SendGrid (OTP Email) — use with a verified custom domain, not @gmail.com
    SENDGRID_API_KEY: str = ""
    SENDGRID_SENDER_EMAIL: str = ""   # must be a Verified Sender in SendGrid
    SENDGRID_SENDER_NAME: str = "Scholaxia"

    # Mailgun (OTP Email)
    MAILGUN_API_KEY: str = ""
    MAILGUN_DOMAIN: str = ""          # e.g. sandboxXXXX.mailgun.org or mg.yourdomain.com
    MAILGUN_BASE_URL: str = "https://api.mailgun.net"  # EU: https://api.eu.mailgun.net
    MAILGUN_SENDER_EMAIL: str = ""    # defaults to postmaster@<domain> if empty
    MAILGUN_SENDER_NAME: str = "Scholaxia"

    # Brevo (OTP Email — legacy fallback)
    BREVO_API_KEY: str = ""
    BREVO_SENDER_EMAIL: str = "noreply@scholaxia.com"
    BREVO_SENDER_NAME: str = "Scholaxia"
    OTP_EXPIRE_MINUTES: int = 10

    # ── AI Engine ─────────────────────────────────────────────────────────────
    # "deepseek" = DeepSeek (primary — strong + cheap)
    # "openai"   = OpenAI GPT-4o
    # "gemini"   = Google Gemini
    # "groq"   = Groq (fallback)
    # "hosted" = Self-hosted (Ollama, vLLM)
    # "local"  = HuggingFace in-process
    AI_BACKEND: str = "deepseek"
    AI_MAX_TOKENS: int = 8192   # Gemini supports up to 8192 output tokens
    AI_TEMPERATURE: float = 0.42

    # Gemini (Google AI — primary)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"

    # Groq (fallback)
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # OpenAI (GPT-4o — highest quality, paid)
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    # DeepSeek (smart + cheap)
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_MODEL: str = "deepseek-chat"
    # Reasoning model for hard math/science/exam questions (auto-routed).
    # Set DEEPSEEK_REASONER_ENABLED=false to disable and always use DEEPSEEK_MODEL.
    DEEPSEEK_REASONER_MODEL: str = "deepseek-reasoner"
    DEEPSEEK_REASONER_ENABLED: bool = True

    # Hosted inference server
    AI_HOSTED_BASE_URL: str = "http://localhost:11434"
    AI_HOSTED_MODEL_NAME: str = "scholaxia-edu"
    AI_HOSTED_API_KEY: str = ""
    AI_HOSTED_ENDPOINT_TYPE: str = "ollama"

    # Local HuggingFace
    AI_LOCAL_MODEL_NAME: str = "mistralai/Mistral-7B-Instruct-v0.3"
    AI_LOCAL_DEVICE: str = "cpu"

    # ElevenLabs (Sia Voice) — clear female tutor voice (Rachel)
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"
    ELEVENLABS_MODEL_ID: str = "eleven_multilingual_v2"

    # LiveKit (Live Classes — real-time video/audio/screen share)
    LIVEKIT_URL: str = ""  # e.g. wss://your-project.livekit.cloud
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""

    # plugNmeet Cloud (live classes — uses plugNmeet's own classroom client).
    # Server-side only: the API secret must never reach browser JavaScript.
    PLUGNMEET_URL: str = ""            # e.g. https://edge.plugnmeet.cloud
    PLUGNMEET_API_KEY: str = ""
    PLUGNMEET_API_SECRET: str = ""
    # Where plugNmeet sends everyone AFTER a meeting is ended/closed.
    # MUST point at the SAME origin the user logged into (their session lives in
    # that origin's localStorage) — a foreign origin always shows the login page
    # (that was the "end meeting → forced to login" bug). Override in .env if the
    # app is served from another domain.
    PLUGNMEET_LOGOUT_URL: str = "https://scholaxia.com/student.html"

    # Legacy Agora (unused — kept so old env vars do not break deploy)
    AGORA_APP_ID: str = ""
    AGORA_APP_CERTIFICATE: str = ""

    # ALOC past questions (questions.aloc.com.ng) — JAMB / WAEC CBT bank
    ALOC_ACCESS_TOKEN: str = ""
    ALOC_BASE_URL: str = "https://questions.aloc.com.ng"
    ALOC_DEFAULT_YEAR: str = ""  # optional, e.g. 2010 — blank = random UTME years

    # When True, sample WAEC/NECO/JAMB CBT exams are re-seeded on every startup.
    # Default False so deleted sample exams stay deleted (admin can still seed
    # manually via POST /api/v1/admin/seed-cbt).
    SEED_SAMPLE_CBT: bool = False

    ADMIN_EMAIL: str = "admin@scholaxia.com"
    # One-time setup key for bootstrapping the FIRST main admin. Empty = allowed
    # only while no admin exists. Set this in Render env to lock bootstrap down.
    ADMIN_SETUP_KEY: str = ""
    ADMIN_PASSWORD: str = "changeme"
    ADMIN_INVITE_CODE: str = "SCHOLAXIA_ADMIN_2026"

    ALLOWED_ORIGINS: List[str] = ["*"]

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        return normalize_database_url(value)

    @property
    def database_host(self) -> str:
        raw = self.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        return urlparse(raw).hostname or "(missing host)"

    class Config:
        env_file = ".env"


settings = Settings()
