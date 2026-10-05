import os
import psycopg2

DATABASE_URL = os.getenv("DATABASE_URL")

def get_connection():

    if DATABASE_URL:

        return psycopg2.connect(DATABASE_URL)

    return psycopg2.connect(
        host="localhost",
        database="thundbalance",
        user="postgres",
        password="123456"
    )