from fastapi import FastAPI

from datetime import datetime, timedelta
from pydantic import BaseModel
from database import get_connection
from fastapi.middleware.cors import CORSMiddleware
from google_calendar import (
    create_calendar_event,
    update_calendar_event,
    delete_calendar_event,
    create_trial_session_event,
    clear_calendar
)


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
    user_id: int
    plan_id: int
    sessions_per_week: int
    preferred_days: str
    preferred_time: str


class ApproveRequest(BaseModel):
    request_id: int
    trainer_id: int
    start_date: str


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
    ]

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

        return {
            "error": str(e)
        }

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


@app.get("/admin/stats")
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


@app.get("/admin/users")
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


@app.get("/admin/trainers")
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


@app.get("/admin/sessions")
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


@app.post("/admin/assign-plan")
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


@app.post("/client-requests")
def create_client_request(
    request: ClientRequestCreate
):

    conn = get_connection()
    cursor = conn.cursor()

    try:

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
                request.user_id,
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

    except Exception as e:

        conn.rollback()

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/client-requests")
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

                cr.status

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


@app.post("/admin/approve-request")
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
            WHERE id = %s
            """,
            (data.request_id,)
        )

        request = cursor.fetchone()

        if not request:

            return {
                "error": "Request not found"
            }

        user_id = request[0]
        plan_id = request[1]
        sessions_per_week = request[2]
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

        trainer_name = trainer[0]

        if plan_id == 1:

            weeks = 4

        elif plan_id == 2:

            weeks = 12

        else:

            weeks = 24

        total_sessions = (
            weeks *
            sessions_per_week
        )

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
                start_date = %s

            WHERE id = %s
            """,
            (
                data.trainer_id,
                data.start_date,
                data.request_id
            )
        )

        print("FINISHED LOOP")

        conn.commit()

        return {
            "message": "Request approved successfully",
            "total_sessions": total_sessions
        }

    except Exception as e:

        conn.rollback()

        print(e)

        return {
            "error": str(e)
        }

    finally:

        cursor.close()
        conn.close()


@app.get("/admin/sessions/email/{email}")
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


@app.get("/admin/client-progress/{email}")
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


@app.delete("/admin/clear-calendar")
def clear_google_calendar():

    clear_calendar()

    return {
        "message": "Google Calendar cleared successfully"
    }
