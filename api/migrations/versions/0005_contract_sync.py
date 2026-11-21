"""sync with main's DATABASE_SCHEMA: management role, vendor registration, quotation rounds, per-item selection, WO approval

Revision ID: 0005
Revises: 0004
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0005'
down_revision: str | Sequence[str] | None = '0004'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint('users_username_key', 'users', type_='unique')
    op.drop_column('users', 'username')
    op.drop_column('vendors', 'contact_email')
    op.add_column('vendors', sa.Column('registered', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('vendors', sa.Column('registration_checklist', postgresql.JSONB(), server_default='[]', nullable=False))
    op.add_column('quotations', sa.Column('round', sa.Integer(), server_default='1', nullable=False))
    op.drop_constraint('quotations_rfq_id_vendor_id_key', 'quotations', type_='unique')
    op.create_unique_constraint('quotations_rfq_id_vendor_id_round_key', 'quotations', ['rfq_id', 'vendor_id', 'round'])
    op.drop_column('evaluations', 'selected_vendor_id')
    op.add_column('evaluations', sa.Column('item_selections', postgresql.JSONB(), nullable=True))
    op.add_column('work_orders', sa.Column('created_by', sa.UUID(), sa.ForeignKey('users.id'), nullable=True))
    op.add_column('work_orders', sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('work_orders', sa.Column('approval_note', sa.Text(), nullable=True))
    op.alter_column('work_orders', 'approved_by', nullable=True)


def downgrade() -> None:
    op.drop_column('work_orders', 'approval_note')
    op.drop_column('work_orders', 'submitted_at')
    op.drop_column('work_orders', 'created_by')
    op.drop_column('evaluations', 'item_selections')
    op.add_column('evaluations', sa.Column('selected_vendor_id', sa.UUID(), sa.ForeignKey('vendors.id'), nullable=True))
    op.drop_constraint('quotations_rfq_id_vendor_id_round_key', 'quotations', type_='unique')
    op.create_unique_constraint('quotations_rfq_id_vendor_id_key', 'quotations', ['rfq_id', 'vendor_id'])
    op.drop_column('quotations', 'round')
    op.drop_column('vendors', 'registration_checklist')
    op.drop_column('vendors', 'registered')
    op.add_column('vendors', sa.Column('contact_email', sa.String(), nullable=True))
    op.add_column('users', sa.Column('username', sa.String(), server_default='', nullable=False))
    op.create_unique_constraint('users_username_key', 'users', ['username'])
