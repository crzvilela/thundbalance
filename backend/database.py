import os
import psycopg2

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:

    conn = psycopg2.connect(DATABASE_URL)

    print("Connected to Neon Database!")

else:

    conn = psycopg2.connect(
        host="localhost",
        database="thundbalance",
        user="postgres",
        password="123456"
    )

    print("Connected to Local PostgreSQL!")