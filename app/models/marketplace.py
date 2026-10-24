import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text, Float, Integer
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


# Canonical category keys used by vendor forms and marketplace filters.
MARKETPLACE_CATEGORIES = (
    "books",
    "soft_copy",
    "software",
    "educational_materials",
    "phones",
    "gadgets",
    "flash_drive",
    "charger",
    "projector",
    "desktop_computer",
    "bags",
    "laptops",
    "other",
)


class MarketplaceProduct(Base):
    """Admin-posted item for the student marketplace (book to purchase)."""
    __tablename__ = "marketplace_products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="gadgets", index=True)
    price: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(10), default="NGN")
    image_url: Mapped[str] = mapped_column(String(1000), nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    is_free: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approval_status: Mapped[str] = mapped_column(String(20), default="approved")  # pending | approved | rejected
    source_role: Mapped[str] = mapped_column(String(20), default="admin")  # admin | vendor
    stock_qty: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MarketplaceBooking(Base):
    """Student interest / booking for a marketplace product."""
    __tablename__ = "marketplace_bookings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("marketplace_products.id"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True, nullable=True
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    whatsapp: Mapped[str] = mapped_column(String(40), nullable=False)
    phone: Mapped[str] = mapped_column(String(40), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending | contacted | closed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MarketplaceCartItem(Base):
    __tablename__ = "marketplace_cart_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True, nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("marketplace_products.id"), index=True, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MarketplaceOrder(Base):
    __tablename__ = "marketplace_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True, nullable=False)
    total_amount: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(10), default="NGN")
    status: Mapped[str] = mapped_column(String(30), default="pending_payment")  # pending_payment | awaiting_delivery | paid | processing | shipped | delivered | cancelled
    delivery_address: Mapped[str] = mapped_column(String(500), nullable=True)
    contact_phone: Mapped[str] = mapped_column(String(40), nullable=True)
    # Pay-after-delivery-assignment flow: the buyer sends the order, waits for the
    # vendor to assign delivery with a fee; only then is payment opened.
    delivery_fee: Mapped[float] = mapped_column(Float, default=0.0)
    delivery_assigned: Mapped[bool] = mapped_column(Boolean, default=False)
    delivery_assigned_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MarketplaceOrderItem(Base):
    __tablename__ = "marketplace_order_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("marketplace_orders.id"), index=True, nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("marketplace_products.id"), index=True, nullable=False)
    vendor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price: Mapped[float] = mapped_column(Float, default=0.0)
    tracking_status: Mapped[str] = mapped_column(String(40), default="pending")
    tracking_note: Mapped[str] = mapped_column(String(500), nullable=True)
    # Escrow: after Paystack payment, funds are held until buyer confirms delivery.
    platform_fee: Mapped[float] = mapped_column(Float, default=0.0)
    vendor_net: Mapped[float] = mapped_column(Float, default=0.0)
    escrow_status: Mapped[str] = mapped_column(String(30), default="none")  # none | held | available | withdrawn
    buyer_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    buyer_confirmed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)


class VendorWithdrawalRequest(Base):
    """Vendor payout request after buyer confirms delivery (admin pays to bank)."""
    __tablename__ = "vendor_withdrawal_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True, nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    bank_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_number: Mapped[str] = mapped_column(String(40), nullable=False)
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending | approved | rejected | paid
    admin_note: Mapped[str] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    processed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    processed_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
