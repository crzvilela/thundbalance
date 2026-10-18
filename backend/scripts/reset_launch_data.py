"""Limpa os dados de clientes para lancar o site de novo (DESTRUTIVO).

    python scripts/reset_launch_data.py                      # SIMULACAO (nao escreve nada)
    python scripts/reset_launch_data.py --admin-email X      # idem, indicando o admin
    python scripts/reset_launch_data.py --execute --confirm "RESET THUNDBALANCE" --db-name NOME

O QUE APAGA
  - clientes (utilizadores que nao sao o admin) e as suas contas no Firebase;
  - sessions, user_plans, client_requests, trial_sessions, email_log e as linhas
    de admin_audit_log ligadas a clientes;
  - com --purge-calendar: os eventos que a APP criou no calendario configurado.
  - reinicia os ids (sequencias) das tabelas que ficam vazias.

O QUE MANTEM
  - o admin (Postgres e Firebase), trainers, trainer_availability, plans,
    landing_page_content, training_videos, app_settings.
  - qualquer tabela que o script nao saiba classificar: so a lista, nao a toca.
  - contact_messages: so se pedir --delete-contact-messages.

SEGURANCA
  - sem --execute so imprime o plano (contagens, nunca dados pessoais);
  - --execute exige --confirm "RESET THUNDBALANCE" e --db-name igual ao nome
    real da base de dados;
  - antes de apagar escreve CSV (com dados pessoais!) numa pasta FORA do
    repositorio; se o backup falhar nao apaga nada;
  - Postgres numa unica transacao; Firebase e calendario depois, em lotes.

A base de dados e o calendario sao os da maquina onde corre: DATABASE_URL (se
existir; senao a base local) e GOOGLE_CALENDAR_ID / GOOGLE_CREDENTIALS_JSON.
"""
import argparse
import csv
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

import database  # noqa: E402

CONFIRM_TEXT = "RESET THUNDBALANCE"
DEFAULT_BACKUP_ROOT = r"C:\Segredos\backups"

# Filhos primeiro, para que as chaves estrangeiras nunca bloqueiem.
DELETE_TABLES = ["reschedule_requests", "sessions", "client_requests", "user_plans", "trial_sessions", "email_log", "admin_audit_log"]
KEEP_TABLES = ["trainers", "trainer_availability", "plans", "landing_page_content", "training_videos", "app_settings"]
OPTIONAL_TABLES = ["contact_messages"]
# O que identifica as linhas "ligadas a clientes" nas tabelas parcialmente apagadas.
PARTIAL_WHERE = {"admin_audit_log": "client_id IS NOT NULL"}

# Titulos que a app usa (para eventos antigos sem a etiqueta app=thundbalance).
LEGACY_TITLES = [
    re.compile(r"^\S.*\s\d+/\d+$"),                  # "Nome Sobrenome 3/12"
    re.compile(r"^(\[Pendiente\]\s*)?Trial Session\b", re.IGNORECASE),
    re.compile(r"^TRIAL\b"),
]
APP_PROPERTY, APP_VALUE = "app", "thundbalance"


class Abort(Exception):
    """A razao e para a pessoa; o script sai sem apagar nada."""


# --------------------------------------------------------------------------- helpers
def mask_email(email):
    email = str(email or "")
    if "@" not in email:
        return "***"
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}"


def mask_host(host):
    host = str(host or "")
    if len(host) <= 14:
        return host[:2] + "***"
    return f"{host[:4]}...{host[-10:]}"


def describe_environment():
    """(ambiente, host mascarado). Sem DATABASE_URL e a base local de desenvolvimento."""
    url = os.getenv("DATABASE_URL", "")
    if not url:
        return "LOCAL (base de desenvolvimento)", "localhost"
    host = urlparse(url).hostname or "?"
    local = host in ("localhost", "127.0.0.1", "::1")
    return ("LOCAL (DATABASE_URL local)" if local else "REMOTO / PRODUCAO (DATABASE_URL)"), mask_host(host)


