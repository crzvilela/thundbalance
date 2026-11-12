"""Video uploads are read in chunks: python -m unittest test_video_upload -v

A file over the limit is refused with 413 as soon as it passes it, a file that is not a real video with 415, nothing is kept when it
fails and the process never holds a big file in memory.
"""
import asyncio
import os
import tempfile
import tracemalloc
import unittest

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import web_safety

MB = 1024 * 1024
MP4_HEAD = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
WEBM_HEAD = b"\x1a\x45\xdf\xa3" + b"\x00" * 12


class FakeUpload:
    """An UploadFile that makes its bytes as they are read (nothing is kept) and records how it was read."""

    def __init__(self, filename, head, size, content_type="video/mp4"):
        self.filename, self.content_type = filename, content_type
        self.head, self.size, self.sent = head, size, 0
        self.reads = []

    async def read(self, amount=-1):
        self.reads.append(amount)
        wanted = min(amount if amount and amount > 0 else self.size, self.size - self.sent)
        if wanted <= 0:
            return b""
        piece = (self.head if self.sent == 0 else b"") + b"\x00" * wanted
        piece = piece[:wanted]
        self.sent += len(piece)
        return piece


def store(upload, folder, max_bytes=None, chunk=MB):
    return asyncio.run(web_safety.store_video(upload, folder, max_bytes, chunk))


class VideoUpload(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.folder.cleanup()

    def files(self):
        return sorted(os.listdir(self.folder.name))

    def test_a_valid_video_is_stored_under_a_name_made_by_the_server(self):
        upload = FakeUpload("My Holiday (1).MP4", MP4_HEAD, 3 * MB + 17)
        name = store(upload, self.folder.name)
        self.assertRegex(name, r"^[0-9a-f]{32}\.mp4$")                         # uuid + the validated extension, never the user's name
        self.assertEqual(self.files(), [name])                                 # and no temporary file left
        self.assertEqual(os.path.getsize(os.path.join(self.folder.name, name)), 3 * MB + 17)
        self.assertTrue(all(amount == MB for amount in upload.reads))          # read 1 MB at a time, never "everything"

    def test_webm_and_mov_are_accepted_with_their_own_signatures(self):
        self.assertTrue(store(FakeUpload("a.webm", WEBM_HEAD, 100, "video/webm"), self.folder.name).endswith(".webm"))
        self.assertTrue(store(FakeUpload("a.mov", MP4_HEAD, 100, "video/quicktime"), self.folder.name).endswith(".mov"))
        self.assertTrue(store(FakeUpload("a.mov", MP4_HEAD, 100, ""), self.folder.name).endswith(".mov"))      # no declared type: fine

    def test_a_file_over_the_limit_is_refused_with_413_and_not_read_to_the_end(self):
        upload = FakeUpload("big.mp4", MP4_HEAD, 50 * MB)
        with self.assertRaises(HTTPException) as caught:
            store(upload, self.folder.name, max_bytes=2 * MB)
        self.assertEqual(caught.exception.status_code, 413)
        self.assertEqual(self.files(), [])                                     # the temporary file was removed
        self.assertLessEqual(upload.sent, 3 * MB)                              # it stopped right after the limit: 50 MB were not read

    def test_a_file_exactly_at_the_limit_is_accepted(self):
        name = store(FakeUpload("edge.mp4", MP4_HEAD, 2 * MB), self.folder.name, max_bytes=2 * MB)
        self.assertEqual(self.files(), [name])

    def test_301_mb_is_refused_without_holding_it_in_memory(self):
        upload = FakeUpload("huge.mp4", MP4_HEAD, 301 * MB)
        tracemalloc.start()
        try:
            with self.assertRaises(HTTPException) as caught:
                store(upload, self.folder.name)                                 # the real limit: 300 MB, 1 MB chunks
            peak = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
        self.assertEqual(caught.exception.status_code, 413)
        self.assertEqual(self.files(), [])
        self.assertLess(peak, 16 * MB)                                         # a few chunks, not 300 MB

    def test_the_type_is_checked_on_the_first_bytes_and_nothing_is_kept(self):
        for filename, head, declared in (
            ("fake.mp4", b"<html><script>alert(1)</script>", "video/mp4"),     # not a video at all
            ("fake.webm", MP4_HEAD, "video/webm"),                             # the signature does not match the extension
            ("fake.mp4", WEBM_HEAD, "video/mp4"),
            ("clip.mp4", MP4_HEAD, "image/png"),                               # the declared type does not match
            ("clip.exe", MP4_HEAD, "video/mp4"),                               # extension not allowed
            ("clip", MP4_HEAD, "video/mp4"),
        ):
            with self.assertRaises(HTTPException, msg=filename) as caught:
                store(FakeUpload(filename, head, 4096, declared), self.folder.name)
            self.assertEqual(caught.exception.status_code, 415, filename)
        self.assertEqual(self.files(), [])

    def test_an_empty_file_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            store(FakeUpload("empty.mp4", MP4_HEAD, 0), self.folder.name)
        self.assertEqual(caught.exception.status_code, 415)
        self.assertEqual(self.files(), [])

    def test_a_half_written_file_can_not_be_served(self):
        # the temporary name starts with a dot: /uploads/{name} answers 404 for it
        client = TestClient(main.app)
        self.assertEqual(client.get("/uploads/.upload-abc.part").status_code, 404)

    def test_a_declared_size_far_over_the_limit_is_refused_before_the_body_is_read(self):
        client = TestClient(main.app)
        answer = client.post("/landing-page/upload-video", content=b"x", headers={"content-length": str(400 * MB)})
        self.assertEqual(answer.status_code, 413)


if __name__ == "__main__":
    unittest.main()
