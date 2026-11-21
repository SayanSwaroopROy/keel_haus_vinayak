"""All tables from docs/DATABASE_SCHEMA.md. Status columns are text, validated by app/transitions.py."""

import os
import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

EMBED_DIM = int(os.environ.get("OPENROUTER_EMBEDDING_DIMENSIONS", "1024"))


class Base(DeclarativeBase):
    pass


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))


def fk(table: str, nullable: bool = False) -> Mapped[Any]:
    return mapped_column(UUID(as_uuid=True), ForeignKey(f"{table}.id"), nullable=nullable)


def ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


Text_ = Text
Arr = ARRAY(Text)


class Project(Base):
    __tablename__ = "projects"
    id = pk()
    code: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    is_dummy: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at = ts()


class Vendor(Base):
    __tablename__ = "vendors"
    id = pk()
    name: Mapped[str] = mapped_column(String, unique=True)
    categories: Mapped[list[str]] = mapped_column(Arr, default=list)
    category_source: Mapped[str] = mapped_column(String, default="inferred")  # inferred | manual
    brands: Mapped[list[str]] = mapped_column(Arr, default=list)
    status: Mapped[str] = mapped_column(String, default="active")
    contact_email: Mapped[str | None] = mapped_column(String)  # always RFQ_TEST_INBOX
    is_dummy: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at = ts()
    __table_args__ = (Index("ix_vendors_categories", "categories", postgresql_using="gin"),)


class User(Base):
    __tablename__ = "users"
    id = pk()
    username: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)  # site_engineer | hod | vendor
    vendor_id: Mapped[uuid.UUID | None] = fk("vendors", nullable=True)
    project_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    created_at = ts()
    __table_args__ = (CheckConstraint("role in ('site_engineer','hod','vendor')", name="ck_users_role"),)


class VendorPerformance(Base):
    __tablename__ = "vendor_performance"
    id = pk()
    vendor_id = fk("vendors")
    project_id = fk("projects")
    quality: Mapped[int] = mapped_column(SmallInteger)
    delivery: Mapped[int] = mapped_column(SmallInteger)
    disputes: Mapped[int] = mapped_column(SmallInteger)
    note: Mapped[str | None] = mapped_column(Text)
    is_dummy: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at = ts()


class ItemCode(Base):
    __tablename__ = "item_codes"
    id = pk()
    code: Mapped[str] = mapped_column(String, index=True)  # NOT unique: ERP list has real duplicates
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String)
    embedding: Mapped[Any] = mapped_column(Vector(EMBED_DIM), nullable=True)
    created_at = ts()


class SourceFile(Base):
    __tablename__ = "source_files"
    id = pk()
    kind: Mapped[str] = mapped_column(String)
    mime: Mapped[str | None] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String)
    page_count: Mapped[int | None] = mapped_column(Integer)
    uploaded_by = fk("users", nullable=True)
    created_at = ts()


class Requisition(Base):
    __tablename__ = "requisitions"
    id = pk()
    project_id = fk("projects")
    raised_by = fk("users")
    input_type: Mapped[str] = mapped_column(String)
    original_lang: Mapped[str | None] = mapped_column(String)
    source_file_id = fk("source_files", nullable=True)
    status: Mapped[str] = mapped_column(String, default="DRAFT", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    created_at = ts()


class RequisitionItem(Base):
    __tablename__ = "requisition_items"
    id = pk()
    requisition_id = fk("requisitions")
    kind: Mapped[str] = mapped_column(String, default="work")  # work | material
    wo_code: Mapped[str | None] = mapped_column(String)
    item_code: Mapped[str | None] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String)
    spec: Mapped[str | None] = mapped_column(Text)
    brand: Mapped[str | None] = mapped_column(String)
    uom: Mapped[str | None] = mapped_column(String)
    quantity: Mapped[float | None] = mapped_column(Numeric)
    original_qty: Mapped[float | None] = mapped_column(Numeric)
    original_uom: Mapped[str | None] = mapped_column(String)
    extra_pct: Mapped[float | None] = mapped_column(Numeric)
    location_breakdown: Mapped[Any] = mapped_column(JSONB, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Numeric)
    uncertain_fields: Mapped[list[str]] = mapped_column(Arr, default=list)
    clarification_question: Mapped[str | None] = mapped_column(Text)
    source_ref: Mapped[Any] = mapped_column(JSONB, nullable=True)
    new_code_suggestion: Mapped[str | None] = mapped_column(String)
    duplicate_of: Mapped[Any] = mapped_column(JSONB, nullable=True)
    created_at = ts()


