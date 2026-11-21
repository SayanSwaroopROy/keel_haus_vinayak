"""ingestion jobs context

Revision ID: 0002
Revises: 0001
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ingestion_jobs", sa.Column("project_id", sa.UUID(), nullable=True))
    op.add_column("ingestion_jobs", sa.Column("input_type", sa.String(), nullable=True))
    op.add_column("ingestion_jobs", sa.Column("lang_hint", sa.String(), nullable=True))
    op.create_foreign_key("fk_ingestion_jobs_project", "ingestion_jobs", "projects", ["project_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint("fk_ingestion_jobs_project", "ingestion_jobs", type_="foreignkey")
    op.drop_column("ingestion_jobs", "lang_hint")
    op.drop_column("ingestion_jobs", "input_type")
    op.drop_column("ingestion_jobs", "project_id")
