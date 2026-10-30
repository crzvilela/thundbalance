"""HTML base template and reusable components for ThundBalance emails.

Email-client friendly: table layout, inline CSS, 600px max width, plain-text
twin for every block. Text from users is always escaped (html.escape) by the
components; only Raw(...) is trusted markup.

Typical use:

    blocks = [heading("Hola"), paragraph("..."), button("Confirmar", "Confirm", url)]
    html, text = render_email(title="...", blocks=blocks)

A client email is written in ONE language (texts.localized_email); the staff ones in Spanish (texts.spanish_email).
"""
import os
from urllib.parse import urlparse
from dataclasses import dataclass
from html import escape

from .dates import format_date_bilingual

FONT = "'Inter', Helvetica, Arial, sans-serif"
MONO = "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace"
BLACK, WHITE = "#000000", "#ffffff"
MUTED, LINE, PANEL = "#a3a3a3", "#2a2a2a", "#111111"

FOOTER_ADDRESS = "ThundBalance, Carrer de Pallars 286, 08005 Barcelona"
FOOTER_EMAIL = "pt@thundbalance.com"
STUDIO_PLACE = FOOTER_ADDRESS

# The first production origin allowed by CORS in main.py. Set FRONTEND_URL on Render to override (SITE_URL, the
# name used before, still works).
DEFAULT_SITE_URL = "https://thundbalance.vercel.app"

# The logo is a PNG in the frontend's public folder (public/email-logo.png): 600 px wide, white on transparent, shown
# at 200 px. Gmail does not show SVG, base64 images, relative paths or localhost, so it is always an ABSOLUTE https URL.
LOGO_PATH = "/email-logo.png"
LOGO_WIDTH, LOGO_HEIGHT = 200, 145        # the PNG is 600 x 434: shown at a third of its size (sharp on retina screens)
_LOCAL_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "::1")


def _public_url(value):
    """The address without a trailing slash when it is a public https one; None for anything an email client can not
    reach (empty, http, relative, localhost, a file). Local previews may allow them with EMAIL_ALLOW_LOCAL_URLS=1."""
    text = str(value or "").strip().rstrip("/")
    if not text:
        return None
    if os.getenv("EMAIL_ALLOW_LOCAL_URLS", "").strip() == "1":
        return text
    parts = urlparse(text)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or host in _LOCAL_HOSTS or host.endswith(".local"):
        return None
    return text


def site_url():
    """The public address of the website: FRONTEND_URL, else SITE_URL, else the default. A value that is not a public
    https address is ignored (never localhost in an email)."""
    for name in ("FRONTEND_URL", "SITE_URL"):
        url = _public_url(os.getenv(name, ""))
        if url:
            return url
    return DEFAULT_SITE_URL


def logo_url():
    """https://<frontend>/email-logo.png (EMAIL_LOGO_URL can point somewhere else, if it is a public https address)."""
    return _public_url(os.getenv("EMAIL_LOGO_URL", "")) or f"{site_url()}{LOGO_PATH}"


@dataclass(frozen=True)
class Raw:
    """Trusted HTML (never put user text in it)."""
    html: str


@dataclass(frozen=True)
class Block:
    html: str
    text: str


def _e(value):
    return value.html if isinstance(value, Raw) else escape(str(value if value is not None else ""), quote=True)


def _plain(value):
    return str(value.html if isinstance(value, Raw) else (value if value is not None else ""))


def _row(inner, padding="0 0 16px 0"):
    return f'<tr><td class="px" style="padding:{padding};font-family:{FONT};color:{WHITE};">{inner}</td></tr>'


# ----------------------------------------------------------------- components

def heading(text):
    return Block(
        _row(f'<h1 style="margin:0;font-family:{FONT};font-size:24px;line-height:1.25;font-weight:700;color:{WHITE};">{_e(text)}</h1>'),
        f"{_plain(text)}\n",
    )


def paragraph(text, muted=False):
    color = MUTED if muted else WHITE
    return Block(
        _row(f'<p style="margin:0;font-family:{FONT};font-size:16px;line-height:1.6;color:{color};">{_e(text)}</p>'),
        _plain(text) + "\n",
    )


