from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Header

import os
import json
import uuid
from datetime import datetime, timedelta
from typing import Any
from pydantic import BaseModel
from database import get_connection
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from psycopg2.extras import Json as PgJson
from google_calendar import (
    create_calendar_event,
    update_calendar_event,
    delete_calendar_event,
    create_trial_session_event,
    clear_calendar
)
from landing_page_default import DEFAULT_LANDING_CONTENT
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token


DAY_MAP = {
    "Monday": 0,
    "Tuesday": 1,
    "Wednesday": 2,
    "Thursday": 3,
    "Friday": 4,
    "Saturday": 5,
    "Sunday": 6
}


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[

        "http://localhost:5173",

        "http://127.0.0.1:5173",

        "https://thundbalance.vercel.app"

    ],
    
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "thundbalance").strip()
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "david@admin.es").strip().casefold()
firebase_token_request = GoogleAuthRequest()


def require_admin(authorization: str | None = Header(default=None)):
    """Verify a Firebase ID token and allow only the configured admin email."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.casefold() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        claims = id_token.verify_firebase_token(
            token,
            firebase_token_request,
            audience=FIREBASE_PROJECT_ID,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired login")

    expected_issuer = f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}"
    if claims.get("iss") != expected_issuer:
        raise HTTPException(status_code=401, detail="Invalid login issuer")

    token_email = str(claims.get("email", "")).strip().casefold()
    if not ADMIN_EMAIL or token_email != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Administrator access required")

    return claims


def require_client(authorization: str | None = Header(default=None)):
    """Verify a Firebase token for client-owned workflow endpoints."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.casefold() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        claims = id_token.verify_firebase_token(
            token, firebase_token_request, audience=FIREBASE_PROJECT_ID
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired login")
    if claims.get("iss") != f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}":
        raise HTTPException(status_code=401, detail="Invalid login issuer")
    return claims


UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}
MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024  # 8MB

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}
MAX_VIDEO_SIZE_BYTES = 300 * 1024 * 1024  # 300MB — raised from 50MB, phone-recorded workout clips were hitting the old limit


@app.on_event("startup")
def ensure_landing_page_table():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS landing_page_content (
                id SERIAL PRIMARY KEY,
                version TEXT UNIQUE NOT NULL,
                content JSONB NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )

        for version in ("draft", "published", "default_base"):

            cursor.execute(
                """
                INSERT INTO landing_page_content (version, content)
                VALUES (%s, %s)
                ON CONFLICT (version) DO NOTHING
                """,
                (version, PgJson(DEFAULT_LANDING_CONTENT))
            )

        conn.commit()

    finally:

        cursor.close()
        conn.close()


@app.on_event("startup")
def ensure_training_videos_table():

    # Independent of the Landing Page Editor's JSON-versioned content — this
    # is a plain relational table, same pattern as sessions/client_requests.

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS training_videos (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                video_source TEXT NOT NULL,
                video_url TEXT NOT NULL,
                display_order INT DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )

        conn.commit()

    finally:

        cursor.close()
        conn.close()


@app.on_event("startup")
def ensure_client_workflow_fields():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT")
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS trainer_id INTEGER REFERENCES trainers(id)")
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS start_date DATE")
        cursor.execute("ALTER TABLE client_requests ADD COLUMN IF NOT EXISTS sessions_per_week INTEGER")
        cursor.execute("ALTER TABLE client_requests ALTER COLUMN status SET DEFAULT 'Pending'")
        cursor.execute("ALTER TABLE user_plans ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")
        cursor.execute("ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_weeks INTEGER")
        cursor.execute("""
            UPDATE plans SET duration_weeks = CASE id
                WHEN 1 THEN 4 WHEN 2 THEN 12 WHEN 3 THEN 24 ELSE 4 END
            WHERE duration_weeks IS NULL
        """)
        conn.commit()
    finally:
        cursor.close()
        conn.close()


class LandingContentPayload(BaseModel):
    content: dict[str, Any]


class SessionCreate(BaseModel):
    user_id: int
    trainer_id: int
    session_date: str
    session_time: str


class UserCreate(BaseModel):
    firebase_uid: str
    nome: str
    email: str
    foto: str | None = None
    telefone: str | None = None
    codigo_pais: str | None = None
    cidade: str | None = None
    morada: str | None = None
    cep: str | None = None


class UpdateSession(BaseModel):
    session_date: str
    session_time: str


class UpdateProfile(BaseModel):
    telefone: str
    codigo_pais: str
    cidade: str
    morada: str
    cep: str


class UserPlanCreate(BaseModel):
    user_id: int
    plan_id: int