class RequisitionRevision(Base):
    __tablename__ = "requisition_revisions"
    id = pk()
    requisition_id = fk("requisitions")
    version: Mapped[int] = mapped_column(Integer)
    actor: Mapped[str] = mapped_column(String)  # ai | user
    change_note: Mapped[str | None] = mapped_column(Text)
    items: Mapped[Any] = mapped_column(JSONB)
    created_at = ts()
    __table_args__ = (UniqueConstraint("requisition_id", "version"),)


class IngestionJob(Base):
    __tablename__ = "ingestion_jobs"
    id = pk()
    source_file_id = fk("source_files", nullable=True)
    requisition_id = fk("requisitions", nullable=True)
    quotation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String, default="QUEUED")
    step: Mapped[str] = mapped_column(String, default="validate")
    detected_lang: Mapped[str | None] = mapped_column(String)
    raw_text: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    created_by = fk("users", nullable=True)
    created_at = ts()


class InventoryItem(Base):
    __tablename__ = "inventory_items"
    id = pk()
    project_id = fk("projects")
    material: Mapped[str] = mapped_column(String)
    uom: Mapped[str] = mapped_column(String)
    physical: Mapped[float] = mapped_column(Numeric, default=0)
    reserved: Mapped[float] = mapped_column(Numeric, default=0)
    is_dummy: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at = ts()
    __table_args__ = (
        UniqueConstraint("project_id", "material", "uom"),
        CheckConstraint("physical >= reserved AND reserved >= 0", name="ck_inventory_qty"),
    )


class InventoryReservation(Base):
    __tablename__ = "inventory_reservations"
    id = pk()
    inventory_item_id = fk("inventory_items")
    requisition_item_id = fk("requisition_items")
    qty: Mapped[float] = mapped_column(Numeric)
    created_at = ts()


class Rfq(Base):
    __tablename__ = "rfqs"
    id = pk()
    requisition_id = fk("requisitions")
    category: Mapped[str] = mapped_column(String)
    terms: Mapped[list[str]] = mapped_column(Arr, default=list)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String, default="DRAFT")
    created_at = ts()


class RfqItem(Base):
    __tablename__ = "rfq_items"
    id = pk()
    rfq_id = fk("rfqs")
    req_item_id = fk("requisition_items")
    description: Mapped[str] = mapped_column(Text)
    spec: Mapped[str | None] = mapped_column(Text)
    brand: Mapped[str | None] = mapped_column(String)
    uom: Mapped[str | None] = mapped_column(String)
    quantity: Mapped[float | None] = mapped_column(Numeric)
    spec_version: Mapped[int] = mapped_column(Integer, default=1)
    prev_spec: Mapped[Any] = mapped_column(JSONB, nullable=True)
    created_at = ts()


class RfqVendor(Base):
    __tablename__ = "rfq_vendors"
    id = pk()
    rfq_id = fk("rfqs")
    vendor_id = fk("vendors")
    status: Mapped[str] = mapped_column(String, default="RFQ_SENT")
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at = ts()
    __table_args__ = (UniqueConstraint("rfq_id", "vendor_id"),)


class Conversation(Base):
    __tablename__ = "conversations"
    id = pk()
    rfq_id = fk("rfqs")
    vendor_id = fk("vendors")
    status: Mapped[str] = mapped_column(String, default="open")
    created_at = ts()
    __table_args__ = (UniqueConstraint("rfq_id", "vendor_id"),)


