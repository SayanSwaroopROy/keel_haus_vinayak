"""drop users.password_hash (persona sessions, no passwords)

Revision ID: 0004
Revises: 0003
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0004'
down_revision: str | Sequence[str] | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column('users', 'password_hash')


def downgrade() -> None:
    op.add_column('users', sa.Column('password_hash', sa.String(), server_default='', nullable=False))
