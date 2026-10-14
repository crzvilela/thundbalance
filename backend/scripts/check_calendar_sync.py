"""Diagnóstico SÓ DE LEITURA: as sessões da base de dados estão no calendário?

    python scripts/check_calendar_sync.py                 # sessões futuras
    python scripts/check_calendar_sync.py --client Henrique
    python scripts/check_calendar_sync.py --days 120 --verbose

Não cria, não altera e não apaga nada, nem na base de dados nem no Google
Calendar (só usa events.list e events.get). Pode correr-se à vontade.

Usa a base de dados e o calendário com que esta máquina está configurada:
DATABASE_URL (se existir, senão a base local) e GOOGLE_CALENDAR_ID.
Para comparar a PRODUÇÃO, defina DATABASE_URL e GOOGLE_CALENDAR_ID do Render
na sua janela do PowerShell antes de correr o script.
"""
import argparse
import ast
import glob
import os
import sys
from collections import Counter
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

import google_calendar as gc  # noqa: E402
from database import get_connection  # noqa: E402

CALENDAR_CALLS = {
    "create_calendar_event", "update_calendar_event", "delete_calendar_event",
    "create_trial_session_event", "update_trial_session_event", "clear_calendar",
}


def mask(value, keep=8):
    value = str(value or "")
    return f"…{value[-keep:]}" if len(value) > keep else value


def mask_calendar_id(value):
    """…d0490@group.calendar.google.com: only the last characters of the part
    before the @ are shown, enough to tell calendars apart."""
    local, _, domain = str(value or "").partition("@")
    return f"…{local[-6:]}@{domain}" if domain else mask(value)


def section(title):
    print(f"\n=== {title} ===")


# --------------------------------------------------------------- 1. configuration
def show_configuration():
    section("Calendário e credenciais")
    from_env = bool(os.getenv("GOOGLE_CALENDAR_ID", "").strip())
    print(f"ID do calendário (máscara): {mask_calendar_id(gc.CALENDAR_ID)}")
    print("Origem do ID: " + ("variável de ambiente GOOGLE_CALENDAR_ID"
                              if from_env else "constante por omissão em google_calendar.py (a variável GOOGLE_CALENDAR_ID NÃO está definida)"))
    if gc._read_env("GOOGLE_CREDENTIALS_JSON"):
        print("Credenciais: variável de ambiente GOOGLE_CREDENTIALS_JSON")
    elif os.path.isfile(gc.SERVICE_ACCOUNT_FILE):
        print("Credenciais: ficheiro backend/credentials.json")
    else:
        print("Credenciais: NÃO encontradas")
    conn = get_connection()
    host = conn.get_dsn_parameters().get("host")
    conn.close()
    print(f"Base de dados: {'DATABASE_URL' if os.getenv('DATABASE_URL') else 'configuração local'}, host={host}")


# --------------------------------------------------------------- 2. sessions vs calendar
def load_sessions(client_filter):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'calendar_sync_status'"
    )
    has_status = bool(cur.fetchone())
    status_cols = "s.calendar_sync_status, s.calendar_sync_error" if has_status else "NULL, NULL"
    cur.execute(
        f"""
        SELECT s.id, u.nome, s.session_date, s.session_time, t.nome, s.status,
               s.google_event_id, s.session_number, {status_cols}
        FROM sessions s
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN trainers t ON t.id = s.trainer_id
        WHERE s.session_date >= CURRENT_DATE AND s.status <> 'Cancelled'
        ORDER BY s.session_date, s.session_time, s.id
        """
    )
    rows = cur.fetchall()
    conn.close()
    if client_filter:
        needle = client_filter.lower()
        rows = [r for r in rows if needle in str(r[1] or "").lower()]
    return rows


def local_start(event):
    """'YYYY-MM-DD', 'HH:MM' of an event as Google reports it in Europe/Madrid."""
    start = (event.get("start") or {}).get("dateTime") or (event.get("start") or {}).get("date") or ""
    return start[:10], start[11:16]