class TrialSessionCreate(BaseModel):
    full_name: str
    email: str
    phone: str
    age: int
    goal: str
    experience: str
    session_date: str
    session_time: str


class AssignPlan(BaseModel):
    user_id: int
    plan_id: int


class ClientRequestCreate(BaseModel):
    user_id: int | None = None
    plan_id: int
    sessions_per_week: int
    preferred_days: str
    preferred_time: str


class ApproveRequest(BaseModel):
    request_id: int
    trainer_id: int
    start_date: str
    plan_id: int | None = None
    sessions_per_week: int | None = None


class RejectRequest(BaseModel):
    request_id: int
    reason: str | None = None


class TrainingVideoCreate(BaseModel):
    title: str
    description: str | None = None
    video_source: str
    video_url: str


class TrainingVideoUpdate(BaseModel):
    title: str
    description: str | None = None
    video_source: str
    video_url: str


class TrainingVideoReorder(BaseModel):
    ordered_ids: list[int]


def trainer_is_available(
    cursor,
    trainer_id,
    session_date,
    session_time
):

    cursor.execute(
        """
        SELECT id
        FROM sessions
        WHERE trainer_id = %s
        AND session_date = %s
        AND session_time = %s
        AND status = 'Booked'
        """,
        (
            trainer_id,
            session_date,
            session_time
        )
    )

    existing_session = cursor.fetchone()

    return existing_session is None


def generate_session_dates(
    start_date,
    preferred_days,
    total_sessions
):

    selected_days = [
        DAY_MAP[day.strip()]
        for day in preferred_days.split(",")
        if day.strip() in DAY_MAP
    ]
    if not selected_days:
        raise HTTPException(status_code=400, detail="Request must include at least one preferred day")

    current_date = datetime.strptime(
        start_date,
        "%Y-%m-%d"
    )

    dates = []

    while len(dates) < total_sessions:

        if current_date.weekday() in selected_days:

            dates.append(
                current_date.strftime("%Y-%m-%d")
            )

        current_date += timedelta(days=1)

    return dates


@app.get("/")
def home():
    return {
        "message": "ThundBalance API Running"
    }


@app.get("/plans")
def get_plans():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT *
            FROM plans
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/trainers")
def get_trainers():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT *
            FROM trainers
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.post("/sessions")
def create_session(session: SessionCreate):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        if not trainer_is_available(
            cursor,
            session.trainer_id,
            session.session_date,
            session.session_time
        ):

            return {
                "error": "Trainer already booked at this time"
            }

        cursor.execute(
            """
            SELECT nome
            FROM trainers
            WHERE id = %s
            """,
            (session.trainer_id,)
        )

        trainer = cursor.fetchone()

        trainer_name = trainer[0]

        cursor.execute(
            """
            SELECT nome, email
            FROM users
            WHERE id = %s
            """,
            (session.user_id,)
        )

        user = cursor.fetchone()

        client_name = user[0]
        client_email = user[1]

        cursor.execute(
            """
            INSERT INTO sessions
            (
                user_id,
                trainer_id,
                session_date,
                session_time
            )

            VALUES (%s, %s, %s, %s)

            RETURNING id
            """,
            (
                session.user_id,
                session.trainer_id,
                session.session_date,
                session.session_time
            )
        )

        session_id = cursor.fetchone()[0]

        google_event_id = create_calendar_event(
            trainer_name,
            client_name,
            client_email,
            session.session_date,
            session.session_time
        )

        cursor.execute(
            """
            UPDATE sessions
            SET google_event_id = %s
            WHERE id = %s
            """,
            (
                google_event_id,
                session_id
            )
        )

        conn.commit()

        return {
            "message": "Session created successfully",
            "google_event_id": google_event_id
        }

    except Exception as e:
        conn.rollback()
        return {"error": str(e)}

    finally:

        cursor.close()
        conn.close()


