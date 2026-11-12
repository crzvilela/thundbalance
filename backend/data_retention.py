"""How long old personal data is kept, and the daily job that removes what has passed its time (docs/DATA_RETENTION.md).

RETENTION IS OFF BY DEFAULT. Nothing below the "retention" heading runs until RETENTION_ENABLED=true:
  RETENTION_CONTACT_DAYS     contact messages older than this are deleted                              (default 365)
  RETENTION_TRIAL_DAYS       trial requests that were declined, cancelled or never answered, older than this, are deleted;
                             never the open ones (approved / confirmed) and never those of a client who exists and is not archived (default 365)
  RETENTION_EMAIL_LOG_DAYS   the e-mail log older than this is deleted                                  (default 180)

Two chores run every day whatever RETENTION_ENABLED says, because they are housekeeping and not a policy:
  - the unfinished deletions of clients (a deletion that stopped at the calendar or at Firebase) are repeated;
  - the addresses (IPs) kept by the rate limits are removed after a day.

The job runs in a background thread like the calendar reconciliation: it can never break a request, an error is logged as its TYPE only,
and only COUNTS of rows are logged (never a name, an address or a value). RETENTION_JOB=off switches the whole job off.
"""
import logging
import os
import threading
import time

import client_erasure
from database import get_connection
from safe_log import safe_error

logger = logging.getLogger("thundbalance.retention")

DAY_SECONDS = 24 * 60 * 60
FIRST_DELAY_SECONDS = 180
_run_lock = threading.Lock()
_started = False


def _env(name, default=""):
    return os.getenv(name, "").strip().strip("'\"").strip() or default


def enabled():
    """RETENTION_ENABLED: true / 1 / yes / on. Anything else (or nothing) is OFF."""
    return _env("RETENTION_ENABLED").lower() in ("true", "1", "yes", "on")


def job_enabled():
    return _env("RETENTION_JOB").lower() not in ("off", "false", "0", "no")


def days(name, default):
    """A number of days from the environment (a bad or missing value is the default; never below 1)."""
    try:
        return max(1, int(_env(name, str(default))))
    except ValueError:
        return default


def settings():
    return {
        "enabled": enabled(),
        "contact_days": days("RETENTION_CONTACT_DAYS", 365),
        "trial_days": days("RETENTION_TRIAL_DAYS", 365),
        "email_log_days": days("RETENTION_EMAIL_LOG_DAYS", 180),
    }


# ------------------------------------------------------------------------------------------------------------------ retention
def purge_contact_messages(cursor, older_than_days):
    cursor.execute("DELETE FROM contact_messages WHERE created_at < NOW() - make_interval(days => %s)", (older_than_days,))
    return cursor.rowcount


def purge_trial_sessions(cursor, older_than_days):
    """Declined, cancelled, rejected or never-answered (pending) requests past their time. An open request (approved / confirmed) and
    the requests of a client who exists and is not archived are never touched."""
    cursor.execute(
        """
        DELETE FROM trial_sessions ts
        WHERE LOWER(ts.status) IN ('declined', 'cancelled', 'rejected', 'pending')
          AND ts.created_at < NOW() - make_interval(days => %s)
          AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(ts.email) AND u.archived_at IS NULL)
        """,
        (older_than_days,),
    )
    return cursor.rowcount


def purge_email_log(cursor, older_than_days):
    cursor.execute("DELETE FROM email_log WHERE criado_em < NOW() - make_interval(days => %s)", (older_than_days,))
    return cursor.rowcount


def run_retention():
    """Applies the retention policy once. Does NOTHING (and says so) when RETENTION_ENABLED is not true. Returns the counts."""
    config = settings()
    if not config["enabled"]:
        return {"enabled": False}
    conn = get_connection()
    cursor = conn.cursor()
    try:
        counts = {"enabled": True}
        counts["contact_messages"] = purge_contact_messages(cursor, config["contact_days"])
        counts["trial_sessions"] = purge_trial_sessions(cursor, config["trial_days"])
        counts["email_log"] = purge_email_log(cursor, config["email_log_days"])
        conn.commit()
        return counts
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------------------------------------------------------ housekeeping
def purge_rate_limits():
    """The addresses kept by the rate limits are only needed for a few minutes: nothing older than a day stays."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM rate_limit_hits WHERE hit_at < NOW() - INTERVAL '1 day'")
        removed = cursor.rowcount
        conn.commit()
        return removed
    except Exception as error:  # noqa: BLE001 - the table may not exist yet
        conn.rollback()
        logger.error("op=purge_rate_limits error=%s", safe_error(error))
        return 0
    finally:
        cursor.close()
        conn.close()


def run_daily():
    """One pass of the daily job. Returns the counts (also logged: counts only)."""
    result = {"rate_limits": purge_rate_limits()}
    result["erasures"] = client_erasure.retry_pending()
    result["retention"] = run_retention()
    retention = result["retention"]
    logger.info(
        "daily job: rate_limit_rows=%d erasures_retried=%d erasures_finished=%d retention=%s contact_messages=%s trial_sessions=%s email_log=%s",
        result["rate_limits"], result["erasures"]["retried"], result["erasures"]["finished"],
        "on" if retention.get("enabled") else "off",
        retention.get("contact_messages", "-"), retention.get("trial_sessions", "-"), retention.get("email_log", "-"),
    )
    return result


def run_safely():
    """run_daily() that never raises and never runs twice at once."""
    if not _run_lock.acquire(blocking=False):
        return None
    try:
        return run_daily()
    except Exception as error:  # noqa: BLE001
        logger.error("op=run_daily error=%s", safe_error(error))
        return None
    finally:
        _run_lock.release()


def start_background():
    """A thread that runs the daily job every 24 hours while the server is awake. Safe to call twice."""
    global _started
    if not job_enabled() or _started:
        return
    _started = True

    def loop():
        time.sleep(FIRST_DELAY_SECONDS)
        while True:
            if job_enabled():
                run_safely()
            time.sleep(DAY_SECONDS)

    threading.Thread(target=loop, name="data-retention-loop", daemon=True).start()
