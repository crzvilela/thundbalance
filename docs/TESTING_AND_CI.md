# Tests, CI and dependencies

## What runs on every push (GitHub Actions, `.github/workflows/ci.yml`)

* **Frontend**: `npm ci`, `npm run lint` (eslint), `node --test "src/**/*.test.js"` and `npm run build`. Then, without stopping the build, `npm audit --omit=dev --audit-level=high`.
* **Backend**: a PostgreSQL 17 service container, the base tables and the minimum data (`backend/ci/schema.sql` + `backend/ci/seed.sql`), then the whole suite (`python -m unittest discover`). Then, without stopping the build, `pip-audit` (installed only there, it is not in `requirements.txt`).
* It **never needs a secret**: the database is thrown away at the end, every other value is invented, and the tests replace Firebase, Google Calendar and the e-mail service with fakes. The CI never has real credentials.
* Dependabot (`.github/dependabot.yml`) opens, once a week, one pull request with the minor and patch updates of npm, pip and the actions, and separate ones for major versions.

## Run everything on your computer

Frontend:

```bash
npm ci
npm run lint
node --test "src/**/*.test.js"
npm run build
```

Backend (Python 3.14, PostgreSQL 17 or newer installed locally). **Use a database only for tests**: some tests delete and recreate rows (one of them empties the clients on purpose), so never point them at a database with data you care about. The tests refuse to run against a database that is not on this computer.

```bash
cd backend
pip install -r requirements.txt
createdb -U postgres thundbalance_test
psql -U postgres -d thundbalance_test -v ON_ERROR_STOP=1 -q -f ci/schema.sql -f ci/seed.sql
export DATABASE_URL=postgresql://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/thundbalance_test      # PowerShell: $env:DATABASE_URL = "..."
python -m unittest discover -s . -p "test_*.py"
```

A single file: `python -m unittest test_privacy -v`. Never run two test runs at the same time against the same database.

## The test database

The server creates almost every table and column itself, idempotently, when it starts (`ensure_*`). The **base tables** (`users`, `trainers`, `plans`, `sessions`, `user_plans`, `client_requests`, ...) are not created by the code, so `backend/ci/schema.sql` is a `pg_dump --schema-only --no-owner --no-privileges` of the development database, and `backend/ci/seed.sql` adds the little data the tests expect (three plans and five invented trainers with their weekly hours). When a base table or column changes, regenerate the schema:

```bash
pg_dump -U postgres -d thundbalance --schema-only --no-owner --no-privileges --no-comments > backend/ci/schema.sql
# then delete the two lines that start with \restrict and \unrestrict (they change on every dump)
```

## Rules the tests follow

* **No dependence on today's date or weekday.** The studio only works Monday to Friday, so a test that needs "a day" uses `next_weekday(...)` or a fixed weekday, and compares with what the server computes from it. A test that passes on Wednesday must pass on Saturday.
* **Invented data only**: names, addresses and prices of the tests are made up (domains `@test-*.example`), and every test cleans up what it creates.
* `users.email` and `trainers.email` are NOT NULL: a test row always has an address (the invented one).

## Environment variables

`.env.example` (frontend) and `backend/.env.example` (server) list every variable the code reads, with a comment, whether it is required, its default and a false example value. Real values live only in Render and Vercel.