def resolve_admin(cli_value):
    env = os.getenv("ADMIN_EMAIL", "").strip().casefold()
    cli = (cli_value or "").strip().casefold()
    if env and cli and env != cli:
        raise Abort("O ADMIN_EMAIL do ambiente e o --admin-email sao diferentes: criterio ambiguo. "
                    "Indique so um deles.")
    admin = cli or env
    if not admin:
        raise Abort(
            "Nao sei qual e o admin. O painel reconhece o admin pelo email igual a ADMIN_EMAIL "
            "(backend/main.py). Defina a variavel ADMIN_EMAIL ou passe --admin-email <email do admin>."
        )
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", admin):
        raise Abort("O email do admin nao parece valido.")
    return admin


def table_exists(cursor, name):
    cursor.execute("SELECT to_regclass(%s) IS NOT NULL", (f"public.{name}",))
    return cursor.fetchone()[0]


def count(cursor, table, where="", params=()):
    if not table_exists(cursor, table):
        return None
    cursor.execute(f"SELECT COUNT(*) FROM {table}" + (f" WHERE {where}" if where else ""), params)
    return cursor.fetchone()[0]


def all_tables(cursor):
    cursor.execute("SELECT table_name FROM information_schema.tables "
                   "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")
    return [row[0] for row in cursor.fetchall()]


# --------------------------------------------------------------------------- plano
def gather_plan(cursor, admin, include_contact):
    cursor.execute("SELECT current_database()")
    plan = {"database": cursor.fetchone()[0], "admin": admin}

    plan["delete"] = {}
    for table in DELETE_TABLES:
        plan["delete"][table] = count(cursor, table, PARTIAL_WHERE.get(table, ""))
    plan["clients"] = count(cursor, "users", "LOWER(email) IS DISTINCT FROM %s", (admin,))
    plan["optional"] = {name: count(cursor, name) for name in OPTIONAL_TABLES}
    plan["include_contact"] = include_contact

    plan["keep"] = {"users (admin)": count(cursor, "users", "LOWER(email) = %s", (admin,))}
    for table in KEEP_TABLES:
        plan["keep"][table] = count(cursor, table)

    known = set(DELETE_TABLES) | set(KEEP_TABLES) | set(OPTIONAL_TABLES) | {"users"}
    plan["unclassified"] = {name: count(cursor, name) for name in all_tables(cursor) if name not in known}

    cursor.execute(
        "SELECT firebase_uid FROM users WHERE LOWER(email) IS DISTINCT FROM %s "
        "AND firebase_uid IS NOT NULL AND firebase_uid <> ''", (admin,))
    plan["client_uids"] = sorted({row[0] for row in cursor.fetchall()})
    cursor.execute("SELECT firebase_uid FROM users WHERE LOWER(email) = %s "
                   "AND firebase_uid IS NOT NULL AND firebase_uid <> ''", (admin,))
    plan["admin_uids"] = {row[0] for row in cursor.fetchall()}
    plan["client_uids"] = [uid for uid in plan["client_uids"] if uid not in plan["admin_uids"]]
    return plan


def show(value):
    return "(tabela nao existe)" if value is None else str(value)


def print_plan(plan, environment, host, firebase_info, calendar_info, purge, skip_firebase):
    print("=" * 66)
    print(f"Base de dados : {plan['database']}   host: {host}")
    print(f"Ambiente      : {environment}")
    print(f"Admin mantido : {mask_email(plan['admin'])}")
    print("=" * 66)
    print("\nVAI APAGAR (linhas):")
    print(f"  {'users (clientes)':<26} {show(plan['clients'])}")
    for table, value in plan["delete"].items():
        note = "  (so as ligadas a clientes)" if table in PARTIAL_WHERE else ""
        print(f"  {table:<26} {show(value)}{note}")
    for name, value in plan["optional"].items():
        state = "apagar (--delete-contact-messages)" if plan["include_contact"] else "NAO tocada (use --delete-contact-messages)"
        print(f"  {name:<26} {show(value)}  -> {state}")

    print("\nVAI MANTER (linhas):")
    for table, value in plan["keep"].items():
        print(f"  {table:<26} {show(value)}")
    if plan["unclassified"]:
        print("\nTABELAS NAO CLASSIFICADAS (nao serao tocadas; diga-me o que fazer com elas):")
        for name, value in plan["unclassified"].items():
            print(f"  {name:<26} {show(value)}")

    print("\nFIREBASE:")
    print(f"  contas de clientes a apagar : {len(plan['client_uids'])}" + ("   (--skip-firebase: NAO serao apagadas)" if skip_firebase else ""))
    for line in firebase_info:
        print(f"  {line}")
    print("\nCALENDARIO:")
    if not purge:
        print("  nao sera tocado (sem --purge-calendar)")
    for line in calendar_info:
        print(f"  {line}")
    print()


