"""Sharing contacts between employees: the plan of an import, who is working, and the rebalancing."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

Strategy = Literal["equal", "balance_total"]
Order = Literal["interleave", "blocks"]
State = Literal["active", "new", "inactive", "deactivated"]


class DistributionIn(BaseModel):
    """How a sheet is shared out. `equal`: everybody the same number (the remainder to whoever has the least). `balance_total`:
    whoever has the least work gets the most, until everybody has the same in total."""

    strategy: Strategy = "equal"
    order: Order = "interleave"  # interleave: everybody gets a mix of the whole sheet; blocks: one person gets the first part, the next the next
    employee_ids: list[int] | None = Field(default=None, max_length=5000)  # None: every employee who is working
    leave_unassigned: bool = False  # add the contacts without an owner


class PlanEmployee(BaseModel):
    employee_id: int
    employee_code: str
    full_name: str
    team_name: str | None
    state: State
    reason: str
    last_active_at: datetime | None
    assigned: int  # contacts they own now
    pending: int | None = None  # of those, still to be called (only worked out when the plan needs it)
    selected: bool  # chosen by the administrator (everybody, when nobody was chosen)
    receives: bool  # selected and working
    planned: int  # how many of the sheet they would get
    explicit: int = 0  # rows of the sheet that name them


class ImportPlanOut(BaseModel):
    import_id: int
    strategy: Strategy
    order: Order
    to_distribute: int
    explicit: int
    inactive_after_days: int
    working: int  # people who would receive something
    left_out: int  # selected people who are not working
    leave_unassigned: bool
    employees: list[PlanEmployee]
    warnings: list[str]
    can_confirm: bool


# ----------------------------------------------------------------------------------------------------- who is working
class EmployeeStateOut(BaseModel):
    employee_id: int
    employee_code: str
    full_name: str
    team_id: int | None
    team_name: str | None
    state: State
    reason: str
    last_active_at: datetime | None
    assigned: int
    movable: int = 0  # contacts the rebalancing could take from them (new / in progress, no callback) - only for people who are not working


class RebalanceRunOut(ORMModel):
    id: int
    kind: str
    trigger: str
    status: str
    created_by: int | None
    created_at: datetime
    finished_at: datetime | None
    planned: int
    moved: int
    details: dict | None
    error_message: str | None


class ActivityOverviewOut(BaseModel):
    inactive_after_days: int
    auto_rebalance: bool
    working: int
    not_working: int
    movable: int  # contacts waiting with people who are not working, that a rebalancing would move
    employees: list[EmployeeStateOut]
    last_run: RebalanceRunOut | None = None


class RebalanceIn(BaseModel):
    from_employee_ids: list[int] | None = Field(default=None, max_length=5000)  # None: every employee who is not working
    to_employee_ids: list[int] | None = Field(default=None, max_length=5000)  # None: every employee who is working
    strategy: Strategy = "equal"
    order: Order = "interleave"


class RebalanceSource(BaseModel):
    employee_id: int
    employee_code: str
    full_name: str
    state: State
    reason: str
    movable: int
    kept: int  # contacts of theirs that stay: a callback is promised, or the call is done


class RebalanceTarget(BaseModel):
    employee_id: int
    employee_code: str
    full_name: str
    state: State
    assigned: int  # contacts they own now
    pending: int | None = None  # of those, still to be called (only worked out when the plan needs it)
    receives: int


class RebalancePlanOut(BaseModel):
    strategy: Strategy
    order: Order
    total_movable: int
    working: int
    sources: list[RebalanceSource]
    targets: list[RebalanceTarget]
    warnings: list[str]
    can_run: bool
