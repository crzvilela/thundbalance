"""get_connection() reuses connections (opening one to a remote database costs about a second):

    python -m unittest test_database_pool -v

Uses the local database; the table it creates is removed.
"""
import time
import unittest

import psycopg2

import database
from database import PooledConnection, get_connection


class Pool(unittest.TestCase):
    def setUp(self):
        database._drop_idle()
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS pool_test (id INTEGER)")
        cur.execute("DELETE FROM pool_test")
        conn.commit()
        conn.close()

    def tearDown(self):
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("DROP TABLE IF EXISTS pool_test")
        conn.commit()
        conn.close()
        database._drop_idle()

    def test_a_closed_connection_is_the_next_one_handed_out(self):
        first = get_connection()
        raw = first._raw
        first.close()
        second = get_connection()
        self.assertIsInstance(second, PooledConnection)
        self.assertIs(second._raw, raw)                              # reused: no new login
        second.close()

    def test_closing_twice_does_nothing_and_a_closed_connection_can_not_be_used(self):
        conn = get_connection()
        raw = conn._raw
        conn.close()
        conn.close()                                                 # the second close must not hand the connection back again
        self.assertEqual(sum(1 for item, _ in database._idle if item is raw), 1)
        self.assertTrue(conn.closed)
        with self.assertRaises(psycopg2.InterfaceError):
            conn.cursor()                                            # it may belong to somebody else by now

    def test_an_unfinished_transaction_is_rolled_back_when_it_goes_back(self):
        conn = get_connection()
        conn.cursor().execute("INSERT INTO pool_test VALUES (1)")    # never committed
        conn.close()
        again = get_connection()
        cur = again.cursor()
        cur.execute("SELECT COUNT(*) FROM pool_test")
        self.assertEqual(cur.fetchone()[0], 0)
        again.close()

    def test_commit_and_with_work_like_the_plain_connection(self):
        conn = get_connection()
        with conn:
            conn.cursor().execute("INSERT INTO pool_test VALUES (2)")
        conn.close()
        other = get_connection()
        cur = other.cursor()
        cur.execute("SELECT id FROM pool_test")
        self.assertEqual(cur.fetchall(), [(2,)])
        other.close()

    def test_a_connection_the_server_closed_is_replaced(self):
        conn = get_connection()
        raw = conn._raw
        conn.close()
        killer = psycopg2.connect(**{key: value for key, value in raw.get_dsn_parameters().items() if key in ("host", "dbname", "user", "port")},
                                  password=database.os.getenv("DB_PASSWORD", "123456")) if not database.DATABASE_URL else psycopg2.connect(database.DATABASE_URL)
        try:
            killer_cursor = killer.cursor()
            killer_cursor.execute("SELECT pg_terminate_backend(%s)", (raw.get_backend_pid(),))
            killer.commit()
        finally:
            killer.close()
        with database._idle_lock:
            database._idle[:] = [(item, time.time() - database.CHECK_AFTER - 5) for item, _ in database._idle]   # idle long enough to be tested
        fresh = get_connection()
        self.assertIsNot(fresh._raw, raw)                            # the dead one was thrown away, a new one opened
        cur = fresh.cursor()
        cur.execute("SELECT 1")
        self.assertEqual(cur.fetchone()[0], 1)
        fresh.close()

    def test_the_pool_keeps_only_a_few_idle_connections(self):
        connections = [get_connection() for _ in range(database.IDLE_MAX + 3)]
        for conn in connections:
            conn.close()
        self.assertLessEqual(len(database._idle), database.IDLE_MAX)
        self.assertTrue(all(not item.closed for item, _ in database._idle))


if __name__ == "__main__":
    unittest.main()
