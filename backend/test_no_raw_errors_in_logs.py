"""No traceback and no raw error text in the logs (or in the "error" of an answer) of any backend file.

    python -m unittest test_no_raw_errors_in_logs -v

An exception can carry the values of the row or the address it was working on (psycopg2: "Failing row contains (...)"), so only
its TYPE may be written (safe_log.safe_error / log_error). This test reads the source of every backend module and fails when one
prints a traceback, logs an exception variable as it is, or sends str(error) back in an "error" field.
"""
import ast
import os
import unittest

BACKEND = os.path.dirname(os.path.abspath(__file__))
SKIP_DIRS = {"scripts", "venv", "__pycache__", "uploads", "email_previews"}
SKIP_PREFIXES = ("test_", "smoke_", "send_test", "preview_emails", "reset_test_data")
LOG_METHODS = {"debug", "info", "warning", "error", "critical", "exception", "log"}
FORBIDDEN_CALLS = {("traceback", "print_exc"), ("traceback", "format_exc"), ("traceback", "print_exception"), ("traceback", "format_exception")}


def backend_files():
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS]
        for name in files:
            if name.endswith(".py") and not name.startswith(SKIP_PREFIXES) and name != "safe_log.py":
                yield os.path.join(root, name)


def exception_names(tree):
    return {node.name for node in ast.walk(tree) if isinstance(node, ast.ExceptHandler) and node.name}


def is_raw(node, names):
    """True when the expression is an exception variable as it is, or str(it), or an f-string that holds one."""
    if isinstance(node, ast.Name) and node.id in names:
        return True
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("str", "repr") and node.args:
        return is_raw(node.args[0], names)
    if isinstance(node, ast.Subscript):                                   # str(e)[:200]
        return is_raw(node.value, names)
    if isinstance(node, ast.JoinedStr):
        return any(isinstance(part, ast.FormattedValue) and is_raw(part.value, names) for part in node.values)
    if isinstance(node, ast.BinOp):                                        # "..." % e   /   "..." + str(e)
        return is_raw(node.left, names) or is_raw(node.right, names)
    return False


def problems_of(path):
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    tree = ast.parse(source)
    names = exception_names(tree)
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        owner = func.value.id if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) else None
        method = func.attr if isinstance(func, ast.Attribute) else (func.id if isinstance(func, ast.Name) else None)
        if (owner, method) in FORBIDDEN_CALLS:
            found.append((node.lineno, f"{owner}.{method}() writes a traceback"))
        if method == "exception" and owner in ("logger", "logging", "log"):
            found.append((node.lineno, "logger.exception() writes a traceback"))
        for keyword in node.keywords:
            if keyword.arg == "exc_info":
                found.append((node.lineno, "exc_info writes a traceback"))
        is_log = (owner in ("logger", "logging", "log", "_logger") and method in LOG_METHODS) or (owner is None and method == "print")
        if is_log and any(is_raw(argument, names) for argument in node.args):
            found.append((node.lineno, "an error is logged as it is (use safe_log.log_error / safe_error)"))
        if is_log and any(is_raw(keyword.value, names) for keyword in node.keywords if keyword.arg not in ("exc_info",)):
            found.append((node.lineno, "an error is logged as it is (use safe_log.log_error / safe_error)"))
    for node in ast.walk(tree):                                           # {"error": str(e)} sent back to the client
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value == "error" and is_raw(value, names):
                    found.append((node.lineno, 'the text of an error is sent back in an "error" field'))
    return found


class NoRawErrors(unittest.TestCase):
    def test_no_backend_file_logs_a_traceback_or_an_error_in_the_raw(self):
        report = []
        for path in backend_files():
            for line, why in problems_of(path):
                report.append(f"{os.path.relpath(path, BACKEND)}:{line}: {why}")
        self.assertEqual(report, [], "\n".join(report))

    def test_the_checker_itself_catches_the_bad_patterns(self):
        bad = (
            "import logging, traceback\nlogger = logging.getLogger('x')\n"
            "def a():\n    try:\n        pass\n    except Exception as e:\n"
            "        traceback.print_exc()\n"
            "        logger.error('failed: %s', e)\n"
            "        logger.error(f'failed {e}')\n"
            "        logger.warning('x %s', str(e)[:100])\n"
            "        print(e)\n"
            "        logger.exception('boom')\n"
            "        return {'error': str(e)}\n"
        )
        good = (
            "import logging\nfrom safe_log import log_error, safe_error\nlogger = logging.getLogger('x')\n"
            "def a():\n    try:\n        pass\n    except Exception as e:\n"
            "        log_error(e)\n        logger.error('failed (%s)', type(e).__name__)\n        return {'error': safe_error(e)}\n"
        )
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            for name, source, expected in (("bad.py", bad, 7), ("good.py", good, 0)):
                path = os.path.join(folder, name)
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(source)
                self.assertEqual(len(problems_of(path)), expected, name)

    def test_safe_error_gives_only_the_type(self):
        import safe_log
        self.assertEqual(safe_error_of(ValueError("a@b.com")), "ValueError")
        self.assertEqual(safe_log.safe_error(None), "unknown")


def safe_error_of(error):
    import safe_log
    return safe_log.safe_error(error)


class LogOutput(unittest.TestCase):
    def test_log_error_writes_the_type_and_the_function_but_never_the_message(self):
        import logging
        import safe_log

        class Capture(logging.Handler):
            def __init__(self):
                super().__init__()
                self.lines = []

            def emit(self, record):
                self.lines.append(record.getMessage())

        capture = Capture()
        logging.getLogger("thundbalance.errors").addHandler(capture)
        try:
            def the_function():
                try:
                    raise ValueError("Failing row contains (ana@example.com, 600111222)")
                except ValueError as error:
                    safe_log.log_error(error)
            the_function()
        finally:
            logging.getLogger("thundbalance.errors").removeHandler(capture)
        self.assertEqual(capture.lines, ["op=the_function error=ValueError"])


if __name__ == "__main__":
    unittest.main()
