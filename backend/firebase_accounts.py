"""Login accounts in Firebase Authentication, created and changed by the server.

The service-account key is read from the file named by FIREBASE_CREDENTIALS_PATH
(a Secret File on Render, a path outside the repository locally). It is never
copied, printed or logged. Passwords live only in Firebase (stored encrypted
there): they are passed through these functions and never written to the
database or to logs.

Firebase Admin is initialised once, at server start (init_firebase_admin), and
the outcome is logged as one line. If the key is missing the server still
starts and every other route keeps working; only the routes that need Firebase
Admin answer 503, naming the reason (never a secret).
"""
import logging
import os
import secrets
import threading

logger = logging.getLogger("thundbalance.accounts")

# 12 characters, without the look-alikes 0 O 1 l I.
UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
LOWER = "abcdefghijkmnopqrstuvwxyz"
DIGITS = "23456789"
PASSWORD_LENGTH = 12

# The only reasons ever reported (log, 503 and health endpoint).
REASON_OK = "ok"
REASON_NO_VARIABLE = "variável em falta"
REASON_NO_FILE = "ficheiro não encontrado"
REASON_BAD_JSON = "JSON inválido"
REASON_NO_PACKAGE = "pacote em falta"
REASON_FAILED = "inicialização falhou"


class AccountsUnavailable(Exception):
    """Firebase Admin is not configured or not installed on this server.
    str(error) is one of the REASON_* texts."""


class EmailAlreadyRegistered(Exception):
    """A Firebase account with this email already exists."""


class AccountError(Exception):
    """Firebase refused or failed (the message never includes secrets)."""


def generate_password():
    """Random password with at least one upper-case letter, one lower-case
    letter and one digit, from secrets (not random)."""
    chars = [secrets.choice(UPPER), secrets.choice(LOWER), secrets.choice(DIGITS)]
    pool = UPPER + LOWER + DIGITS
    chars += [secrets.choice(pool) for _ in range(PASSWORD_LENGTH - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


_lock = threading.Lock()
_app = None
_reason = None          # last reason reported (None = never tried)


def _report(reason):
    """One diagnostic line, only when the outcome changes (no log spam)."""
    global _reason
    if reason == _reason:
        return
    _reason = reason
    line = "Firebase Admin: OK" if reason == REASON_OK else f"Firebase Admin: NÃO inicializado (motivo: {reason})"
    print(line, flush=True)
    logger.info(line)


def init_firebase_admin():
    """Initialises firebase_admin exactly once and returns (ready, reason).

    Safe to call many times and from any thread: after a success it only
    returns; after a failure it checks again (cheap) so a fixed configuration
    is picked up without restarting. Never raises."""
    global _app
    with _lock:
        if _app is not None:
            return True, REASON_OK

        try:
            import firebase_admin
            from firebase_admin import credentials
        except ImportError:
            _report(REASON_NO_PACKAGE)
            return False, REASON_NO_PACKAGE

        path = os.getenv("FIREBASE_CREDENTIALS_PATH", "").strip()
        if not path:
            _report(REASON_NO_VARIABLE)
            return False, REASON_NO_VARIABLE
        if not os.path.isfile(path):
            _report(REASON_NO_FILE)
            return False, REASON_NO_FILE

        try:
            certificate = credentials.Certificate(path)
        except ValueError:
            # unreadable JSON or a JSON that is not a service-account key
            _report(REASON_BAD_JSON)
            return False, REASON_BAD_JSON
        except Exception:  # noqa: BLE001 - never let a bad key stop the server
            _report(REASON_FAILED)
            return False, REASON_FAILED

        try:
            try:
                _app = firebase_admin.get_app()          # already initialised elsewhere
            except ValueError:
                _app = firebase_admin.initialize_app(certificate)
        except Exception:  # noqa: BLE001
            _report(REASON_FAILED)
            return False, REASON_FAILED

        _report(REASON_OK)
        return True, REASON_OK


def status():
    """(ready, reason) for the health endpoint; reason is one of REASON_*."""
    return init_firebase_admin()


def _auth():
    """firebase_admin.auth, initialised (raises AccountsUnavailable otherwise)."""
    ready, reason = init_firebase_admin()
    if not ready:
        raise AccountsUnavailable(reason)
    from firebase_admin import auth
    return auth


def create_login(email, password, display_name):
    """Creates the Firebase account and returns its uid.

    email_verified is set because nothing in the site requires verification
    and the address was given by the admin; the credentials are sent to it."""
    auth = _auth()
    try:
        user = auth.create_user(email=email, password=password, display_name=display_name, email_verified=True)
        return user.uid
    except auth.EmailAlreadyExistsError as error:
        raise EmailAlreadyRegistered(email) from error
    except Exception as error:  # noqa: BLE001
        logger.error("Firebase could not create an account (%s)", type(error).__name__)
        raise AccountError(type(error).__name__) from error


def set_password(uid, password):
    auth = _auth()
    try:
        auth.update_user(uid, password=password)
    except Exception as error:  # noqa: BLE001
        logger.error("Firebase could not update a password (%s)", type(error).__name__)
        raise AccountError(type(error).__name__) from error


def delete_login(uid):
    """Best effort removal (used to roll back); never raises."""
    try:
        _auth().delete_user(uid)
    except Exception as error:  # noqa: BLE001
        logger.error("Firebase account %s could not be removed (%s)", uid, type(error).__name__)
        return False
    return True