def key_value(rows):
    """Block of "label: value" lines. rows = [(label, value), ...]; empty values are skipped."""
    rows = [(label, value) for label, value in rows if value not in (None, "")]
    cells = "".join(
        f'<tr><td valign="top" style="padding:6px 12px 6px 0;font-family:{FONT};font-size:14px;line-height:1.5;color:{MUTED};width:38%;">{_e(label)}</td>'
        f'<td valign="top" style="padding:6px 0;font-family:{FONT};font-size:15px;line-height:1.5;color:{WHITE};">{_e(value)}</td></tr>'
        for label, value in rows
    )
    table = f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{cells}</table>'
    return Block(_row(table), "\n".join(f"{_plain(l)}: {_plain(v)}" for l, v in rows) + "\n")


def highlight_box(content, label=None, mono=True):
    """Boxed text that must stand out (credentials, codes). Monospaced by default."""
    family = MONO if mono else FONT
    title = (f'<div style="font-family:{FONT};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:{MUTED};padding-bottom:8px;">{_e(label)}</div>' if label else "")
    lines = _plain(content).split("\n")
    body = content.html if isinstance(content, Raw) else "<br>".join(_e(line) for line in lines)
    box = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td bgcolor="{PANEL}" style="background-color:{PANEL};border:1px solid {LINE};border-radius:4px;padding:16px;">'
        f'{title}<div style="font-family:{family};font-size:16px;line-height:1.6;color:{WHITE};word-break:break-all;">{body}</div>'
        f'</td></tr></table>'
    )
    return Block(_row(box), (f"{label}\n" if label else "") + "\n".join(lines) + "\n")


def notice(text, tone="info"):
    """Callout with a coloured left edge. tone: info | warning."""
    edge = "#f5b942" if tone == "warning" else "#6b7280"
    box = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td style="border-left:3px solid {edge};padding:4px 0 4px 14px;font-family:{FONT};font-size:14px;line-height:1.55;color:{MUTED};">{_e(text)}</td>'
        f'</tr></table>'
    )
    return Block(_row(box), f"! {_plain(text)}\n")


def sessions_table(sessions, lang="es"):
    """Day / date / time / trainer. sessions = [{"start": datetime, "trainer": str}, ...]
    (naive datetimes are Madrid time). lang: "es" or "en"."""
    heads = {"es": ("Día", "Fecha", "Hora", "Entrenador"), "en": ("Day", "Date", "Time", "Trainer"),
             "ca": ("Dia", "Data", "Hora", "Entrenador")}[lang]
    th = "".join(
        f'<th align="left" style="padding:8px 8px 8px 0;border-bottom:1px solid {LINE};font-family:{FONT};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:{MUTED};font-weight:600;">{_e(h)}</th>'
        for h in heads
    )
    body, lines = "", []
    for item in sessions:
        d = format_date_bilingual(item["start"])
        cells = (
            d.weekday(lang).capitalize(),
            d.date(lang),
            d.time,
            item.get("trainer") or "—",
        )
        body += "<tr>" + "".join(
            f'<td valign="top" style="padding:10px 8px 10px 0;border-bottom:1px solid {LINE};font-family:{FONT};font-size:14px;line-height:1.4;color:{WHITE};">{_e(c)}</td>'
            for c in cells
        ) + "</tr>"
        lines.append(" | ".join(cells))
    table = f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{th}</tr>{body}</table>'
    return Block(_row(table), "\n".join([" | ".join(heads)] + lines) + "\n")


def button(label_es, label_en, url, only=None, label=None):
    """Main call to action: white button, black text. The label of a CLIENT email is passed as label=... (one
    language, the client's); staff emails use only="es" with the Spanish label. The two-language label "ES / EN"
    is no longer used by any email."""
    label = label if label is not None else (label_es if only == "es" else f"{label_es} / {label_en}")
    link = (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td align="center" bgcolor="{WHITE}" style="background-color:{WHITE};border-radius:4px;">'
        f'<a href="{_e(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:{FONT};font-size:15px;font-weight:700;line-height:1;color:{BLACK};text-decoration:none;border-radius:4px;">{_e(label)}</a>'
        f'</td></tr></table>'
    )
    return Block(_row(link, "8px 0 24px 0"), f"{label}: {url}\n")


