"""The logo of the emails:

    python -m unittest test_email_logo -v

One header for EVERY email (client and team), an absolute https URL to a PNG (never localhost, SVG, base64 or a relative
path: Gmail shows none of those), built from FRONTEND_URL, and the PNG itself (public/email-logo.png).
"""
import os
import pathlib
import re
import struct
import unittest

from emails import template
from emails.trial_emails import staff_trial_confirmed, staff_trial_declined, staff_trial_requested
from emails.reschedule_emails import staff_counter_answer, staff_reschedule_requested
from emails.pack_emails import build_pack_email
from emails.welcome_emails import build_staff_client_created
from test_client_emails import LANGUAGES, PACK, RESCHEDULE, client_emails

DEFAULT_LOGO = "https://thundbalance.vercel.app/email-logo.png"
PNG = pathlib.Path(__file__).resolve().parent.parent / "public" / "email-logo.png"
TRIAL = {"full_name": "Ana Prueba", "email": "a@b.co", "phone": "1", "age": 30, "birth_date": "1995-03-02", "goal": "x",
         "experience": "y", "session_date": "2026-10-12", "session_time": "09:00", "trainer": "Carles"}
NAMES = ("FRONTEND_URL", "SITE_URL", "EMAIL_LOGO_URL", "EMAIL_ALLOW_LOCAL_URLS")


class Logo(unittest.TestCase):
    def setUp(self):
        self._env = {name: os.environ.pop(name, None) for name in NAMES}

    def tearDown(self):
        for name, value in self._env.items():
            os.environ.pop(name, None)
            if value is not None:
                os.environ[name] = value

    def all_emails(self):
        emails = {}
        for lang in LANGUAGES:
            for name, (_, html, _) in client_emails(lang).items():
                emails[f"client {name} {lang}"] = html
        team = {
            "staff_trial_requested": staff_trial_requested(TRIAL), "staff_trial_confirmed": staff_trial_confirmed(TRIAL),
            "staff_trial_declined": staff_trial_declined(TRIAL), "pack_team": build_pack_email(PACK, team_subject=True),
            "staff_client_created": build_staff_client_created("Ana", "a@b.co", PACK),
            "staff_reschedule_requested": staff_reschedule_requested(RESCHEDULE),
            "staff_counter_answer": staff_counter_answer(RESCHEDULE, True),
        }
        for name, (_, html, _) in team.items():
            emails[f"team {name}"] = html
        return emails

    def test_every_email_has_the_same_header_with_the_logo(self):
        emails = self.all_emails()
        self.assertGreater(len(emails), 30)
        header = template.email_header()
        for name, html in emails.items():
            self.assertEqual(html.count("<img"), 1, name)
            self.assertIn(header, html, name)                                   # the very same piece, in all of them
            image = re.search(r"<img[^>]*>", html).group(0)
            self.assertIn(f'src="{DEFAULT_LOGO}"', image, name)                 # absolute https, from the frontend
            self.assertIn('width="200"', image, name)
            self.assertIn('alt="ThundBalance"', image, name)
            self.assertIn("display:block;border:0;", image, name)
            self.assertNotIn("data:", image, name)
            self.assertNotIn(".svg", image, name)
            self.assertNotIn("localhost", html, name)

    def test_the_header_cell_has_the_emails_own_black_so_the_alt_text_stays_readable(self):
        header = template.email_header()
        self.assertIn('bgcolor="#000000"', header)
        self.assertIn("background-color:#000000", header)
        self.assertIn("color:#ffffff", header)                                  # the alt text is white on that black

    def test_only_one_place_draws_the_logo(self):
        found = []
        for path in pathlib.Path(__file__).resolve().parent.glob("**/*.py"):
            if path.name.startswith(("test_", "preview_")) or "email_previews" in path.parts:
                continue
            if "<img" in path.read_text(encoding="utf-8", errors="ignore"):
                found.append(path.name)
        self.assertEqual(found, ["template.py"])

    # ----------------------------------------------------------- the address
    def test_the_address_comes_from_frontend_url(self):
        os.environ["FRONTEND_URL"] = "https://www.thundbalance.com/"
        self.assertEqual(template.logo_url(), "https://www.thundbalance.com/email-logo.png")
        self.assertIn('src="https://www.thundbalance.com/email-logo.png"', template.email_header())
        os.environ.pop("FRONTEND_URL")
        os.environ["SITE_URL"] = "https://old-name.example.org"                  # the name used before still works
        self.assertEqual(template.logo_url(), "https://old-name.example.org/email-logo.png")
        os.environ["FRONTEND_URL"] = "https://new.example.org"                  # and the new one wins
        self.assertEqual(template.logo_url(), "https://new.example.org/email-logo.png")

    def test_an_address_an_email_client_can_not_reach_is_ignored(self):
        for bad in ("http://localhost:5173", "https://localhost", "http://127.0.0.1:8000", "/relative", "file:///x/email-logo.png",
                    "data:image/png;base64,AAAA", "http://thundbalance.vercel.app", "thundbalance.vercel.app", "https://", "https://my.local"):
            os.environ["FRONTEND_URL"] = bad
            os.environ["EMAIL_LOGO_URL"] = bad
            self.assertEqual(template.logo_url(), DEFAULT_LOGO, bad)
            self.assertEqual(template.site_url(), "https://thundbalance.vercel.app", bad)

    def test_a_logo_can_be_pointed_somewhere_else_only_with_a_public_https_address(self):
        os.environ["EMAIL_LOGO_URL"] = "https://cdn.example.org/logo.png"
        self.assertEqual(template.logo_url(), "https://cdn.example.org/logo.png")

    def test_local_previews_may_use_a_file(self):
        os.environ["EMAIL_ALLOW_LOCAL_URLS"] = "1"
        os.environ["EMAIL_LOGO_URL"] = "file:///C:/x/email-logo.png"
        self.assertEqual(template.logo_url(), "file:///C:/x/email-logo.png")

    # ---------------------------------------------------------------- the PNG
    def test_the_png_is_a_light_logo_on_a_transparent_background_600_px_wide(self):
        data = PNG.read_bytes()
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        width, height, bit_depth, color_type = struct.unpack(">IIBB", data[16:26])
        self.assertEqual((width, height), (600, 434))
        self.assertIn(color_type, (4, 6))                                       # with an alpha channel: transparent
        self.assertEqual((template.LOGO_WIDTH, template.LOGO_HEIGHT), (200, round(200 * 434 / 600)))   # shown at 200 px, same proportions
        self.assertLess(len(data), 200_000)                                     # light enough for an email
        try:
            from PIL import Image
        except ImportError:
            return
        image = Image.open(PNG).convert("RGBA")
        self.assertEqual(image.getchannel("A").getextrema()[0], 0)              # really transparent somewhere
        visible = [pixel for pixel in image.get_flattened_data() if pixel[3] > 200] if hasattr(image, "get_flattened_data") else [pixel for pixel in image.getdata() if pixel[3] > 200]
        average = sum(sum(pixel[:3]) for pixel in visible) / (3 * len(visible))
        self.assertGreater(average, 240)                                        # white, not dark: it sits on the emails' black


if __name__ == "__main__":
    unittest.main()
