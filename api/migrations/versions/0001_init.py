"""init

Revision ID: 0001
Revises: 
Create Date: 2026-11-21 11:49:11.156420

"""
from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.create_table('audit_log',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('entity', sa.String(), nullable=False),
    sa.Column('entity_id', sa.UUID(), nullable=False),
    sa.Column('from_status', sa.String(), nullable=True),
    sa.Column('to_status', sa.String(), nullable=True),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('item_codes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('category', sa.String(), nullable=True),
    sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=1024), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_item_codes_code'), 'item_codes', ['code'], unique=False)
    op.create_table('projects',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('is_dummy', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code')
    )
    op.create_table('vendors',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('categories', sa.ARRAY(sa.Text()), nullable=False),
    sa.Column('category_source', sa.String(), nullable=False),
    sa.Column('brands', sa.ARRAY(sa.Text()), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('contact_email', sa.String(), nullable=True),
    sa.Column('is_dummy', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_index('ix_vendors_categories', 'vendors', ['categories'], unique=False, postgresql_using='gin')
    op.create_table('inventory_items',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('material', sa.String(), nullable=False),
    sa.Column('uom', sa.String(), nullable=False),
    sa.Column('physical', sa.Numeric(), nullable=False),
    sa.Column('reserved', sa.Numeric(), nullable=False),
    sa.Column('is_dummy', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.CheckConstraint('physical >= reserved AND reserved >= 0', name='ck_inventory_qty'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'material', 'uom')
    )
    op.create_table('users',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('username', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('password_hash', sa.String(), nullable=False),
    sa.Column('role', sa.String(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=True),
    sa.Column('project_ids', sa.ARRAY(sa.UUID()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.CheckConstraint("role in ('site_engineer','hod','vendor')", name='ck_users_role'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('username')
    )
    op.create_table('vendor_performance',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('quality', sa.SmallInteger(), nullable=False),
    sa.Column('delivery', sa.SmallInteger(), nullable=False),
    sa.Column('disputes', sa.SmallInteger(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('is_dummy', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('notifications',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('type', sa.String(), nullable=False),
    sa.Column('ref_type', sa.String(), nullable=True),
    sa.Column('ref_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.String(), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_notifications_user_read', 'notifications', ['user_id', 'read_at'], unique=False)
    op.create_table('source_files',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('mime', sa.String(), nullable=True),
    sa.Column('filename', sa.String(), nullable=False),
    sa.Column('size', sa.BigInteger(), nullable=False),
    sa.Column('sha256', sa.String(), nullable=False),
    sa.Column('path', sa.String(), nullable=False),
    sa.Column('page_count', sa.Integer(), nullable=True),
    sa.Column('uploaded_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['uploaded_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('requisitions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('raised_by', sa.UUID(), nullable=False),
    sa.Column('input_type', sa.String(), nullable=False),
    sa.Column('original_lang', sa.String(), nullable=True),
    sa.Column('source_file_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decision_note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['raised_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['source_file_id'], ['source_files.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_requisitions_status'), 'requisitions', ['status'], unique=False)
    op.create_table('ingestion_jobs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('source_file_id', sa.UUID(), nullable=True),
    sa.Column('requisition_id', sa.UUID(), nullable=True),
    sa.Column('quotation_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('step', sa.String(), nullable=False),
    sa.Column('detected_lang', sa.String(), nullable=True),
    sa.Column('raw_text', sa.Text(), nullable=True),
    sa.Column('transcript', sa.Text(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['requisition_id'], ['requisitions.id'], ),
    sa.ForeignKeyConstraint(['source_file_id'], ['source_files.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('requisition_items',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('requisition_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('wo_code', sa.String(), nullable=True),
    sa.Column('item_code', sa.String(), nullable=True),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('category', sa.String(), nullable=True),
    sa.Column('spec', sa.Text(), nullable=True),
    sa.Column('brand', sa.String(), nullable=True),
    sa.Column('uom', sa.String(), nullable=True),
    sa.Column('quantity', sa.Numeric(), nullable=True),
    sa.Column('original_qty', sa.Numeric(), nullable=True),
    sa.Column('original_uom', sa.String(), nullable=True),
    sa.Column('extra_pct', sa.Numeric(), nullable=True),
    sa.Column('location_breakdown', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('remarks', sa.Text(), nullable=True),
    sa.Column('confidence', sa.Numeric(), nullable=True),
    sa.Column('uncertain_fields', sa.ARRAY(sa.Text()), nullable=False),
    sa.Column('clarification_question', sa.Text(), nullable=True),
    sa.Column('source_ref', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('new_code_suggestion', sa.String(), nullable=True),
    sa.Column('duplicate_of', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['requisition_id'], ['requisitions.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('requisition_revisions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('requisition_id', sa.UUID(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('actor', sa.String(), nullable=False),
    sa.Column('change_note', sa.Text(), nullable=True),
    sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['requisition_id'], ['requisitions.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('requisition_id', 'version')
    )
    op.create_table('rfqs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('requisition_id', sa.UUID(), nullable=False),
    sa.Column('category', sa.String(), nullable=False),
    sa.Column('terms', sa.ARRAY(sa.Text()), nullable=False),
    sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['requisition_id'], ['requisitions.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('conversations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rfq_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['rfq_id'], ['rfqs.id'], ),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('rfq_id', 'vendor_id')
    )
    op.create_table('evaluations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rfq_id', sa.UUID(), nullable=False),
    sa.Column('weights', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('rows', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('recommendation', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('selected_vendor_id', sa.UUID(), nullable=True),
    sa.Column('hod_note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['rfq_id'], ['rfqs.id'], ),
    sa.ForeignKeyConstraint(['selected_vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('rfq_id')
    )
    op.create_table('inventory_reservations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('inventory_item_id', sa.UUID(), nullable=False),
    sa.Column('requisition_item_id', sa.UUID(), nullable=False),
    sa.Column('qty', sa.Numeric(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['inventory_item_id'], ['inventory_items.id'], ),
    sa.ForeignKeyConstraint(['requisition_item_id'], ['requisition_items.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('quotations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rfq_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('source_file_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('quote_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('validity_days', sa.Integer(), nullable=True),
    sa.Column('gst_pct', sa.Numeric(), nullable=True),
    sa.Column('gst_included', sa.Boolean(), nullable=True),
    sa.Column('freight', sa.Numeric(), nullable=True),
    sa.Column('payment_terms', sa.Text(), nullable=True),
    sa.Column('advance_pct', sa.Numeric(), nullable=True),
    sa.Column('start_days', sa.Integer(), nullable=True),
    sa.Column('warranty', sa.Text(), nullable=True),
    sa.Column('escalation_clause', sa.Text(), nullable=True),
    sa.Column('brands', sa.ARRAY(sa.Text()), nullable=False),
    sa.Column('confidence', sa.Numeric(), nullable=True),
    sa.Column('flags', sa.ARRAY(sa.Text()), nullable=False),
    sa.Column('remarks', sa.Text(), nullable=True),
    sa.Column('extracted', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['rfq_id'], ['rfqs.id'], ),
    sa.ForeignKeyConstraint(['source_file_id'], ['source_files.id'], ),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('rfq_id', 'vendor_id')
    )
    op.create_table('rfq_items',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rfq_id', sa.UUID(), nullable=False),
    sa.Column('req_item_id', sa.UUID(), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('spec', sa.Text(), nullable=True),
    sa.Column('brand', sa.String(), nullable=True),
    sa.Column('uom', sa.String(), nullable=True),
    sa.Column('quantity', sa.Numeric(), nullable=True),
    sa.Column('spec_version', sa.Integer(), nullable=False),
    sa.Column('prev_spec', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['req_item_id'], ['requisition_items.id'], ),
    sa.ForeignKeyConstraint(['rfq_id'], ['rfqs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('rfq_vendors',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rfq_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('viewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['rfq_id'], ['rfqs.id'], ),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('rfq_id', 'vendor_id')
    )
    op.create_table('work_orders',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('wo_number', sa.String(), nullable=False),
    sa.Column('requisition_id', sa.UUID(), nullable=False),
    sa.Column('rfq_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('subtotal', sa.Numeric(), nullable=False),
    sa.Column('gst', sa.Numeric(), nullable=False),
    sa.Column('freight', sa.Numeric(), nullable=False),
    sa.Column('total', sa.Numeric(), nullable=False),
    sa.Column('terms', sa.ARRAY(sa.Text()), nullable=False),
    sa.Column('approved_by', sa.UUID(), nullable=False),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['approved_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['requisition_id'], ['requisitions.id'], ),
    sa.ForeignKeyConstraint(['rfq_id'], ['rfqs.id'], ),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('wo_number')
    )
    op.create_table('alternative_proposals',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rfq_item_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('original_spec', sa.Text(), nullable=True),
    sa.Column('proposed_spec', sa.Text(), nullable=False),
    sa.Column('proposed_brand', sa.String(), nullable=True),
    sa.Column('explanation', sa.Text(), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('decided_by', sa.UUID(), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['decided_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['rfq_item_id'], ['rfq_items.id'], ),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('messages',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('conversation_id', sa.UUID(), nullable=False),
    sa.Column('sender_id', sa.UUID(), nullable=False),
    sa.Column('sender_role', sa.String(), nullable=False),
    sa.Column('type', sa.String(), nullable=False),
    sa.Column('text', sa.Text(), nullable=True),
    sa.Column('transcript', sa.Text(), nullable=True),
    sa.Column('audio_file_id', sa.UUID(), nullable=True),
    sa.Column('rfq_item_id', sa.UUID(), nullable=True),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['audio_file_id'], ['source_files.id'], ),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ),
    sa.ForeignKeyConstraint(['rfq_item_id'], ['rfq_items.id'], ),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_messages_conv_created', 'messages', ['conversation_id', 'created_at'], unique=False)
    op.create_table('quotation_items',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('quotation_id', sa.UUID(), nullable=False),
    sa.Column('rfq_item_id', sa.UUID(), nullable=True),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('uom_quoted', sa.String(), nullable=True),
    sa.Column('qty_quoted', sa.Numeric(), nullable=True),
    sa.Column('rate', sa.Numeric(), nullable=True),
    sa.Column('amount', sa.Numeric(), nullable=True),
    sa.Column('rate_in_rfq_uom', sa.Numeric(), nullable=True),
    sa.Column('confidence', sa.Numeric(), nullable=True),
    sa.Column('raw', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['quotation_id'], ['quotations.id'], ),
    sa.ForeignKeyConstraint(['rfq_item_id'], ['rfq_items.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.execute("CREATE INDEX ix_item_codes_embedding ON item_codes USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table('quotation_items')
    op.drop_index('ix_messages_conv_created', table_name='messages')
    op.drop_table('messages')
    op.drop_table('alternative_proposals')
    op.drop_table('work_orders')
    op.drop_table('rfq_vendors')
    op.drop_table('rfq_items')
    op.drop_table('quotations')
    op.drop_table('inventory_reservations')
    op.drop_table('evaluations')
    op.drop_table('conversations')
    op.drop_table('rfqs')
    op.drop_table('requisition_revisions')
    op.drop_table('requisition_items')
    op.drop_table('ingestion_jobs')
    op.drop_index(op.f('ix_requisitions_status'), table_name='requisitions')
    op.drop_table('requisitions')
    op.drop_table('source_files')
    op.drop_index('ix_notifications_user_read', table_name='notifications')
    op.drop_table('notifications')
    op.drop_table('vendor_performance')
    op.drop_table('users')
    op.drop_table('inventory_items')
    op.drop_index('ix_vendors_categories', table_name='vendors', postgresql_using='gin')
    op.drop_table('vendors')
    op.drop_table('projects')
    op.drop_index(op.f('ix_item_codes_code'), table_name='item_codes')
    op.drop_table('item_codes')
    op.drop_table('audit_log')
    # ### end Alembic commands ###