def link_line(label_es, label_en, url, only=None, label=None):
    """Quiet secondary link under a button (a single-language label=...)."""
    label = label if label is not None else (label_es if only == "es" else f"{label_es} / {label_en}")
    link = f'<a href="{_e(url)}" target="_blank" style="font-family:{FONT};font-size:14px;line-height:1.5;color:{MUTED};text-decoration:underline;">{_e(label)}</a>'
    return Block(_row(link, "0 0 24px 0"), f"{label}: {url}"+chr(10))


# ------------------------------------------------------------------ the page

def _separator():
    return (
        f'<tr><td class="px" style="padding:8px 0 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f'<tr><td style="border-top:1px solid {LINE};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table></td></tr>'
    )


def email_header(logo=None):
    """The logo row at the top of EVERY email (client and team): the one place that draws it. The cell has the same
    black as the email, so if the image is blocked the alt text ("ThundBalance", white) stays readable."""
    return (
        f'<tr><td class="px tb-bg" align="left" bgcolor="{BLACK}" style="padding:0 0 28px 0;background-color:{BLACK};">'
        f'<img src="{escape(logo or logo_url())}" width="{LOGO_WIDTH}" height="{LOGO_HEIGHT}" alt="ThundBalance" '
        f'style="display:block;border:0;outline:none;width:{LOGO_WIDTH}px;max-width:100%;height:auto;'
        f'color:{WHITE};font-family:{FONT};font-size:20px;font-weight:700;letter-spacing:3px;"></td></tr>'
    )


def render_email(title, blocks, blocks_after_separator=None, preheader="", lang="es", logo=None):
    """(html, text). `blocks_after_separator` (optional, set below a thin grey line) is kept for the rare email that needs a
    second part, but no email puts two languages in it any more. <html lang> and the Content-Language meta carry `lang`,
    so the mail client does not offer to translate it."""
    groups = [blocks] + ([blocks_after_separator] if blocks_after_separator else [])
    rows, texts = [], []
    for index, group in enumerate(groups):
        if index:
            rows.append(_separator())
            texts.append("-" * 40)
        rows.extend(block.html for block in group)
        texts.append("\n".join(block.text for block in group).strip())

    html = f"""<!DOCTYPE html>
<html lang="{escape(lang)}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta http-equiv="Content-Language" content="{escape(lang)}">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>{escape(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap" rel="stylesheet">
<style>
  :root {{ color-scheme: dark light; supported-color-schemes: dark light; }}
  body {{ margin:0; padding:0; background-color:{BLACK}; }}
  a {{ color:{WHITE}; }}
  @media only screen and (max-width:620px) {{
    .container {{ width:100% !important; }}
    .px {{ padding-left:20px !important; padding-right:20px !important; }}
  }}
  [data-ogsb] .tb-bg {{ background-color:{BLACK} !important; }}
  [data-ogsc] .tb-text {{ color:{WHITE} !important; }}
</style>
</head>
<body class="tb-bg" bgcolor="{BLACK}" style="margin:0;padding:0;background-color:{BLACK};color:{WHITE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:{BLACK};">{escape(preheader)}</div>
<table role="presentation" class="tb-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{BLACK}" style="background-color:{BLACK};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="container tb-bg" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="{BLACK}" style="width:100%;max-width:600px;background-color:{BLACK};">
{email_header(logo)}
{chr(10).join(rows)}
<tr><td class="px" style="padding:24px 0 0 0;border-top:1px solid {LINE};font-family:{FONT};font-size:12px;line-height:1.6;color:{MUTED};">
{escape(FOOTER_ADDRESS)}<br><a href="mailto:{FOOTER_EMAIL}" style="color:{MUTED};text-decoration:underline;">{FOOTER_EMAIL}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""
    text = "\n\n".join(texts) + f"\n\n--\n{FOOTER_ADDRESS}\n{FOOTER_EMAIL}\n"
    return html, text