@app.get("/sessions")
def get_sessions():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT *
            FROM sessions
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.post("/users")
def create_user(user: UserCreate):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT id
            FROM users
            WHERE email = %s
            """,
            (user.email,)
        )

        existing_user = cursor.fetchone()

        if existing_user:

            return {
                "message": "User already exists"
            }

        cursor.execute(
            """
            INSERT INTO users
            (
                firebase_uid,
                nome,
                email,
                foto,
                telefone,
                codigo_pais,
                cidade,
                morada,
                cep
            )

            VALUES
            (
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s
            )
            """,
            (
                user.firebase_uid,
                user.nome,
                user.email,
                user.foto,
                user.telefone,
                user.codigo_pais,
                user.cidade,
                user.morada,
                user.cep
            )
        )

        conn.commit()

        return {
            "message": "User created successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/users")
def get_users():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT *
            FROM users
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/users/email/{email}")
def get_user_by_email(email: str):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                u.id,
                u.nome,
                u.email,
                p.nome

            FROM users u

            LEFT JOIN user_plans up
                ON u.id = up.user_id

            LEFT JOIN plans p
                ON up.plan_id = p.id

            WHERE u.email = %s
            """,
            (email,)
        )

        user = cursor.fetchone()

        if not user:

            return {
                "message": "User not found"
            }

        return {
            "id": user[0],
            "nome": user[1],
            "email": user[2],
            "plano": user[3]
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/sessions/user/{user_id}")
def get_user_sessions(user_id: int):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                s.id,
                s.session_date,
                s.session_time,
                t.nome,
                s.status,
                s.rescheduled,
                s.session_number

            FROM sessions s

            JOIN trainers t
                ON s.trainer_id = t.id

            WHERE s.user_id = %s

            ORDER BY s.session_date ASC
            """,
            (user_id,)
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.delete("/sessions/{session_id}")
def cancel_session(session_id: int):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT google_event_id
            FROM sessions
            WHERE id = %s
            """,
            (session_id,)
        )

        result = cursor.fetchone()

        if not result:

            return {
                "error": "Session not found"
            }

        google_event_id = result[0]

        if google_event_id:

            delete_calendar_event(
                google_event_id
            )

        cursor.execute(
            """
            UPDATE sessions
            SET status = 'Cancelled'
            WHERE id = %s
            """,
            (session_id,)
        )

        conn.commit()

        return {
            "message": "Session cancelled successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/profile/{user_id}")
def get_profile(user_id: int):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                u.id,
                u.nome,
                u.email,
                u.foto,
                u.telefone,
                u.codigo_pais,
                u.cidade,
                u.morada,
                u.cep,
                p.nome

            FROM users u

            LEFT JOIN user_plans up
                ON u.id = up.user_id

            LEFT JOIN plans p
                ON up.plan_id = p.id

            WHERE u.id = %s
            """,
            (user_id,)
        )

        profile = cursor.fetchone()

        return {
            "id": profile[0],
            "nome": profile[1],
            "email": profile[2],
            "foto": profile[3],
            "telefone": profile[4],
            "codigo_pais": profile[5],
            "cidade": profile[6],
            "morada": profile[7],
            "cep": profile[8],
            "plano": profile[9]
        }

    finally:

        cursor.close()
        conn.close()


@app.put("/sessions/{session_id}")
def update_session(
    session_id: int,
    session: UpdateSession
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                trainer_id,
                google_event_id,
                rescheduled
            FROM sessions
            WHERE id = %s
            """,
            (session_id,)
        )

        result = cursor.fetchone()

        if not result:

            return {
                "error": "Session not found"
            }

        trainer_id = result[0]
        google_event_id = result[1]
        rescheduled = result[2]

        if rescheduled:

            return {
                "error": "This session has already been rescheduled"
            }

        cursor.execute(
            """
            SELECT id
            FROM sessions
            WHERE trainer_id = %s
            AND session_date = %s
            AND session_time = %s
            AND status = 'Booked'
            AND id != %s
            """,
            (
                trainer_id,
                session.session_date,
                session.session_time,
                session_id
            )
        )

        conflict = cursor.fetchone()

        if conflict:

            return {
                "error": "Trainer already booked at this time"
            }

        cursor.execute(
            """
            UPDATE sessions
            SET
                session_date = %s,
                session_time = %s,
                rescheduled = TRUE
            WHERE id = %s
            """,
            (
                session.session_date,
                session.session_time,
                session_id
            )
        )

        if google_event_id:

            update_calendar_event(
                google_event_id,
                session.session_date,
                session.session_time
            )

        conn.commit()

        return {
            "message": "Session updated successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/stats", dependencies=[Depends(require_admin)])
