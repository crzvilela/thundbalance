"""The shape of what the API answers to clients, the public, the inbox and the trainers.

Every model here lists the fields the site really uses. FastAPI filters the answer through it (`response_model=`): a field that is
not listed here NEVER leaves the server, even if a query later selects one more column or a dict gains a key by mistake. That is the
safety net; the routes still build their dicts field by field, as before.

A new field a page needs: add it here AND in the route. test_response_leaks.py walks the routes with data full of recognisable values
and fails if an answer carries a key that must never leave the server (uids, tokens, Google ids, audit fields...) or anything that
belongs to another client.

Types are loose on purpose (`Any` for dates and numbers that the routes already format): the model decides WHICH fields go out, not
how they are written.
"""
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Out(BaseModel):
    model_config = ConfigDict(extra="ignore")          # anything not declared is dropped from the answer


# ----------------------------------------------------------------------------------------------------------------- the client
class UserLookupOut(Out):
    message: str | None = None
    id: int | None = None
    nome: str | None = None
    email: str | None = None
    plano: str | None = None
    must_change_password: bool | None = None


class ProfileOut(Out):
    id: int
    nome: str | None = None
    email: str | None = None
    foto: str | None = None
    telefone: str | None = None
    codigo_pais: str | None = None
    cidade: str | None = None
    morada: str | None = None
    cep: str | None = None
    plano: str | None = None
    tax_id_type: str | None = None
    tax_id: str | None = None
    country: str | None = None


class TrialOut(Out):
    id: int
    status: str | None = None
    session_date: Any = None
    session_time: Any = None
    goal: str | None = None
    experience: str | None = None
    trainer: str | None = None
    created_at: str | None = None


class TrialEnvelopeOut(Out):
    trial: TrialOut | None = None


class WorkflowRequestOut(Out):
    id: int
    status: str | None = None
    reason: str | None = None
    package: str | None = None
    sessions_per_week: Any = None
    preferred_days: Any = None
    preferred_time: Any = None
    trainer: str | None = None
    start_date: Any = None
    session_type: str | None = None
    second_person_name: str | None = None
    created_at: str | None = None
    schedule: Any = None


class WorkflowPlanSummaryOut(Out):
    id: Any = None
    name: str | None = None
    trainer: str | None = None
    end_date: str | None = None


class WorkflowPackOut(Out):
    id: Any = None
    name: str | None = None
    trainer: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    sessions_per_week: Any = None
    done: Any = None
    remaining: Any = None
    total: Any = None
    session_type: str | None = None
    second_person_name: str | None = None
    price_per_session: Any = None


class WorkflowSessionOut(Out):
    id: int
    date: str
    time: str
    trainer: str | None = None
    status: str | None = None
    number: str | None = None
    pack_id: Any = None


class WorkflowOut(Out):
    state: str
    request: WorkflowRequestOut | None = None
    plan: WorkflowPlanSummaryOut | None = None
    plans: list[WorkflowPackOut] = []
    sessions: list[WorkflowSessionOut] = []
    sessions_remaining: int = 0


class RescheduleRequestOut(Out):
    id: int
    session_id: int
    status: str
    original_date: str | None = None
    original_time: str | None = None
    requested_date: str | None = None
    requested_time: str | None = None
    client_note: str | None = None
    admin_note: str | None = None          # the studio's answer, written FOR the client (it is also in the e-mail): not an internal note
    counter_date: str | None = None
    counter_time: str | None = None
    counter_deadline: Any = None
    created_at: str | None = None


class RescheduleListOut(Out):
    items: list[RescheduleRequestOut] = []
    max_per_session: Any = None
    notice_hours: Any = None
    note_max: Any = None


class FeaturesOut(Out):
    client_calendar: bool
    reschedule_min_hours_before: Any = None


# ------------------------------------------------------------------------------------------------------------------- the inbox
class InboxItemOut(Out):
    id: Any
    kind: str | None = None
    type: str | None = None
    title: str | None = None
    body: str | None = None
    date: Any = None
    read: bool = False
    archived: bool = False
    can_archive: bool = False
    actions: list[Any] = []


class InboxCountsOut(Out):
    inbox: int = 0
    unread: int = 0
    archived: int = 0


class InboxOut(Out):
    items: list[InboxItemOut] = []
    total: int = 0
    page: int = 1
    pages: int = 1
    unread: int = 0
    counts: InboxCountsOut = InboxCountsOut()


class UnreadOut(Out):
    unread: int = 0


# ----------------------------------------------------------------------------------------------------------------- the trainers
class RolesOut(Out):
    is_admin: bool = False
    is_trainer: bool = False
    trainer_id: int | None = None
    trainer_name: str | None = None
    trainer_color: str | None = None


class TrainerSummaryOut(Out):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    period: str | None = None
    # "from" is a Python keyword: the field is called `from_` and goes out (and comes in) as "from"
    from_: Any = Field(default=None, alias="from")
    to: Any = None
    sessions_booked: Any = None
    sessions_completed: Any = None
    sessions_cancelled: Any = None
    sessions_rescheduled: Any = None
    trial_sessions: Any = None
    distinct_clients: Any = None
    hours_given: Any = None
    free_hours: Any = None
    upcoming_7_days: Any = None
    busiest_hours: Any = None
    busiest_weekdays: Any = None


class TrainerSessionOut(Out):
    session_id: Any = None
    date: Any = None
    time: Any = None
    status: str | None = None
    session_number: Any = None
    client_display_name: str | None = None
    pack_name: str | None = None
    is_trial: bool = False


class FreeSlotOut(Out):
    date: Any = None
    time: Any = None


# ------------------------------------------------------------------------------------------------------------------- the public
class TrainerChoiceOut(Out):
    id: int
    name: str


class VideoOut(Out):
    id: int
    title: str | None = None
    description: str | None = None
    video_source: str | None = None
    video_url: str | None = None
    display_order: Any = None


class ChallengeOut(Out):
    id: str
    salt: str
    challenge: str
    max: int
    iat: int
    exp: int
    sig: str
    algorithm: str = "SHA-256"


class TrialConfirmationOut(Out):
    state: str
    first_name: str | None = None
    date: str | None = None
    time: str | None = None
    outcome: str | None = None


class RescheduleResponseOut(Out):
    state: str | None = None
    first_name: str | None = None
    session_date: Any = None
    session_time: Any = None
    counter_date: Any = None
    counter_time: Any = None
    outcome: str | None = None
