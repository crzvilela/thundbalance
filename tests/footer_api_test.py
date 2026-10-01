"""Transaction tests without importing startup services or connecting to a database.

Run with: python -m unittest discover -s tests -p '*_test.py'
"""
import ast
import copy
from pathlib import Path
from types import SimpleNamespace
import unittest


class HttpError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


class Connection:
    def __init__(self, versions, fail=False):
        self.versions = versions
        self.writes = {}
        self.committed = False
        self.rolled_back = False
        self.closed = False
        self.fail = fail

    def cursor(self):
        return self

    def execute(self, sql, args=None):
        if sql.startswith('INSERT'):
            if self.fail:
                raise RuntimeError('Database unavailable')
            self.writes[args[0]] = args[1]

    def fetchall(self):
        return list(self.versions.items())

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class FooterApiTests(unittest.TestCase):
    def setUp(self):
        source = ast.parse((Path(__file__).resolve().parents[1] / 'backend/main.py').read_text(encoding='utf-8'))
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'save_footer_content')
        function.decorator_list = []
        self.function = compile(ast.Module(body=[function], type_ignores=[]), '<footer endpoint>', 'exec')
        self.previous = {'contactEmail': 'before@example.com'}
        self.versions = {version: {'sections': {'footer': copy.deepcopy(self.previous), 'hero': {'title': version}}} for version in ('draft', 'published')}

    def run_save(self, connection, previous=None):
        namespace = {'get_connection': lambda: connection, 'FooterContentPayload': object,
                     'DEFAULT_LANDING_CONTENT': {}, 'HTTPException': HttpError, 'PgJson': lambda value: value}
        exec(self.function, namespace)
        return namespace['save_footer_content'](SimpleNamespace(footer={'contactEmail': 'after@example.com'}, previous_footer=self.previous if previous is None else previous))

    def test_only_footer_changes_in_both_versions(self):
        connection = Connection(self.versions)
        self.run_save(connection)
        self.assertTrue(connection.committed)
        for version in ('draft', 'published'):
            self.assertEqual(connection.writes[version]['sections']['hero']['title'], version)
            self.assertEqual(connection.writes[version]['sections']['footer']['contactEmail'], 'after@example.com')
        self.assertTrue(connection.closed)

    def test_stale_footer_cannot_overwrite_newer_version(self):
        connection = Connection(self.versions)
        with self.assertRaises(HttpError) as error:
            self.run_save(connection, {})
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(connection.writes, {})
        self.assertTrue(connection.rolled_back)

    def test_failed_write_rolls_back(self):
        connection = Connection(self.versions, fail=True)
        with self.assertRaises(RuntimeError):
            self.run_save(connection)
        self.assertFalse(connection.committed)
        self.assertTrue(connection.rolled_back)
        self.assertTrue(connection.closed)


if __name__ == '__main__':
    unittest.main()
