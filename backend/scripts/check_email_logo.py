"""Comprueba que el logo de los emails se puede abrir desde internet (como lo hace Gmail):

    python scripts/check_email_logo.py            # usa FRONTEND_URL (o la dirección por defecto)
    python scripts/check_email_logo.py https://otro.dominio.com

Pide {FRONTEND_URL}/email-logo.png sin sesión y comprueba: HTTP 200, content-type image/png, que de verdad es
un PNG y cuánto mide. Código de salida 0 = OK, 1 = fallo. No envía ni cambia nada.
"""
import os
import struct
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from emails.template import LOGO_PATH, logo_url, site_url  # noqa: E402


def main():
    if len(sys.argv) > 1:
        base = sys.argv[1].strip().rstrip("/")
        url = f"{base}{LOGO_PATH}"
    else:
        url = logo_url()
    print(f"URL: {url}")
    # the user agent Gmail's image proxy uses, so a firewall that only blocks bots shows up here too
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (via ggpht.com GoogleImageProxy)"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            status, kind, data = response.status, response.headers.get("Content-Type", ""), response.read()
    except urllib.error.HTTPError as error:
        print(f"FALLO: el servidor responde HTTP {error.code}")
        return 1
    except Exception as error:  # noqa: BLE001
        print(f"FALLO: no se pudo abrir ({type(error).__name__})")
        return 1
    print(f"HTTP {status}, content-type {kind}, {len(data)} bytes")
    problems = []
    if status != 200:
        problems.append("no es HTTP 200")
    if not kind.lower().startswith("image/png"):
        problems.append("el content-type no es image/png")
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        problems.append("el contenido no es un PNG (¿una página HTML?)")
    else:
        width, height = struct.unpack(">II", data[16:24])
        print(f"PNG de {width} x {height} px")
    if problems:
        print("FALLO: " + "; ".join(problems))
        return 1
    print("OK: el logo se abre.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