class Message(Base):
    __tablename__ = "messages"
    id = pk()
    conversation_id = fk("conversations")
    sender_id = fk("users")
    sender_role: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String, default="text")
    text: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str | None] = mapped_column(Text)
    audio_file_id = fk("source_files", nullable=True)
    rfq_item_id = fk("rfq_items", nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at = ts()
    __table_args__ = (Index("ix_messages_conv_created", "conversation_id", "created_at"),)


class AlternativeProposal(Base):
    __tablename__ = "alternative_proposals"
    id = pk()
    rfq_item_id = fk("rfq_items")
    vendor_id = fk("vendors")
    original_spec: Mapped[str | None] = mapped_column(Text)
    proposed_spec: Mapped[str] = mapped_column(Text)
    proposed_brand: Mapped[str | None] = mapped_column(String)
    explanation: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="PROPOSED")
    decided_by = fk("users", nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
    created_at = ts()


class Quotation(Base):
    __tablename__ = "quotations"
    id = pk()
    rfq_id = fk("rfqs")
    vendor_id = fk("vendors")
    source: Mapped[str] = mapped_column(String)  # app_form | uploaded_doc
    source_file_id = fk("source_files", nullable=True)
    status: Mapped[str] = mapped_column(String, default="SUBMITTED")
    quote_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    validity_days: Mapped[int | None] = mapped_column(Integer)
    gst_pct: Mapped[float | None] = mapped_column(Numeric)
    gst_included: Mapped[bool | None] = mapped_column(Boolean)
    freight: Mapped[float | None] = mapped_column(Numeric)
    payment_terms: Mapped[str | None] = mapped_column(Text)
    advance_pct: Mapped[float | None] = mapped_column(Numeric)
    start_days: Mapped[int | None] = mapped_column(Integer)
    warranty: Mapped[str | None] = mapped_column(Text)
    escalation_clause: Mapped[str | None] = mapped_column(Text)
    brands: Mapped[list[str]] = mapped_column(Arr, default=list)
    confidence: Mapped[float | None] = mapped_column(Numeric)
    flags: Mapped[list[str]] = mapped_column(Arr, default=list)
    remarks: Mapped[str | None] = mapped_column(Text)
    extracted: Mapped[Any] = mapped_column(JSONB, nullable=True)
    created_at = ts()
    __table_args__ = (UniqueConstraint("rfq_id", "vendor_id"),)


class QuotationItem(Base):
    __tablename__ = "quotation_items"
    id = pk()
    quotation_id = fk("quotations")
    rfq_item_id = fk("rfq_items", nullable=True)
    description: Mapped[str] = mapped_column(Text)
    uom_quoted: Mapped[str | None] = mapped_column(String)
    qty_quoted: Mapped[float | None] = mapped_column(Numeric)
    rate: Mapped[float | None] = mapped_column(Numeric)
    amount: Mapped[float | None] = mapped_column(Numeric)
    rate_in_rfq_uom: Mapped[float | None] = mapped_column(Numeric)
    confidence: Mapped[float | None] = mapped_column(Numeric)
    raw: Mapped[str | None] = mapped_column(Text)
    created_at = ts()


class Evaluation(Base):
    __tablename__ = "evaluations"
    id = pk()
    rfq_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("rfqs.id"), unique=True)
    weights: Mapped[Any] = mapped_column(JSONB)
    rows: Mapped[Any] = mapped_column(JSONB)
    recommendation: Mapped[Any] = mapped_column(JSONB, nullable=True)
    selected_vendor_id = fk("vendors", nullable=True)
    hod_note: Mapped[str | None] = mapped_column(Text)
    created_at = ts()


class WorkOrder(Base):
    __tablename__ = "work_orders"
    id = pk()
    wo_number: Mapped[str] = mapped_column(String, unique=True)
    requisition_id = fk("requisitions")
    rfq_id = fk("rfqs")
    vendor_id = fk("vendors")
    items: Mapped[Any] = mapped_column(JSONB)
    subtotal: Mapped[float] = mapped_column(Numeric)
    gst: Mapped[float] = mapped_column(Numeric)
    freight: Mapped[float] = mapped_column(Numeric, default=0)
    total: Mapped[float] = mapped_column(Numeric)
    terms: Mapped[list[str]] = mapped_column(Arr, default=list)
    approved_by = fk("users")
    status: Mapped[str] = mapped_column(String, default="GENERATED")
    created_at = ts()


class Notification(Base):
    __tablename__ = "notifications"
    id = pk()
    user_id = fk("users")
    type: Mapped[str] = mapped_column(String)
    ref_type: Mapped[str | None] = mapped_column(String)
    ref_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    title: Mapped[str] = mapped_column(String)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at = ts()
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read_at"),)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id = pk()
    entity: Mapped[str] = mapped_column(String)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    from_status: Mapped[str | None] = mapped_column(String)
    to_status: Mapped[str | None] = mapped_column(String)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    payload: Mapped[Any] = mapped_column(JSONB, nullable=True)
    created_at = ts()
