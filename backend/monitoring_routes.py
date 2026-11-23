"""The routes of the monitoring (see monitoring.py): the report of the frontend, the admin's "Estado del sistema" and /health/ready."""
import json
import re

from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

import monitoring
import web_safety
from database import get_connection

REPORT_MAX_BYTES = 2048
REPORT_LIMIT = web_safety.SharedRateLimit("client_error", 10, 600)       # 10 reports per 10 minutes per address, shared (database)
_ready_limit = web_safety.RateLimit(30, 60)                              # /health/ready: 30 per minute per address, in memory (the database may be down)
# what is never worth a report: the reload after a new version, a cancelled request, browser extensions and third-party scripts
_NOISE = ("ChunkLoadError", "AbortError", "Failed to fetch dynamically imported module", "Importing a module script failed",
          "chrome-extension", "moz-extension", "safari-extension", "ResizeObserver loop", "Script error")


class ClientErrorReport(BaseModel):
    """What the frontend may send: a minimum, nothing else (an extra field is a 422)."""
    model_config = ConfigDict(extra="forbid")
    error_type: str = Field(max_length=80)
    message: str = Field(default="", max_length=200)
    route: str = Field(default="", max_length=80)
    release: str = Field(default="", max_length=40)


class StatusPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(max_length=10)


def _is_noise(report):
    text = f"{report.error_type} {report.message}"
    return any(marker.lower() in text.lower() for marker in _NOISE)


def register_monitoring_routes(app, require_admin):
    @app.post("/client-errors/report", status_code=204)
    async def client_error_report(request: Request):
        """Public. A failure of the site on somebody's screen. Always answers 204 for what is merely ignored; nothing is ever echoed."""
        try:
            declared = int(request.headers.get("content-length", "0") or 0)
        except ValueError:
            declared = 0
        if declared > REPORT_MAX_BYTES:
            return JSONResponse(status_code=413, content={"detail": {"code": "payload_too_large", "message": "Informe demasiado grande. / Report too large."}})
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > REPORT_MAX_BYTES:                                  # a body without Content-Length counts too
                return JSONResponse(status_code=413, content={"detail": {"code": "payload_too_large", "message": "Informe demasiado grande. / Report too large."}})
            chunks.append(chunk)
        try:
            report = ClientErrorReport.model_validate(json.loads(b"".join(chunks) or b"null"))
        except (ValueError, ValidationError):
            return JSONResponse(status_code=422, content={"detail": {"code": "validation_error", "message": "Informe no válido. / Invalid report."}})
        if await _in_pool(REPORT_LIMIT.too_many, web_safety.get_client_ip(request)):
            return JSONResponse(status_code=429, headers={"Retry-After": "600"},
                                content={"detail": {"code": "rate_limited", "message": "Demasiados informes. / Too many reports."}})
        if not _is_noise(report):
            monitoring.record({"source": "frontend", "error_type": report.error_type, "function": "", "file": "", "line": 0,
                               "route_pattern": re.sub(r"^/[a-z0-9]{14}(?=/|$)", "/:panel", report.route), "status_code": None, "release": report.release, "message": report.message})
        return Response(status_code=204)

    @app.get("/health/ready")
    def health_ready(request: Request):
        """The server AND its database answer: 200 {"status": "ok"} or 503 {"status": "degraded"}. No detail. (/health stays light: no database.)"""
        if _ready_limit.too_many(web_safety.get_client_ip(request)):
            return JSONResponse(status_code=429, headers={"Retry-After": "60"}, content={"status": "degraded"})
        try:
            conn = get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("SET LOCAL statement_timeout = 2000")
                cursor.execute("SELECT 1")
                cursor.fetchone()
                conn.rollback()
            finally:
                conn.close()
            return {"status": "ok"}
        except Exception:  # noqa: BLE001
            return JSONResponse(status_code=503, content={"status": "degraded"})

    # ------------------------------------------------------------------------------------------------------------------ admin
    @app.get("/admin/system-errors", dependencies=[Depends(require_admin)])
    def system_errors(status: str = "", limit: int = 200):
        """The errors kept (newest first) and the summary card: new ones in the last 24 hours and the last error."""
        limit = max(1, min(int(limit), 500))
        conn = get_connection()
        cursor = conn.cursor()
        try:
            monitoring.ensure_schema()
            where, args = ("WHERE status = %s", [status]) if status in monitoring.STATUSES else ("", [])
            cursor.execute(
                f"SELECT id, source, error_type, function, file, line, route_pattern, status_code, release, message, count, first_seen, last_seen, status "
                f"FROM app_errors {where} ORDER BY last_seen DESC LIMIT %s", (*args, limit))
            names = ("id", "source", "error_type", "function", "file", "line", "route_pattern", "status_code", "release", "message", "count", "first_seen", "last_seen", "status")
            items = [{name: (value.isoformat() if hasattr(value, "isoformat") else value) for name, value in zip(names, row)} for row in cursor.fetchall()]
            cursor.execute("SELECT COUNT(*) FROM app_errors WHERE status = 'new' AND last_seen > NOW() - INTERVAL '24 hours'")
            new_24h = cursor.fetchone()[0]
            cursor.execute("SELECT error_type, last_seen FROM app_errors ORDER BY last_seen DESC LIMIT 1")
            last = cursor.fetchone()
            return {"items": items, "summary": {"new_24h": new_24h, "last_error": ({"error_type": last[0], "last_seen": last[1].isoformat()} if last else None)}}
        finally:
            cursor.close()
            conn.close()

    @app.post("/admin/system-errors/{error_id}/status", dependencies=[Depends(require_admin)])
    def set_error_status(error_id: int, data: StatusPayload):
        if data.status not in monitoring.STATUSES:
            raise HTTPException(status_code=422, detail={"code": "invalid_status", "message": "Estado no válido. / Invalid status."})
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE app_errors SET status = %s WHERE id = %s RETURNING id", (data.status, error_id))
            if cursor.fetchone() is None:
                conn.rollback()
                raise HTTPException(status_code=404, detail={"code": "not_found", "message": "No encontrado. / Not found."})
            conn.commit()
            return {"id": error_id, "status": data.status}
        finally:
            cursor.close()
            conn.close()


async def _in_pool(function, *args):
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(function, *args)
