"""Bulk actions of the admin panel: the SAME function that does the action on one item is called once per id.

Nothing here knows how to delete, archive or cancel anything: each endpoint (next to the single-item one it reuses) passes
`run_each` the function of the single action, so a bulk action has exactly the same side effects (Google Calendar events,
e-mails, audit rows, protections) as doing it one by one. A failure in one item never stops the others: the answer
lists, per id, `ok` or the reason it failed.

  POST /admin/<kind>/bulk   {"action": "...", "ids": [1, 2, ...], ...}   (admin only, at most 200 ids)
  -> {"total": 3, "done": 2, "failed": 1, "results": [{"id": 1, "ok": true}, {"id": 2, "ok": false, "error": "…"}, ...]}

Nothing personal goes to the log: only the action, the kind and the counts.
"""
import logging
import traceback

from fastapi import HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("thundbalance.bulk")

MAX_IDS = 200


class BulkPayload(BaseModel):
    action: str
    ids: list[int] = Field(default_factory=list)
    # clients: archive with their future sessions, and the extra confirmations of the destructive ones
    cancel_future_sessions: bool = False
    confirm_cancel: bool = False
    confirm_word: str = ""


def clean_ids(ids):
    """Unique ids in the order given. 422 when empty or above the limit."""
    seen, result = set(), []
    for item in ids or []:
        if item not in seen:
            seen.add(item)
            result.append(item)
    if not result:
        raise HTTPException(status_code=422, detail={"code": "no_ids", "message": "Choose at least one item."})
    if len(result) > MAX_IDS:
        raise HTTPException(status_code=422, detail={"code": "too_many", "message": f"At most {MAX_IDS} items at a time."})
    return result


def reason_of(error):
    """A short, safe reason for the answer (never a stack trace)."""
    if isinstance(error, HTTPException):
        detail = error.detail
        if isinstance(detail, dict):
            return str(detail.get("message") or detail.get("code") or error.status_code)[:200]
        return str(detail)[:200]
    return "error"


def run_each(kind, action, ids, handler):
    """handler(id) does the single action and raises on failure. Returns the summary described at the top of this file."""
    ids = clean_ids(ids)
    results = []
    for item in ids:
        try:
            handler(item)
            results.append({"id": item, "ok": True})
        except HTTPException as error:
            results.append({"id": item, "ok": False, "error": reason_of(error)})
        except Exception as error:  # noqa: BLE001 - one item never stops the others
            traceback.print_exc()
            logger.error("bulk %s/%s: one item failed (%s)", kind, action, type(error).__name__)
            results.append({"id": item, "ok": False, "error": "error"})
    done = sum(1 for item in results if item["ok"])
    logger.info("bulk %s/%s: %s done, %s failed", kind, action, done, len(results) - done)
    return {"total": len(results), "done": done, "failed": len(results) - done, "results": results}


def unknown_action(action):
    return HTTPException(status_code=422, detail={"code": "unknown_action", "message": f"Unknown action: {str(action)[:40]}"})
