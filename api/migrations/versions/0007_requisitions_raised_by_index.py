"""index requisitions(raised_by) for engineer-scoped lists

Revision ID: 0007
Revises: 0006
"""
from alembic import op

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index('ix_requisitions_raised_by', 'requisitions', ['raised_by'])


def downgrade() -> None:
    op.drop_index('ix_requisitions_raised_by', table_name='requisitions')
