"""Diagnóstico SÓ DE LEITURA: que preços há e que planos ficam sem preço?

    python scripts/check_pricing.py

Mostra a tabela `pricing` (preço por sessão, Individual e Dual) e lista as durações (em meses) dos planos
que NÃO têm preço definido para algum tipo: esses planos não se podem vender (criar um pack com eles dá
erro 422 "price_missing"). Também conta quantos packs já existem sem preço guardado (são os anteriores a
esta funcionalidade: ficam como estão, nada se recalcula).

Não cria, não altera e não apaga nada. Usa a base de dados com que esta máquina está configurada
(DATABASE_URL, senão a base local). Para ver a PRODUÇÃO, defina DATABASE_URL do Render na sua janela do
PowerShell antes de correr o script.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from database import get_connection  # noqa: E402
import pricing  # noqa: E402


def main():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT to_regclass('pricing')")
        if cursor.fetchone()[0] is None:
            print("A tabela `pricing` ainda não existe nesta base de dados (o servidor cria-a ao arrancar).")
            return 1
        cursor.execute("SELECT kind, session_type, months, price FROM pricing ORDER BY kind, session_type, months")
        print("Preços por sessão (EUR):")
        for kind, session_type, months, price in cursor.fetchall():
            what = "trial" if kind == "trial" else f"pack {months} mes(es)"
            print(f"  {session_type:<10} {what:<16} {pricing.money(price)}")

        cursor.execute("SELECT id, nome, duracao_meses FROM plans ORDER BY id")
        plans = cursor.fetchall()
        missing = set(pricing.unpriced_plan_months(cursor))
        print("\nPlanos:")
        for plan_id, name, months in plans:
            print(f"  #{plan_id} {name} ({months} mes(es)): {'SEM PREÇO para algum tipo' if months in missing else 'ok'}")
        print("\nDurações sem preço:", sorted(missing) if missing else "nenhuma")

        cursor.execute("SELECT COUNT(*) FILTER (WHERE price_per_session IS NULL), COUNT(*) FROM user_plans")
        without, total = cursor.fetchone()
        print(f"Packs sem preço guardado (anteriores a esta funcionalidade, ficam como estão): {without} de {total}")
        return 1 if missing else 0
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