def get_admin_stats():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute("SELECT COUNT(*) FROM users")
        total_users = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM trainers")
        total_trainers = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM sessions")
        total_sessions = cursor.fetchone()[0]

        return {
            "users": total_users,
            "trainers": total_trainers,
            "sessions": total_sessions
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/users", dependencies=[Depends(require_admin)])
def admin_users():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT

                u.id,

                u.nome,

                u.email,

                COALESCE(
                    p.nome,
                    'No Plan'
                )

            FROM users u

            LEFT JOIN user_plans up
                ON u.id = up.user_id

            LEFT JOIN plans p
                ON up.plan_id = p.id

            ORDER BY u.id
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/trainers", dependencies=[Depends(require_admin)])
def admin_trainers():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT id, nome, especialidade
            FROM trainers
            ORDER BY id
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/sessions", dependencies=[Depends(require_admin)])
def admin_sessions():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                s.id,
                u.nome,
                t.nome,
                s.session_date,
                s.session_time,
                s.status
            FROM sessions s
            JOIN users u
                ON s.user_id = u.id
            JOIN trainers t
                ON s.trainer_id = t.id
            ORDER BY s.session_date ASC
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.put("/profile/{user_id}")
def update_profile(
    user_id: int,
    profile: UpdateProfile
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            UPDATE users
            SET
                telefone = %s,
                codigo_pais = %s,
                cidade = %s,
                morada = %s,
                cep = %s
            WHERE id = %s
            """,
            (
                profile.telefone,
                profile.codigo_pais,
                profile.cidade,
                profile.morada,
                profile.cep,
                user_id
            )
        )

        conn.commit()

        return {
            "message": "Profile updated successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.post("/user-plan")
def assign_plan(data: UserPlanCreate):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            DELETE FROM user_plans
            WHERE user_id = %s
            """,
            (data.user_id,)
        )

        cursor.execute(
            """
            INSERT INTO user_plans
            (user_id, plan_id)

            VALUES (%s, %s)
            """,
            (
                data.user_id,
                data.plan_id
            )
        )

        conn.commit()

        return {
            "message": "Plan assigned successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/available-trainers/{day}/{time}")
def available_trainers(day: str, time: str):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                t.id,
                t.nome

            FROM trainers t

            JOIN trainer_availability ta
                ON t.id = ta.trainer_id

            WHERE
                ta.day_of_week = %s
                AND %s BETWEEN ta.start_time AND ta.end_time
            """,
            (day, time)
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.post("/trial-sessions")
def create_trial_session(
    trial: TrialSessionCreate
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            INSERT INTO trial_sessions
            (
                full_name,
                email,
                phone,
                age,
                goal,
                experience,
                session_date,
                session_time
            )

            VALUES
            (%s,%s,%s,%s,%s,%s,%s,%s)

            RETURNING id
            """,
            (
                trial.full_name,
                trial.email,
                trial.phone,
                trial.age,
                trial.goal,
                trial.experience,
                trial.session_date,
                trial.session_time
            )
        )

        trial_id = cursor.fetchone()[0]

        google_event_id = create_trial_session_event(
            trial.full_name,
            trial.email,
            trial.phone,
            trial.goal,
            trial.experience,
            trial.session_date,
            trial.session_time
        )

        conn.commit()

        return {
            "message": "Trial session created successfully",
            "trial_id": trial_id,
            "google_event_id": google_event_id
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.post("/admin/assign-plan", dependencies=[Depends(require_admin)])
def admin_assign_plan(
    data: AssignPlan
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            DELETE FROM user_plans
            WHERE user_id = %s
            """,
            (data.user_id,)
        )

        cursor.execute(
            """
            INSERT INTO user_plans
            (
                user_id,
                plan_id
            )

            VALUES (%s, %s)
            """,
            (
                data.user_id,
                data.plan_id
            )
        )

        conn.commit()

        return {
            "message": "Plan assigned successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/client/workflow", dependencies=[Depends(require_client)])
def client_workflow(authorization: str | None = Header(default=None)):
    claims = require_client(authorization)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM users WHERE firebase_uid = %s", (claims.get("sub"),))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Client profile not found")
        user_id = user[0]
        cursor.execute("""
            SELECT cr.id, cr.status, cr.rejection_reason, p.nome, cr.sessions_per_week,
                   cr.preferred_days, cr.preferred_time, t.nome, cr.start_date
            FROM client_requests cr
            LEFT JOIN plans p ON p.id = cr.plan_id
            LEFT JOIN trainers t ON t.id = cr.trainer_id
            WHERE cr.user_id = %s ORDER BY cr.id DESC LIMIT 1
        """, (user_id,))
        request = cursor.fetchone()
        cursor.execute("""
            SELECT p.nome, t.nome, up.plan_id
            FROM user_plans up
            JOIN plans p ON p.id = up.plan_id
            LEFT JOIN client_requests cr ON cr.user_id = up.user_id AND LOWER(cr.status) = 'approved'
            LEFT JOIN trainers t ON t.id = cr.trainer_id
            WHERE up.user_id = %s AND up.active = TRUE ORDER BY cr.id DESC NULLS LAST LIMIT 1
        """, (user_id,))
        plan = cursor.fetchone()
        cursor.execute("""
            SELECT s.id, s.session_date, s.session_time, t.nome, s.status, s.session_number
            FROM sessions s LEFT JOIN trainers t ON t.id = s.trainer_id
            WHERE s.user_id = %s ORDER BY s.session_date ASC, s.session_time ASC
        """, (user_id,))
        sessions = cursor.fetchall()
        status = "active" if plan else (
            str(request[1]).strip().lower() if request else "new"
        )
        return {
            "user_id": user_id, "state": status,
            "request": ({"id": request[0], "status": request[1], "reason": request[2],
                         "package": request[3], "sessions_per_week": request[4],
                         "preferred_days": request[5], "preferred_time": request[6],
                         "trainer": request[7], "start_date": request[8]} if request else None),
            "plan": ({"name": plan[0], "trainer": plan[1], "id": plan[2]} if plan else None),
            "sessions": [{"id": s[0], "date": str(s[1]), "time": str(s[2]), "trainer": s[3],
                          "status": s[4], "number": s[5]} for s in sessions],
            "sessions_remaining": sum(1 for s in sessions if s[4] == "Booked"),
        }
    finally:
        cursor.close()
        conn.close()


@app.post("/client-requests", dependencies=[Depends(require_client)])
def create_client_request(
    request: ClientRequestCreate,
    authorization: str | None = Header(default=None),
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        claims = require_client(authorization)
        cursor.execute("SELECT id FROM users WHERE firebase_uid = %s", (claims.get("sub"),))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Client profile not found")
        user_id = user[0]
        cursor.execute("""
            SELECT id FROM client_requests WHERE user_id = %s AND LOWER(status) = 'pending'
            LIMIT 1
        """, (user_id,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="You already have a pending request")
        cursor.execute("SELECT 1 FROM user_plans WHERE user_id = %s AND active = TRUE LIMIT 1", (user_id,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="You already have an active plan")

        cursor.execute(
            """
            INSERT INTO client_requests
            (
                user_id,
                plan_id,
                sessions_per_week,
                preferred_days,
                preferred_time
            )

            VALUES
            (%s,%s,%s,%s,%s)
            """,
            (
                user_id,
                request.plan_id,
                request.sessions_per_week,
                request.preferred_days,
                request.preferred_time
            )
        )

        conn.commit()

        return {
            "message": "Request submitted successfully"
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Could not submit training request") from e

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/client-requests", dependencies=[Depends(require_admin)])
def admin_client_requests():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT

                cr.id,

                u.nome,

                p.nome,

                cr.sessions_per_week,

                cr.preferred_days,

                cr.preferred_time,

                cr.status,
                cr.rejection_reason

            FROM client_requests cr

            JOIN users u
                ON cr.user_id = u.id

            JOIN plans p
                ON cr.plan_id = p.id

            ORDER BY cr.id DESC
            """
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.post("/admin/approve-request", dependencies=[Depends(require_admin)])
def approve_request(
    data: ApproveRequest
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                user_id,
                plan_id,
                sessions_per_week,
                preferred_days,
                preferred_time
            FROM client_requests
            WHERE id = %s AND LOWER(status) = 'pending'
            FOR UPDATE
            """,
            (data.request_id,)
        )

        request = cursor.fetchone()

        if not request:

            raise HTTPException(status_code=404, detail="Pending request not found")

        user_id = request[0]
        plan_id = data.plan_id or request[1]
        sessions_per_week = data.sessions_per_week or request[2]
        preferred_days = request[3]
        preferred_time = request[4]

        cursor.execute(
            """
            SELECT
                nome,
                email
            FROM users
            WHERE id = %s
            """,
            (user_id,)
        )

        user = cursor.fetchone()

        client_name = user[0]
        client_email = user[1]

        cursor.execute(
            """
            SELECT
                nome
            FROM trainers
            WHERE id = %s
            """,
            (data.trainer_id,)
        )

        trainer = cursor.fetchone()

        if not trainer:
            raise HTTPException(status_code=404, detail="Trainer not found")
        trainer_name = trainer[0]

        if sessions_per_week < 1 or sessions_per_week > 7:
            raise HTTPException(status_code=400, detail="Sessions per week must be between 1 and 7")

        cursor.execute("SELECT duration_weeks FROM plans WHERE id = %s", (plan_id,))
        plan_duration = cursor.fetchone()
        if not plan_duration:
            raise HTTPException(status_code=404, detail="Plan not found")
        weeks = plan_duration[0]

        total_sessions = (
            weeks *
            sessions_per_week
        )

        cursor.execute("DELETE FROM user_plans WHERE user_id = %s", (user_id,))
        cursor.execute("INSERT INTO user_plans (user_id, plan_id) VALUES (%s, %s)", (user_id, plan_id))

        session_dates = generate_session_dates(
            data.start_date,
            preferred_days,
            total_sessions
        )

        for index, session_date in enumerate(
            session_dates,
            start=1
        ):

            session_number = (
                f"{index}/{total_sessions}"
            )

            print(
                "CREATING EVENT:",
                session_number
            )

            google_event_id = create_calendar_event(
                trainer_name,
                client_name,
                client_email,
                session_date,
                preferred_time,
                session_number
            )

            print(
                "GOOGLE EVENT:",
                google_event_id
            )

            cursor.execute(
                """
                INSERT INTO sessions
                (
                    user_id,
                    trainer_id,
                    session_date,
                    session_time,
                    request_id,
                    session_number,
                    google_event_id
                )

                VALUES
                (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s
                )
                """,
                (
                    user_id,
                    data.trainer_id,
                    session_date,
                    preferred_time,
                    data.request_id,
                    session_number,
                    google_event_id
                )
            )

            print(
                "SESSION INSERTED:",
                session_number
            )

        cursor.execute(
            """
            UPDATE client_requests

            SET
                status = 'Approved',
                trainer_id = %s,
                start_date = %s,
                plan_id = %s,
                sessions_per_week = %s,
                rejection_reason = NULL

            WHERE id = %s
            """,
            (
                data.trainer_id,
                data.start_date,
                plan_id,
                sessions_per_week,
                data.request_id
            )
        )

        print("FINISHED LOOP")

        conn.commit()

        return {
            "message": "Request approved successfully",
            "total_sessions": total_sessions
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:

        conn.rollback()

        print(e)
        raise HTTPException(status_code=500, detail="Could not approve training request") from e

    finally:

        cursor.close()
        conn.close()


@app.post("/admin/reject-request", dependencies=[Depends(require_admin)])
def reject_request(data: RejectRequest):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE client_requests SET status = 'Rejected', rejection_reason = %s
            WHERE id = %s AND LOWER(status) = 'pending'
            RETURNING id
        """, ((data.reason or "").strip() or None, data.request_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Pending request not found")
        conn.commit()
        return {"message": "Request rejected"}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


@app.get("/admin/sessions/email/{email}", dependencies=[Depends(require_admin)])
def get_sessions_by_email(email: str):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT

                s.session_number,

                s.session_date,

                s.session_time,

                s.status,

                t.nome

            FROM sessions s

            JOIN users u
                ON s.user_id = u.id

            JOIN trainers t
                ON s.trainer_id = t.id

            WHERE u.email = %s

            ORDER BY s.session_date
            """,
            (email,)
        )

        return cursor.fetchall()

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/client-progress/{email}", dependencies=[Depends(require_admin)])
def client_progress(email: str):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT

                COUNT(*)

            FROM sessions s

            JOIN users u
                ON s.user_id = u.id

            WHERE

                u.email = %s

                AND s.session_date < CURRENT_DATE
            """,
            (email,)
        )

        completed = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT

                COUNT(*)

            FROM sessions s

            JOIN users u
                ON s.user_id = u.id

            WHERE u.email = %s
            """,
            (email,)
        )

        total = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT

                MIN(session_date)

            FROM sessions s

            JOIN users u
                ON s.user_id = u.id

            WHERE

                u.email = %s

                AND session_date >= CURRENT_DATE
            """,
            (email,)
        )

        next_session = cursor.fetchone()[0]

        return {
            "completed": completed,
            "total": total,
            "remaining": total - completed,
            "next_session": next_session
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/trainer/{trainer_id}/available-times/{session_date}")
def get_available_times(
    trainer_id: int,
    session_date: str
):

    AVAILABLE_TIMES = [
        "07:00",
        "08:00",
        "09:00",
        "10:00",
        "11:00",
        "12:00",
        "13:00",
        "14:00",
        "15:00",
        "16:00",
        "17:00",
        "18:00",
        "19:00",
        "20:00"
    ]

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT session_time

            FROM sessions

            WHERE trainer_id = %s

            AND session_date = %s

            AND status = 'Booked'
            """,
            (
                trainer_id,
                session_date
            )
        )

        booked_times = [
            row[0]
            for row in cursor.fetchall()
        ]

        return [
            time
            for time in AVAILABLE_TIMES
            if time not in booked_times
        ]

    finally:

        cursor.close()
        conn.close()


@app.delete("/admin/clear-calendar", dependencies=[Depends(require_admin)])
def clear_google_calendar():

    clear_calendar()

    return {
        "message": "Google Calendar cleared successfully"
    }


# ---------------------------------------------------------------------------
# Landing Page Editor (visual page builder)
# ---------------------------------------------------------------------------
# Content is stored as a single JSON document per "version" (draft / published).
# The public site always reads the "published" version. The admin editor reads
# and writes the "draft" version, and only overwrites "published" when the
# admin explicitly clicks Publish.


@app.get("/landing-page/content")
def get_landing_page_content(
    version: str = "published",
    authorization: str | None = Header(default=None),
):

    if version not in ("draft", "published"):
        raise HTTPException(status_code=400, detail="Invalid version")

    if version == "draft":
        require_admin(authorization)

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT content, updated_at
            FROM landing_page_content
            WHERE version = %s
            """,
            (version,)
        )

        row = cursor.fetchone()

        if not row:

            return {
                "version": version,
                "content": DEFAULT_LANDING_CONTENT,
                "updated_at": None
            }

        content, updated_at = row

        return {
            "version": version,
            "content": content,
            "updated_at": updated_at.isoformat() if updated_at else None
        }

    finally:

        cursor.close()
        conn.close()


class FooterContentPayload(BaseModel):
    footer: dict[str, Any]
    previous_footer: dict[str, Any]


@app.put("/landing-page/footer", dependencies=[Depends(require_admin)])
def save_footer_content(payload: FooterContentPayload):
    """Publish just the footer, retaining unrelated draft and published content."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT version, content FROM landing_page_content "
            "WHERE version IN ('draft', 'published') ORDER BY version FOR UPDATE"
        )
        versions = dict(cursor.fetchall())
        published = versions.get('published', DEFAULT_LANDING_CONTENT)
        if published.get('sections', {}).get('footer', {}) != payload.previous_footer:
            raise HTTPException(status_code=409, detail="Footer has changed since it was loaded")
        for version in ('draft', 'published'):
            content = versions.get(version, DEFAULT_LANDING_CONTENT)
            updated = {**content, 'sections': {**content.get('sections', {}), 'footer': payload.footer}}
            cursor.execute(
                "INSERT INTO landing_page_content (version, content, updated_at) VALUES (%s, %s, NOW()) "
                "ON CONFLICT (version) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()",
                (version, PgJson(updated)),
            )
        conn.commit()
        return {"message": "Footer saved successfully"}
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


@app.put("/landing-page/content/draft", dependencies=[Depends(require_admin)])
def save_landing_page_draft(payload: LandingContentPayload):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            INSERT INTO landing_page_content (version, content, updated_at)
            VALUES ('draft', %s, NOW())
            ON CONFLICT (version)
            DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
            """,
            (PgJson(payload.content),)
        )

        conn.commit()

        return {"message": "Draft saved successfully"}

    finally:

        cursor.close()
        conn.close()


@app.post("/landing-page/publish", dependencies=[Depends(require_admin)])
def publish_landing_page(payload: LandingContentPayload | None = None):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        if payload is not None:

            # Publish this exact content and keep the draft in sync with it.
            cursor.execute(
                """
                INSERT INTO landing_page_content (version, content, updated_at)
                VALUES ('draft', %s, NOW())
                ON CONFLICT (version)
                DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
                """,
                (PgJson(payload.content),)
            )

            cursor.execute(
                """
                INSERT INTO landing_page_content (version, content, updated_at)
                VALUES ('published', %s, NOW())
                ON CONFLICT (version)
                DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
                """,
                (PgJson(payload.content),)
            )

        else:

            # No content sent: publish whatever is currently saved as draft.
            cursor.execute(
                "SELECT content FROM landing_page_content WHERE version = 'draft'"
            )

            row = cursor.fetchone()

            draft_content = row[0] if row else DEFAULT_LANDING_CONTENT

            cursor.execute(
                """
                INSERT INTO landing_page_content (version, content, updated_at)
                VALUES ('published', %s, NOW())
                ON CONFLICT (version)
                DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
                """,
                (PgJson(draft_content),)
            )

        conn.commit()

        return {"message": "Landing page published successfully"}

    finally:

        cursor.close()
        conn.close()


@app.post("/landing-page/reset", dependencies=[Depends(require_admin)])
def reset_landing_page(version: str = "draft"):

    # 'default_base' is an immutable snapshot written once on first startup
    # (see ensure_landing_page_table) and must never be a valid destination
    # for this endpoint — that's exactly what would let it be overwritten.
    if version not in ("draft", "published"):
        raise HTTPException(status_code=400, detail="Invalid version")

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            "SELECT content FROM landing_page_content WHERE version = 'default_base'"
        )

        row = cursor.fetchone()

        # Should always exist after ensure_landing_page_table runs on startup,
        # but fall back to the in-code default just in case.
        base_content = row[0] if row else DEFAULT_LANDING_CONTENT

        cursor.execute(
            """
            INSERT INTO landing_page_content (version, content, updated_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (version)
            DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
            """,
            (version, PgJson(base_content))
        )

        conn.commit()

        return {"message": f"{version} restored from default_base"}

    finally:

        cursor.close()
        conn.close()


