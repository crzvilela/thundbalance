"""The price column of the `plans` table.

The table was created by hand and its price column is `preco_sessao` (price per session); some copies of the
database (and the first version of the admin's plan forms) used `preco`. The code must not guess: it asks the
database which of the known names exists and uses THAT one, so the same code works on every copy and a second,
look-alike column (price / preco / preco_sessao) is never created. Only when the table has NONE of them a
`preco_sessao` column is added (idempotent, also run at startup).
"""
import threading

# the real name first; the others are the names this column has had in some copies of the database
PRICE_COLUMNS = ("preco_sessao", "preco", "price")

_found = None
_lock = threading.Lock()


def price_column(cursor):
    """The name of the price column of `plans` (one of PRICE_COLUMNS), creating `preco_sessao` when the table has
    none. The name only ever comes from PRICE_COLUMNS, so it is safe to put in a query."""
    global _found
    if _found:
        return _found
    with _lock:
        if _found:
            return _found
        cursor.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'plans' AND column_name = ANY(%s)",
            (list(PRICE_COLUMNS),),
        )
        existing = {row[0] for row in cursor.fetchall()}
        for name in PRICE_COLUMNS:
            if name in existing:
                _found = name
                return name
        cursor.execute("ALTER TABLE plans ADD COLUMN IF NOT EXISTS preco_sessao NUMERIC NOT NULL DEFAULT 0")
        _found = "preco_sessao"
        return _found


def forget():
    """For tests: look the column up again."""
    global _found
    _found = None