# --------------------------------------------------------------------------- Firebase
class FirebaseGateway:
    """Tudo o que o script faz no Firebase Authentication."""

    def ready(self):
        import firebase_accounts
        return firebase_accounts.init_firebase_admin()

    def existing(self, uids):
        """{uid: email} das contas que existem (em lotes de 100)."""
        from firebase_admin import auth
        found = {}
        for start in range(0, len(uids), 100):
            chunk = uids[start:start + 100]
            result = auth.get_users([auth.UidIdentifier(uid) for uid in chunk])
            for user in result.users:
                found[user.uid] = (user.email or "").strip().casefold()
        return found

    def total_accounts(self):
        from firebase_admin import auth
        return sum(1 for _ in auth.list_users().iterate_all())

    def delete(self, uids):
        """(apagadas, falhadas). Uma conta que ja nao existe conta como sucesso."""
        from firebase_admin import auth
        deleted = failed = 0
        for start in range(0, len(uids), 1000):
            chunk = uids[start:start + 1000]
            result = auth.delete_users(chunk)
            deleted += result.success_count
            for error in result.errors:
                try:
                    auth.delete_user(chunk[error.index])
                    deleted += 1
                except auth.UserNotFoundError:
                    deleted += 1
                except Exception:  # noqa: BLE001
                    failed += 1
        return deleted, failed


def make_firebase():
    return FirebaseGateway()


# --------------------------------------------------------------------------- calendario
def classify_event(event, own_email):
    """'tagged' (etiqueta da app), 'legacy' (criado pela conta de servico com
    um titulo da app) ou None (nunca apagar: foi criado por uma pessoa)."""
    private = (event.get("extendedProperties") or {}).get("private") or {}
    if private.get(APP_PROPERTY) == APP_VALUE:
        return "tagged"
    creator = ((event.get("creator") or {}).get("email") or "").strip().casefold()
    if own_email and creator == own_email.strip().casefold():
        title = str(event.get("summary") or "").strip()
        if any(pattern.match(title) for pattern in LEGACY_TITLES):
            return "legacy"
    return None


class CalendarGateway:
    def __init__(self):
        import google_calendar
        self.gc = google_calendar
        self.calendar_id = google_calendar.get_calendar_id()      # CalendarNotConfigured se faltar
        credentials = google_calendar.load_credentials()
        self.own_email = getattr(credentials, "service_account_email", "") or ""
        self.service = google_calendar.build("calendar", "v3", credentials=credentials)

    def target(self):
        return self.gc.mask_calendar_id(self.calendar_id)

    def list_events(self):
        events, token = [], None
        while True:
            response = self.service.events().list(
                calendarId=self.calendar_id, maxResults=250, pageToken=token, showDeleted=False,
                fields="nextPageToken,items(id,summary,start,creator,extendedProperties)",
            ).execute()
            events.extend(response.get("items", []))
            token = response.get("nextPageToken")
            if not token:
                return events

    def delete(self, event_ids):
        """(apagados, falhados). Um evento que ja nao existe (404/410) e sucesso."""
        deleted = failed = 0
        for index, event_id in enumerate(event_ids):
            for attempt in range(4):
                try:
                    self.service.events().delete(calendarId=self.calendar_id, eventId=event_id).execute()
                    deleted += 1
                    break
                except Exception as error:  # noqa: BLE001
                    status = self.gc.http_status(error)
                    if status in (404, 410):
                        deleted += 1
                        break
                    if status in (403, 429) and attempt < 3:
                        time.sleep(2 ** attempt)
                        continue
                    failed += 1
                    break
            if index % 50 == 49:
                time.sleep(0.5)
        return deleted, failed


def make_calendar():
    return CalendarGateway()


# --------------------------------------------------------------------------- backup
def backup_directory(requested):
    path = os.path.abspath(requested or os.path.join(DEFAULT_BACKUP_ROOT, f"reset_{datetime.now():%Y%m%d_%H%M%S}"))
    repo = os.path.normcase(os.path.abspath(REPO))
    if os.path.normcase(path) == repo or os.path.normcase(path).startswith(repo + os.sep):
        raise Abort("A pasta de backup tem de ficar FORA do repositorio (os CSV tem dados pessoais).")
    if os.path.isdir(path) and os.listdir(path):
        raise Abort("A pasta de backup ja existe e nao esta vazia.")
    return path