def compare_sessions(rows, days):
    horizon = date.today() + timedelta(days=days)
    rows = [r for r in rows if r[2] <= horizon] if days else rows
    if not rows:
        print("Não há sessões futuras para comparar.")
        return Counter()

    first, last = min(r[2] for r in rows), max(r[2] for r in rows)
    time_min = f"{(first - timedelta(days=1)).isoformat()}T00:00:00Z"
    time_max = f"{(last + timedelta(days=2)).isoformat()}T00:00:00Z"
    events = {event["id"]: event for event in gc.list_calendar_events(time_min, time_max) if event.get("id")}
    print(f"Eventos lidos do calendário entre {first} e {last}: {len(events)}")

    service = None
    counts = Counter()
    problems = []
    for sid, client, day, time, trainer, status, event_id, number, sync, sync_error in rows:
        hhmm = str(time)[:5]
        verdict, detail = "OK", ""
        if not event_id:
            verdict = "SEM EVENTO"
        else:
            event = events.get(event_id)
            if event is None:                      # outside the window or really gone
                if service is None:
                    service = gc.get_calendar_service()
                try:
                    event = service.events().get(calendarId=gc.CALENDAR_ID, eventId=event_id).execute()
                except Exception as error:  # noqa: BLE001
                    status_code = getattr(getattr(error, "resp", None), "status", None)
                    event = None if status_code in (404, 410) else {"_error": type(error).__name__}
            if event is None or event.get("status") == "cancelled":
                verdict = "EVENTO INEXISTENTE"
            elif "_error" in event:
                verdict, detail = "NÃO VERIFICADO", event["_error"]
            else:
                ev_day, ev_time = local_start(event)
                if (ev_day, ev_time) != (str(day), hhmm):
                    verdict = "HORA DIFERENTE"
                    detail = f"calendário {ev_day} {ev_time} / base de dados {day} {hhmm}"
                    if ev_day == str(day):
                        delta = (int(ev_time[:2]) * 60 + int(ev_time[3:])) - (int(hhmm[:2]) * 60 + int(hhmm[3:]))
                        if delta in (60, -60, 120, -120):
                            detail += f"  <- diferença de {delta // 60:+d} h: SUSPEITA DE ERRO DE FUSO"
                elif client and client.split()[0].lower() not in str(event.get("summary") or "").lower():
                    detail = f"título não contém o cliente: {event.get('summary')!r}"
        counts[verdict] += 1
        if verdict != "OK" or detail:
            problems.append((sid, client, day, hhmm, trainer, verdict, detail, sync, sync_error))

    print(f"\nSessões futuras comparadas: {len(rows)}")
    for label in ("OK", "SEM EVENTO", "EVENTO INEXISTENTE", "HORA DIFERENTE", "NÃO VERIFICADO"):
        print(f"  {label:<20} {counts.get(label, 0)}")
    if problems:
        print("\nDiferenças (id | cliente | data hora | entrenador | resultado):")
        for sid, client, day, hhmm, trainer, verdict, detail, sync, sync_error in problems:
            extra = f" | sync={sync}" + (f" ({sync_error})" if sync_error else "") if sync else ""
            print(f"  #{sid} | {client} | {day} {hhmm} | {trainer} | {verdict}{extra}")
            if detail:
                print(f"      {detail}")
    return counts


# --------------------------------------------------------------- 3. static review of the code
def code_review():
    section("Como o código cria o evento (revisão estática)")
    source = open(os.path.join(BACKEND, "google_calendar.py"), encoding="utf-8").read()
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "create_calendar_event":
            body = ast.get_source_segment(source, node)
            print("create_calendar_event:")
            print("  hora construída com datetime.fromisoformat(data + ' ' + hora) (hora local, sem conversão para UTC):",
                  "sim" if "fromisoformat" in body and "utc" not in body.lower().replace("timezone", "") else "VERIFICAR")
            print("  timeZone explícito Europe/Madrid no início e no fim:",
                  "sim" if body.count('"timeZone": "Europe/Madrid"') >= 2 else "NÃO")
            print("  identificador do evento determinístico (id/extendedProperties):",
                  "sim" if ("extendedProperties" in body or '"id":' in body) else "não (o Google gera um id novo em cada chamada)")

    section("Quem cria eventos de sessões de cliente")
    for path in sorted(glob.glob(os.path.join(BACKEND, "*.py"))):
        name = os.path.basename(path)
        if name.startswith("test_") or name in ("google_calendar.py", "google_calendar_test.py"):
            continue
        text = open(path, encoding="utf-8").read()
        for number, line in enumerate(text.splitlines(), 1):
            if "create_calendar_event(" in line and "def " not in line:
                print(f"  {name}:{number}  {line.strip()}")
    print("  'Renovar pack', 'aprovar pedido' e 'Añadir cliente' passam por packs.create_pack (uma só função).")
    print("  'Asignar plan' (admin_assign_plan) só muda o tipo de pack: NÃO cria sessões nem eventos.")


