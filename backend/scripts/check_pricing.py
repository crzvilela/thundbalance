"""Diagnóstico SÓ DE LEITURA: que packs e preços há no catálogo?

    python scripts/check_pricing.py

Mostra o catálogo de packs (nome, tipo, semanas, sessões por semana, preço por sessão, preço do pack, estado e
quantas vezes foi vendido), os preços de trial e quantos packs de clientes ainda não têm preço guardado (são os
anteriores à funcionalidade de preços: ficam como estão, nada se recalcula).

Não cria, não altera e não apaga nada. Usa a base de dados com que esta máquina está configurada
(DATABASE_URL, senão a base local). Para ver a PRODUÇÃO, defina DATABASE_URL do Render na sua janela do
PowerShell antes de correr o script.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from database import get_connection  # noqa: E402
import pack_catalog  # noqa: E402
import pricing  # noqa: E402


def main():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT to_regclass('pack_catalog')")
        if cursor.fetchone()[0] is None:
            print("A tabela `pack_catalog` ainda não existe nesta base de dados (o servidor cria-a ao arrancar).")
            return 1
        print("Catálogo de packs (EUR):")
        packs = pack_catalog.list_packs(cursor)
        for pack in packs:
            options = ",".join(str(value) for value in pack["sessions_per_week_options"])
            total = f"pack {pricing.money(pack['price_per_pack'])}" if pack["price_per_pack"] is not None else "pack = sessão x total"
            state = "à venda" if pack["active"] else "ARQUIVADO"
            print(f"  #{pack['id']:<3} {pack['name'][:32]:<32} {pack['session_type']:<10} {pack['weeks']:>3} sem  "
                  f"{pricing.money(pack['price_per_session']):>7}/sessão  [{options}]/sem  {total:<22} {state}  vendido {pack['sold']}x")
        print("\nTrial:", ", ".join(f"{kind} {pricing.money(price)}" for kind, price in pack_catalog.trial_prices(cursor).items()))

        cursor.execute("SELECT COUNT(*) FILTER (WHERE price_per_session IS NULL), COUNT(*) FROM user_plans")
        without, total = cursor.fetchone()
        print(f"Packs de clientes sem preço guardado (anteriores à funcionalidade, ficam como estão): {without} de {total}")
        on_sale = [pack for pack in packs if pack["active"]]
        if not on_sale:
            print("ATENÇÃO: não há nenhum pack à venda.")
        return 0 if on_sale else 1
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