@app.post("/landing-page/upload-image", dependencies=[Depends(require_admin)])
async def upload_landing_page_image(file: UploadFile = File(...)):

    original_name = file.filename or "image"
    extension = os.path.splitext(original_name)[1].lower()

    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    contents = await file.read()

    if len(contents) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Image is too large (max 8MB)")

    filename = f"{uuid.uuid4().hex}{extension}"
    destination = os.path.join(UPLOAD_DIR, filename)

    with open(destination, "wb") as f:
        f.write(contents)

    return {"url": f"/uploads/{filename}"}


@app.post("/landing-page/upload-video", dependencies=[Depends(require_admin)])
async def upload_landing_page_video(file: UploadFile = File(...)):

    # Same pattern as upload_landing_page_image above, just with video
    # extensions and a larger size ceiling. Videos are stored in the same
    # backend/uploads/ directory and served the same way.

    original_name = file.filename or "video"
    extension = os.path.splitext(original_name)[1].lower()

    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported video type")

    contents = await file.read()

    if len(contents) > MAX_VIDEO_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Video is too large (max 300MB)")

    filename = f"{uuid.uuid4().hex}{extension}"
    destination = os.path.join(UPLOAD_DIR, filename)

    with open(destination, "wb") as f:
        f.write(contents)

    return {"url": f"/uploads/{filename}"}


