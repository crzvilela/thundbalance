"""Login accounts in Firebase Authentication, created and changed by the server.

The service-account key is read from the file named by FIREBASE_CREDENTIALS_PATH
(a Secret File on Render, a path outside the repository locally). It is never
copied, printed or logged. Passwords live only in Firebase (stored encrypted
there): they are passed through these functions and never written to the
database or to logs.
"""
import logging
import os
import secrets

logger = logging.getLogger("thundbalance.accounts")

# 12 characters, without the look-alikes 0 O 1 l I.
UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
LOWER = "abcdefghijkmnopqrstuvwxyz"
DIGITS = "23456789"
PASSWORD_LENGTH = 12


class AccountsUnavailable(Exception):
    """Firebase Admin is not configured or not installed on this server."""


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


_app = None


def _auth():
    """firebase_admin.auth, with the app initialised on first use."""
    global _app
    try:
        import firebase_admin
        from firebase_admin import auth, credentials
    except ImportError as error:
        raise AccountsUnavailable("firebase-admin is not installed") from error
    if _app is None:
        path = os.getenv("FIREBASE_CREDENTIALS_PATH", "").strip()
        if not path or not os.path.isfile(path):
            raise AccountsUnavailable("FIREBASE_CREDENTIALS_PATH is not set or the file is missing")
        try:
            _app = firebase_admin.initialize_app(credentials.Certificate(path))
        except Exception as error:  # noqa: BLE001
            raise AccountsUnavailable(f"The Firebase key could not be loaded ({type(error).__name__})") from error
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