def write_backup(cursor, plan, directory, include_contact, calendar_events):
    """Um CSV por tabela a apagar. Devolve [(ficheiro, linhas)]. Qualquer falha levanta Abort."""
    admin = plan["admin"]
    jobs = [("users.csv", "SELECT * FROM users WHERE LOWER(email) IS DISTINCT FROM %s", (admin,), plan["clients"])]
    for table in DELETE_TABLES:
        if plan["delete"][table] is None:
            continue
        where = f" WHERE {PARTIAL_WHERE[table]}" if table in PARTIAL_WHERE else ""
        jobs.append((f"{table}.csv", f"SELECT * FROM {table}{where}", (), plan["delete"][table]))
    if include_contact and plan["optional"].get("contact_messages") is not None:
        jobs.append(("contact_messages.csv", "SELECT * FROM contact_messages", (), plan["optional"]["contact_messages"]))

    try:
        os.makedirs(directory, exist_ok=True)
    except OSError as error:
        raise Abort(f"Nao consegui criar a pasta de backup ({type(error).__name__}).") from None

    written = []
    for name, query, params, expected in jobs:
        path = os.path.join(directory, name)
        try:
            sql = cursor.mogrify(query, params).decode("utf-8")
            with open(path, "w", encoding="utf-8", newline="") as handle:
                cursor.copy_expert(f"COPY ({sql}) TO STDOUT WITH CSV HEADER", handle)
            with open(path, "r", encoding="utf-8", newline="") as handle:
                rows = max(sum(1 for _ in csv.reader(handle)) - 1, 0)
        except Exception as error:  # noqa: BLE001
            raise Abort(f"Backup falhou em {name} ({type(error).__name__}). Nada foi apagado.") from None
        if rows != expected:
            raise Abort(f"Backup de {name} nao confere ({rows} linhas escritas, {expected} esperadas). Nada foi apagado.")
        written.append((name, rows))

    if calendar_events is not None:
        path = os.path.join(directory, "calendar_events.csv")
        try:
            with open(path, "w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "summary", "start", "kind"])
                for event, kind in calendar_events:
                    start = event.get("start") or {}
                    writer.writerow([event.get("id"), event.get("summary"), start.get("dateTime") or start.get("date"), kind])
        except Exception as error:  # noqa: BLE001
            raise Abort(f"Backup do calendario falhou ({type(error).__name__}). Nada foi apagado.") from None
        written.append(("calendar_events.csv", len(calendar_events)))
    return written


# --------------------------------------------------------------------------- executar
def reset_database(conn, plan, include_contact):
    """Tudo ou nada: uma transacao."""
    cursor = conn.cursor()
    try:
        for table in DELETE_TABLES:
            if plan["delete"][table] is None:
                continue
            where = f" WHERE {PARTIAL_WHERE[table]}" if table in PARTIAL_WHERE else ""
            cursor.execute(f"DELETE FROM {table}{where}")
        if include_contact and plan["optional"].get("contact_messages") is not None:
            cursor.execute("DELETE FROM contact_messages")
        cursor.execute("DELETE FROM users WHERE LOWER(email) IS DISTINCT FROM %s", (plan["admin"],))

        emptied = [t for t in DELETE_TABLES if plan["delete"][t] is not None]
        if include_contact and plan["optional"].get("contact_messages") is not None:
            emptied.append("contact_messages")
        for table in emptied:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            if cursor.fetchone()[0]:
                continue                                  # ficou algo (ex.: auditoria do admin): nao reiniciar
            cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", (table,))
            sequence = cursor.fetchone()[0]
            if sequence:
                cursor.execute("SELECT setval(%s, 1, false)", (sequence,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()


def retry_firebase_from_backup(args, admin):
    """Acaba de apagar as contas Firebase a partir do users.csv de um backup
    (se o Firebase falhou depois de a base de dados ter sido limpa)."""
    path = os.path.join(os.path.abspath(args.retry_firebase_from), "users.csv")
    if not os.path.isfile(path):
        raise Abort("users.csv nao existe nessa pasta de backup.")
    with open(path, "r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    uids = sorted({row.get("firebase_uid", "").strip() for row in rows
                   if row.get("firebase_uid", "").strip() and row.get("email", "").strip().casefold() != admin})
    firebase = make_firebase()
    ready, reason = firebase.ready()
    if not ready:
        raise Abort(f"Firebase Admin nao esta pronto ({reason}).")
    existing = firebase.existing(uids)
    safe = [uid for uid in uids if existing.get(uid, None) != admin]
    deleted, failed = firebase.delete(safe)
    print(f"Firebase: {deleted} contas apagadas (ou ja inexistentes), {failed} falhadas.")
    return 0 if not failed else 2


def verify(conn, before, after, admin):
    problems = []
    for table, value in before["keep"].items():
        if after["keep"].get(table) != value:
            problems.append(f"{table}: {value} -> {after['keep'].get(table)}")
    if after["clients"]:
        problems.append(f"ainda ha {after['clients']} clientes em users")
    for table in DELETE_TABLES:
        left = after["delete"][table]
        if left:
            problems.append(f"{table}: ficaram {left} linhas")
    return problems


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--execute", action="store_true", help="apaga mesmo (por omissao e so simulacao)")
    parser.add_argument("--confirm", default="", help=f'escrever exatamente: {CONFIRM_TEXT}')
    parser.add_argument("--db-name", default="", help="nome real da base de dados, escrito de novo")
    parser.add_argument("--admin-email", default="", help="email do admin (senao usa ADMIN_EMAIL)")
    parser.add_argument("--purge-calendar", action="store_true", help="apaga do calendario so os eventos criados pela app")
    parser.add_argument("--delete-contact-messages", action="store_true", help="tambem apaga contact_messages")
    parser.add_argument("--skip-firebase", action="store_true", help="nao apaga contas Firebase (ficam orfas!)")
    parser.add_argument("--backup-dir", default="", help=f"pasta do backup (fora do repo); por omissao {DEFAULT_BACKUP_ROOT}")
    parser.add_argument("--retry-firebase-from", default="", help="so apaga as contas Firebase a partir do users.csv de um backup")
    args = parser.parse_args(argv)

    try:
        admin = resolve_admin(args.admin_email)
        if args.retry_firebase_from:
            if args.confirm != CONFIRM_TEXT:
                raise Abort(f'Falta --confirm "{CONFIRM_TEXT}".')
            return retry_firebase_from_backup(args, admin)
        return run(args, admin)
    except Abort as stop:
        print(f"\nABORTADO: {stop}")
        print("Nada foi apagado.")
        return 1


def run(args, admin):
    environment, host = describe_environment()
    conn = database.get_connection()
    cursor = conn.cursor()
    try:
        plan = gather_plan(cursor, admin, args.delete_contact_messages)
        if plan["clients"] is None:
            raise Abort("A tabela users nao existe nesta base de dados.")

        # ---- o que o Firebase e o calendario dizem (so leitura)
        firebase_info, firebase = [], None
        if plan["client_uids"] and not args.skip_firebase:
            firebase = make_firebase()
            ready, reason = firebase.ready()
            if ready:
                existing = firebase.existing(plan["client_uids"])
                firebase_info.append(f"dessas, existem no Firebase     : {len(existing)}")
                if any(email == admin for email in existing.values()):
                    raise Abort("Uma das contas de clientes tem o email do admin: criterio ambiguo.")
                try:
                    unlinked = firebase.total_accounts() - len(existing) - len(plan["admin_uids"])
                    firebase_info.append(f"contas no Firebase sem linha em users (nao tocadas, inclui o admin): {max(unlinked, 0)}")
                except Exception:  # noqa: BLE001
                    pass
            else:
                firebase_info.append(f"Firebase Admin NAO esta pronto ({reason}): nao da para apagar contas")

        calendar_info, calendar, events = [], None, None
        if args.purge_calendar:
            try:
                calendar = make_calendar()
                calendar_info.append(f"calendario configurado (mascarado): {calendar.target()}")
                listed = calendar.list_events()
                events = [(event, classify_event(event, calendar.own_email)) for event in listed]
                events = [(event, kind) for event, kind in events if kind]
                tagged = sum(1 for _, kind in events if kind == "tagged")
                calendar_info.append(f"eventos no calendario           : {len(listed)}")
                calendar_info.append(f"a apagar (criados pela app)      : {len(events)}  (com etiqueta: {tagged}, por titulo: {len(events) - tagged})")
                calendar_info.append(f"mantidos (criados por pessoas)   : {len(listed) - len(events)}")
            except Exception as error:  # noqa: BLE001
                raise Abort(f"Nao consegui ler o calendario ({type(error).__name__}): {str(error)[:120]}") from None

        print_plan(plan, environment, host, firebase_info, calendar_info, args.purge_calendar, args.skip_firebase)

        if plan["unclassified"]:
            print("ATENCAO: ha tabelas nao classificadas (acima). Foram deixadas como estao.\n")

        if not args.execute:
            print("SIMULACAO: nada foi alterado.")
            print(f'Para executar: --execute --confirm "{CONFIRM_TEXT}" --db-name {plan["database"]}')
            return 0

        # ---- validacoes antes de apagar
        if args.confirm != CONFIRM_TEXT:
            raise Abort(f'Falta --confirm "{CONFIRM_TEXT}" (exatamente assim).')
        if args.db_name.strip() != plan["database"]:
            raise Abort("O --db-name nao e o nome da base de dados a que estou ligado "
                        f"(ligado a: {plan['database']}).")
        if plan["client_uids"] and not args.skip_firebase:
            ready, reason = firebase.ready()
            if not ready:
                raise Abort(f"Firebase Admin nao esta pronto ({reason}): configure FIREBASE_CREDENTIALS_PATH "
                            "ou use --skip-firebase (as contas ficariam orfas).")

        # ---- backup (se falhar, nao apaga nada)
        directory = backup_directory(args.backup_dir)
        written = write_backup(cursor, plan, directory, args.delete_contact_messages, events)
        print("BACKUP escrito em: " + directory)
        for name, rows in written:
            print(f"  {name:<24} {rows} linhas")
        print("  AVISO: estes CSV contem DADOS PESSOAIS. Guarde-os em local seguro e apague-os quando nao forem precisos.\n")

        # ---- 1) Postgres, tudo ou nada
        try:
            reset_database(conn, plan, args.delete_contact_messages)
        except Exception as error:  # noqa: BLE001
            print(f"ERRO na base de dados ({type(error).__name__}): a transacao foi revertida, nada foi apagado.")
            return 1
        print("Base de dados: limpa (transacao concluida).")

        failures = 0
        # ---- 2) Firebase
        if plan["client_uids"] and not args.skip_firebase:
            existing = firebase.existing(plan["client_uids"])
            safe = [uid for uid in plan["client_uids"] if existing.get(uid) != admin]
            deleted, failed = firebase.delete(safe)
            failures += failed
            print(f"Firebase: {deleted} contas apagadas (ou ja inexistentes), {failed} falhadas.")
            if failed:
                print(f'  Para repetir so o Firebase: --retry-firebase-from "{directory}" --confirm "{CONFIRM_TEXT}"')
        elif plan["client_uids"]:
            print(f"Firebase: NAO apagado (--skip-firebase); {len(plan['client_uids'])} contas ficam orfas.")

        # ---- 3) Calendario
        if events is not None:
            deleted, failed = calendar.delete([event["id"] for event, _ in events])
            failures += failed
            print(f"Calendario: {deleted} eventos apagados (ou ja inexistentes), {failed} falhados.")
            if failed:
                print("  Repita o comando com --purge-calendar para tentar os que faltam.")

        # ---- verificacao
        after = gather_plan(cursor, admin, args.delete_contact_messages)
        conn.rollback()
        print("\nSITUACAO FINAL:")
        print(f"  {'users (clientes)':<26} {after['clients']}")
        for table, value in after["delete"].items():
            print(f"  {table:<26} {show(value)}")
        for table, value in after["keep"].items():
            print(f"  {table:<26} {show(value)}   (antes: {show(plan['keep'][table])})")
        problems = verify(conn, plan, after, admin)
        if problems:
            print("\nPROBLEMAS NA VERIFICACAO:")
            for item in problems:
                print(f"  - {item}")
            return 3
        print("\nOK: o admin, os entrenadores, os planos, a landing page e os videos ficaram intactos.")
        return 2 if failures else 0
    finally:
        try:
            cursor.close()
            conn.close()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit("Cancelado.")
