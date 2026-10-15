"""Manual check of the Google Calendar connection.

Kept only so the old command still works. It no longer has an id of its own:
it runs scripts/check_calendar_config.py, which uses GOOGLE_CALENDAR_ID (the
same variable as the server), creates a test event, reads it back and deletes it.

    python google_calendar_test.py
"""
import os
import runpy

runpy.run_path(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts", "check_calendar_config.py"),
    run_name="__main__",
)
