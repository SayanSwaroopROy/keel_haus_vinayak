"""comms fixes: light unit tests, no DB rows."""

import pytest
from pydantic import ValidationError

from app.errors import ApiError
from app.models import Conversation, User
from app.routes import conversations, dashboard, vendors
from app.terms import STANDARD_COUNT


def test_checklist_rejects_string_booleans():
    with pytest.raises(ValidationError):
        vendors.RegistrationIn(checklist=[{"label": "PAN", "done": "false"}])
    assert vendors.RegistrationIn(checklist=[{"label": "PAN", "done": True}]).checklist[0].done is True


def test_dashboard_counts_only_sent_wos():
    assert set(dashboard.PLACED) == {"SENT", "ACKNOWLEDGED", "COMPLETED"} and STANDARD_COUNT == 6


class _Db:
    def __init__(self, c):
        self.c = c

    def get(self, _model, _id):
        return self.c


def _conv(status="open"):
    import uuid
    return Conversation(id=uuid.uuid4(), rfq_id=uuid.uuid4(), vendor_id=uuid.uuid4(), status=status)


def test_management_cannot_write_but_can_read():
    c = _conv()
    mgmt = User(role="management")
    assert conversations.conv_for(_Db(c), mgmt, c.id) is c
    with pytest.raises(ApiError) as e:
        conversations.conv_for(_Db(c), mgmt, c.id, write=True)
    assert e.value.status == 403


def test_closed_conversation_rejects_writes_409():
    c = _conv("closed")
    with pytest.raises(ApiError) as e:
        conversations.conv_for(_Db(c), User(role="hod"), c.id, write=True)
    assert e.value.status == 409