def _calls_outside_nested_try(statements):
    """Calls in these statements, not counting the ones inside a nested try
    (those belong to the inner handler)."""
    found = set()

    def visit(node):
        if isinstance(node, ast.Try):
            return
        if isinstance(node, ast.Call):
            found.add(node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", ""))
        for child in ast.iter_child_nodes(node):
            visit(child)

    for statement in statements:
        visit(statement)
    return found


def swallowed_exceptions():
    section("Falhas do Google Calendar ignoradas sem registo (análise do código)")
    found = 0
    for path in sorted(glob.glob(os.path.join(BACKEND, "*.py"))):
        name = os.path.basename(path)
        if name.startswith("test_") or name.startswith("smoke_") or name in ("google_calendar.py", "google_calendar_test.py"):
            continue
        text = open(path, encoding="utf-8").read()
        for node in ast.walk(ast.parse(text)):
            if not isinstance(node, ast.Try):
                continue
            touched = _calls_outside_nested_try(node.body) & CALENDAR_CALLS
            if not touched:
                continue
            for handler in node.handlers:
                raises = any(isinstance(n, ast.Raise) for s_ in handler.body for n in ast.walk(s_))
                logs = any(
                    isinstance(n, ast.Call) and (
                        (isinstance(n.func, ast.Name) and n.func.id == "print")
                        or getattr(n.func, "attr", "") in ("print_exc", "error", "exception", "warning", "record")
                    )
                    for s_ in handler.body for n in ast.walk(s_)
                )
                if not raises and not logs:
                    found += 1
                    print(f"  {name}:{handler.lineno}  except sem raise nem registo (chama {', '.join(sorted(touched))})")
    if not found:
        print("  Nenhuma: todos os blocos que chamam o calendário propagam o erro, escrevem um registo ou o guardam na sessão.")


# --------------------------------------------------------------- 4. the grey "Trial Session" blocks
def trial_blocks(days):
    section('Blocos "Trial Session" no calendário')
    first = date.today() - timedelta(days=7)
    last = date.today() + timedelta(days=days)
    events = gc.list_calendar_events(f"{first.isoformat()}T00:00:00Z", f"{last.isoformat()}T00:00:00Z")
    trial = [e for e in events if "trial" in str(e.get("summary") or "").lower()]
    print(f"Eventos com 'trial' no título entre {first} e {last}: {len(trial)} (de {len(events)} eventos no total)")
    if not trial:
        return

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT google_event_id FROM trial_sessions WHERE google_event_id IS NOT NULL")
    ours = {r[0] for r in cur.fetchall()}
    cur.execute("SELECT google_event_id FROM sessions WHERE google_event_id IS NOT NULL")
    ours_sessions = {r[0] for r in cur.fetchall()}
    conn.close()

    groups = Counter()
    for e in trial:
        creator = (e.get("creator") or {}).get("email", "?")
        organizer = (e.get("organizer") or {}).get("email", "?")
        origin = "NOSSO (trial_sessions.google_event_id)" if e["id"] in ours else (
            "nosso (sessions)" if e["id"] in ours_sessions else "NÃO está na nossa base de dados")
        groups[(e.get("summary"), origin, creator, organizer, e.get("eventType", "default"),
                bool(e.get("recurringEventId")))] += 1
    print("\nResumo (título | origem | criador | organizador | eventType | recorrente) -> quantidade")
    for (title, origin, creator, organizer, kind, recurring), amount in groups.most_common():
        print(f"  {title!r} | {origin} | creator={mask(creator, 28)} | organizer={mask(organizer, 28)} | {kind} | {recurring} -> {amount}")

    print("\nPrimeiros exemplos (data início–fim, id mascarado, criado em):")
    for e in trial[:8]:
        start = (e.get("start") or {}).get("dateTime", "")[:16]
        end = (e.get("end") or {}).get("dateTime", "")[11:16]
        print(f"  {start}–{end} | {mask(e['id'], 10)} | criado {str(e.get('created', ''))[:16]} | "
              f"source={'sim' if e.get('source') else 'não'} | extendedProperties={'sim' if e.get('extendedProperties') else 'não'}")


def main():
    parser = argparse.ArgumentParser(description="Compara as sessões da base de dados com o Google Calendar (só leitura).")
    parser.add_argument("--client", help="só sessões cujo cliente contém este texto")
    parser.add_argument("--days", type=int, default=0, help="só os próximos N dias (0 = todas as futuras)")
    parser.add_argument("--no-trials", action="store_true", help="não analisar os blocos 'Trial Session'")
    args = parser.parse_args()

    show_configuration()
    section("Sessões futuras da base de dados contra o calendário")
    compare_sessions(load_sessions(args.client), args.days)
    code_review()
    swallowed_exceptions()
    if not args.no_trials:
        trial_blocks(args.days or 200)
    print("\n(Só leitura: nada foi criado, alterado nem apagado.)")


if __name__ == "__main__":
    main()
