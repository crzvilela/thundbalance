"""Dates for emails: Spanish and English, Europe/Madrid, no server locale.

Madrid time is worked out by hand from the EU rule (summer time from the last
Sunday of March at 01:00 UTC to the last Sunday of October at 01:00 UTC), so it
needs neither the host's locale nor the tz database (which Windows lacks).
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
             "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"]
WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS_CA = ["gener", "febrer", "març", "abril", "maig", "juny", "juliol",
             "agost", "setembre", "octubre", "novembre", "desembre"]
WEEKDAYS_CA = ["dilluns", "dimarts", "dimecres", "dijous", "divendres", "dissabte", "diumenge"]

LANGUAGES = ("en", "es", "ca")


def _ca_month(index):
    """"de gener", but "d'abril", "d'agost", "d'octubre" (vowel sounds)."""
    name = MONTHS_CA[index]
    return f"d'{name}" if name[0] in "aeiou" else f"de {name}"


def _last_sunday(year, month):
    day = date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return day - timedelta(days=(day.weekday() + 1) % 7)


def _dst_window_utc(year):
    start = datetime(year, 3, _last_sunday(year, 3).day, 1, tzinfo=timezone.utc)
    end = datetime(year, 10, _last_sunday(year, 10).day, 1, tzinfo=timezone.utc)
    return start, end


def madrid_offset(moment_utc):
    """UTC offset of Madrid at an aware UTC instant: +1h in winter, +2h in summer."""
    start, end = _dst_window_utc(moment_utc.year)
    return timedelta(hours=2) if start <= moment_utc < end else timedelta(hours=1)


def to_madrid(moment):
    """Madrid wall-clock time as a naive datetime. A naive input is taken to be
    Madrid time already; an aware one is converted."""
    if moment.tzinfo is None:
        return moment
    utc = moment.astimezone(timezone.utc)
    return (utc + madrid_offset(utc)).replace(tzinfo=None)


def madrid_to_utc(moment):
    """Aware UTC instant for a Madrid wall-clock time (naive = Madrid; aware
    inputs are just converted). The repeated hour in October counts as summer time."""
    if moment.tzinfo is not None:
        return moment.astimezone(timezone.utc)
    start = datetime(moment.year, 3, _last_sunday(moment.year, 3).day, 2)
    end = datetime(moment.year, 10, _last_sunday(moment.year, 10).day, 3)
    offset = timedelta(hours=2) if start <= moment < end else timedelta(hours=1)
    return (moment - offset).replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class BilingualDate:
    weekday_es: str
    weekday_en: str
    date_es: str    # 12 de octubre de 2026
    date_en: str    # 12 October 2026
    time: str       # 09:00
    es: str         # lunes 12 de octubre de 2026, 09:00
    en: str         # Monday 12 October 2026, 09:00
    weekday_ca: str = ""   # dilluns
    date_ca: str = ""      # 12 d'octubre de 2026
    ca: str = ""           # dilluns 12 d'octubre de 2026, 09:00

    def weekday(self, lang):
        return {"es": self.weekday_es, "ca": self.weekday_ca}.get(lang, self.weekday_en)

    def date(self, lang):
        return {"es": self.date_es, "ca": self.date_ca}.get(lang, self.date_en)

    def full(self, lang):
        return {"es": self.es, "ca": self.ca}.get(lang, self.en)

    def __str__(self):
        return f"{self.es} / {self.en}"


def format_date_bilingual(moment):
    """Spanish, English and Catalan text for a datetime, in Madrid time
    (own tables: nothing depends on the server locale)."""
    local = to_madrid(moment)
    weekday = local.weekday()
    date_es = f"{local.day} de {MONTHS_ES[local.month - 1]} de {local.year}"
    date_en = f"{local.day} {MONTHS_EN[local.month - 1]} {local.year}"
    time = f"{local.hour:02d}:{local.minute:02d}"
    return BilingualDate(
        weekday_es=WEEKDAYS_ES[weekday],
        weekday_en=WEEKDAYS_EN[weekday],
        date_es=date_es,
        date_en=date_en,
        time=time,
        es=f"{WEEKDAYS_ES[weekday]} {date_es}, {time}",
        en=f"{WEEKDAYS_EN[weekday]} {date_en}, {time}",
        weekday_ca=WEEKDAYS_CA[weekday],
        date_ca=f"{local.day} {_ca_month(local.month - 1)} de {local.year}",
        ca=f"{WEEKDAYS_CA[weekday]} {local.day} {_ca_month(local.month - 1)} de {local.year}, {time}",
    )


def now_madrid():
    """Current Madrid wall-clock time (naive)."""
    return to_madrid(datetime.now(timezone.utc))


def parse_madrid(date_text, time_text="00:00"):
    """'2026-10-12' + '09:00' -> naive Madrid datetime."""
    return datetime.strptime(f"{str(date_text)[:10]} {str(time_text)[:5]}", "%Y-%m-%d %H:%M")