# ---------------------------------------------------------------------------
# Training Videos (student-facing video library)
# ---------------------------------------------------------------------------
# Plain relational table (see ensure_training_videos_table above), saved
# directly — no draft/publish versioning like the Landing Page Editor.
# video_source is one of: 'instagram' | 'youtube' | 'vimeo' | 'upload'.
# For uploads, video_url is reused from POST /landing-page/upload-video
# (that endpoint isn't specific to the landing page despite its name — it
# just stores a file under backend/uploads/ and returns its path).


@app.get("/training-videos")
def get_training_videos():

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT
                id,
                title,
                description,
                video_source,
                video_url,
                display_order
            FROM training_videos
            ORDER BY display_order ASC, id ASC
            """
        )

        rows = cursor.fetchall()

        return [
            {
                "id": row[0],
                "title": row[1],
                "description": row[2],
                "video_source": row[3],
                "video_url": row[4],
                "display_order": row[5]
            }
            for row in rows
        ]

    finally:

        cursor.close()
        conn.close()


@app.post("/training-videos", dependencies=[Depends(require_admin)])
def create_training_video(video: TrainingVideoCreate):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            SELECT COALESCE(MAX(display_order), -1) + 1
            FROM training_videos
            """
        )

        next_order = cursor.fetchone()[0]

        cursor.execute(
            """
            INSERT INTO training_videos
            (title, description, video_source, video_url, display_order)

            VALUES (%s, %s, %s, %s, %s)

            RETURNING id
            """,
            (
                video.title,
                video.description,
                video.video_source,
                video.video_url,
                next_order
            )
        )

        video_id = cursor.fetchone()[0]

        conn.commit()

        return {
            "message": "Training video created successfully",
            "id": video_id
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


# Declared BEFORE /training-videos/{video_id} so "reorder" is never
# swallowed by the {video_id}: int path parameter.
@app.put("/training-videos/reorder", dependencies=[Depends(require_admin)])
def reorder_training_videos(payload: TrainingVideoReorder):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        for index, video_id in enumerate(payload.ordered_ids):

            cursor.execute(
                """
                UPDATE training_videos
                SET display_order = %s
                WHERE id = %s
                """,
                (index, video_id)
            )

        conn.commit()

        return {
            "message": "Training videos reordered successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.put("/training-videos/{video_id}", dependencies=[Depends(require_admin)])
def update_training_video(
    video_id: int,
    video: TrainingVideoUpdate
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            UPDATE training_videos
            SET
                title = %s,
                description = %s,
                video_source = %s,
                video_url = %s
            WHERE id = %s
            """,
            (
                video.title,
                video.description,
                video.video_source,
                video.video_url,
                video_id
            )
        )

        conn.commit()

        return {
            "message": "Training video updated successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.delete("/training-videos/{video_id}", dependencies=[Depends(require_admin)])
def delete_training_video(video_id: int):

    conn = get_connection()
    cursor = conn.cursor()

    try:

        cursor.execute(
            """
            DELETE FROM training_videos
            WHERE id = %s
            """,
            (video_id,)
        )

        conn.commit()

        return {
            "message": "Training video deleted successfully"
        }

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()
