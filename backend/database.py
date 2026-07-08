import psycopg2

conn = psycopg2.connect(
    host="localhost",
    database="thundbalance",
    user="postgres",
    password="123456"
)

print("Ligação com PostgreSQL realizada com sucesso!")