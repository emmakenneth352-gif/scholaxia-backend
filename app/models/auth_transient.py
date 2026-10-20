from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AuthTransientRecord(Base):
    __tablename__ = "auth_transient_records"
    __table_args__ = (Index("ix_auth_transient_records_expires_at", "expires_at"),)

    key: Mapped[str] = mapped_column(String(320), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
