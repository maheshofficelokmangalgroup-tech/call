"""Acceptance: recording playback requires authorization and uses a temporary signed URL (section 7.7)."""

import hashlib
import io
import struct
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from app.core.config import get_settings
from app.core.security import sign_playback
from app.core.timeutils import utcnow
from app.models.recording import RecordingAccessLog
from app.services.settings_service import set_setting
from tests.conftest import auth_headers, iso, now_utc


def wav_bytes(seconds: int = 1, rate: int = 8000) -> bytes:
    frames = b"\x00\x01" * (rate * seconds)
    header = b"RIFF" + struct.pack("<I", 36 + len(frames)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    return header + b"data" + struct.pack("<I", len(frames)) + frames


@pytest.fixture()
def recording_on(db):
    set_setting(db, "recording", {"enabled": True, "notice_text": "Calls are recorded."})
    db.commit()


@pytest.fixture()
def call_of_a(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    resp = client.post("/api/v1/calls", headers=as_a, json={"client_call_id": "rec-call-0001", "contact_id": contact.id, "started_at": iso(now_utc())})
    return resp.json()


def create_meta(client, headers, call_id, data: bytes, content_type="audio/wav", **extra):
    body = {"content_type": content_type, "size_bytes": len(data), "duration_seconds": 1, **extra}
    return client.post(f"/api/v1/calls/{call_id}/recording", headers=headers, json=body)


def upload(client, headers, rec_id, data: bytes, name="call.wav", content_type="audio/wav"):
    return client.post(f"/api/v1/recordings/{rec_id}/upload", headers=headers, files={"file": (name, data, content_type)})


def test_recording_is_disabled_until_the_organisation_enables_it(client, call_of_a, as_a):
    resp = create_meta(client, as_a, call_of_a["id"], wav_bytes())
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "recording_disabled"


def test_full_flow_private_upload_signed_playback_and_access_log(client, recording_on, call_of_a, as_a, as_admin, db):
    audio = wav_bytes(2)
    meta = create_meta(client, as_a, call_of_a["id"], audio, sha256=hashlib.sha256(audio).hexdigest())
    assert meta.status_code == 201 and meta.json()["upload_status"] == "pending"
    rec_id = meta.json()["id"]

    # metadata creation is idempotent (the app may retry)
    again = create_meta(client, as_a, call_of_a["id"], audio)
    assert again.status_code == 200 and again.json()["id"] == rec_id

    not_yet = client.get(f"/api/v1/recordings/{rec_id}/playback-url", headers=as_a)
    assert not_yet.status_code == 409 and not_yet.json()["error"]["code"] == "recording_not_available"

    up = upload(client, as_a, rec_id, audio)
    assert up.status_code == 200, up.text
    assert up.json()["upload_status"] == "available" and up.json()["size_bytes"] == len(audio)

    # the call detail now exposes the recording state
    detail = client.get(f"/api/v1/calls/{call_of_a['id']}", headers=as_a).json()
    assert detail["recording"]["upload_status"] == "available"

    url_resp = client.get(f"/api/v1/recordings/{rec_id}/playback-url", headers=as_a).json()
    assert url_resp["mode"] == "play"
    url = url_resp["url"]
    assert url.startswith(f"/api/v1/recordings/{rec_id}/stream?") and "sig=" in url
    lifetime = datetime.fromisoformat(url_resp["expires_at"]) - utcnow()
    assert timedelta(seconds=get_settings().recording_url_ttl_seconds - 5) < lifetime <= timedelta(seconds=get_settings().recording_url_ttl_seconds)

    # the signed URL is the credential: no Authorization header is needed
    full = client.get(url)
    assert full.status_code == 200 and full.content == audio
    assert full.headers["accept-ranges"] == "bytes" and full.headers["cache-control"] == "private, no-store"
    assert full.headers["content-type"] == "audio/wav"

    part = client.get(url, headers={"Range": "bytes=10-19"})
    assert part.status_code == 206 and part.content == audio[10:20]
    assert part.headers["content-range"] == f"bytes 10-{19}/{len(audio)}"
    tail = client.get(url, headers={"Range": "bytes=-4"})
    assert tail.status_code == 206 and tail.content == audio[-4:]
    assert client.get(url, headers={"Range": f"bytes={len(audio) + 5}-"}).status_code == 416

    # every issued URL and every playback is logged (who/when); range requests of one playback count once
    logs = client.get(f"/api/v1/recordings/{rec_id}/access-log", headers=as_admin).json()
    assert sorted(entry["action"] for entry in logs["items"]) == ["playback_url", "stream"]
    assert db.query(RecordingAccessLog).filter_by(recording_id=rec_id, actor_id=call_of_a["employee_id"]).count() == 2


def test_signed_url_cannot_be_tampered_with_or_used_after_expiry(client, recording_on, call_of_a, as_a, emp_a):
    audio = wav_bytes()
    rec_id = create_meta(client, as_a, call_of_a["id"], audio).json()["id"]
    upload(client, as_a, rec_id, audio)
    url = client.get(f"/api/v1/recordings/{rec_id}/playback-url", headers=as_a).json()["url"]
    query = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    base = f"/api/v1/recordings/{rec_id}/stream"

    assert client.get(url).status_code == 200
    forged = dict(query, sig=query["sig"][:-1] + ("0" if query["sig"][-1] != "0" else "1"))
    assert client.get(base, params=forged).status_code == 403
    assert client.get(base, params=dict(query, exp=int(query["exp"]) + 3600)).status_code == 403  # extended lifetime
    assert client.get(base, params=dict(query, u=emp_a.id + 99)).status_code == 403  # swapped identity
    assert client.get(base, params=dict(query, m="download")).status_code == 403  # upgraded mode

    expired_exp = int((utcnow() - timedelta(seconds=5)).timestamp())
    expired = {"exp": expired_exp, "u": emp_a.id, "m": "play", "sig": sign_playback(rec_id, emp_a.id, expired_exp, "play")}
    assert client.get(base, params=expired).status_code == 403
    assert client.get(base).status_code == 422  # missing signature parameters


def test_other_employees_cannot_see_or_play_a_recording(client, make, recording_on, call_of_a, as_a, as_b, as_admin):
    audio = wav_bytes()
    rec_id = create_meta(client, as_a, call_of_a["id"], audio).json()["id"]
    upload(client, as_a, rec_id, audio)
    assert client.get(f"/api/v1/recordings/{rec_id}", headers=as_b).status_code == 404
    assert client.get(f"/api/v1/recordings/{rec_id}/playback-url", headers=as_b).status_code == 404
    assert upload(client, as_b, rec_id, audio).status_code == 404
    assert create_meta(client, as_b, call_of_a["id"], audio).status_code == 404
    assert client.get(f"/api/v1/recordings/{rec_id}/access-log", headers=as_a).status_code == 403
    assert client.get(f"/api/v1/recordings/{rec_id}/playback-url", headers=as_admin).status_code == 200


def test_manager_can_play_team_recordings_but_not_download(client, make, recording_on):
    team = make.team("Desk")
    manager = make.employee(role="manager", team=team)
    worker = make.employee(team=team)
    contact = make.contact(assign_to=worker)
    w, m = auth_headers(client, worker), auth_headers(client, manager)
    call = client.post("/api/v1/calls", headers=w, json={"client_call_id": "team-call-001", "contact_id": contact.id, "started_at": iso(now_utc())}).json()
    audio = wav_bytes()
    rec_id = create_meta(client, w, call["id"], audio).json()["id"]
    upload(client, w, rec_id, audio)
    assert client.get(f"/api/v1/recordings/{rec_id}/playback-url", headers=m).status_code == 200
    assert client.get(f"/api/v1/recordings/{rec_id}/playback-url?mode=download", headers=m).status_code == 403


def test_only_admins_can_download(client, recording_on, call_of_a, as_a, as_admin):
    audio = wav_bytes()
    rec_id = create_meta(client, as_a, call_of_a["id"], audio).json()["id"]
    upload(client, as_a, rec_id, audio)
    denied = client.get(f"/api/v1/recordings/{rec_id}/playback-url?mode=download", headers=as_a)
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "download_forbidden"
    url = client.get(f"/api/v1/recordings/{rec_id}/playback-url?mode=download", headers=as_admin).json()["url"]
    resp = client.get(url)
    assert resp.status_code == 200 and resp.headers["content-disposition"].startswith("attachment")


def test_non_audio_files_are_rejected_even_with_an_audio_name(client, recording_on, call_of_a, as_a):
    rec_id = create_meta(client, as_a, call_of_a["id"], b"x" * 500, content_type="audio/mp4").json()["id"]
    resp = upload(client, as_a, rec_id, b"MZ\x90\x00 this is an executable, not audio at all", name="evil.m4a", content_type="audio/mp4")
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "unsupported_media_type"
    assert client.get(f"/api/v1/recordings/{rec_id}", headers=as_a).json()["upload_status"] == "failed"


def test_checksum_mismatch_marks_failed_and_allows_a_clean_retry(client, recording_on, call_of_a, as_a):
    audio = wav_bytes()
    rec_id = create_meta(client, as_a, call_of_a["id"], audio, sha256="0" * 64).json()["id"]
    bad = upload(client, as_a, rec_id, audio)
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "checksum_mismatch"
    assert client.get(f"/api/v1/recordings/{rec_id}", headers=as_a).json()["upload_status"] == "failed"

    retry_meta = create_meta(client, as_a, call_of_a["id"], audio, sha256=hashlib.sha256(audio).hexdigest())
    assert retry_meta.status_code == 200 and retry_meta.json()["upload_status"] == "pending"
    assert upload(client, as_a, rec_id, audio).json()["upload_status"] == "available"
    assert upload(client, as_a, rec_id, audio).status_code == 409  # already uploaded


def test_format_and_size_limits(client, recording_on, call_of_a, as_a, monkeypatch):
    unsupported = client.post(f"/api/v1/calls/{call_of_a['id']}/recording", headers=as_a, json={"content_type": "application/pdf", "size_bytes": 100})
    assert unsupported.status_code == 422 and unsupported.json()["error"]["code"] == "unsupported_media_type"

    monkeypatch.setattr(get_settings(), "max_recording_mb", 1)
    too_big = client.post(f"/api/v1/calls/{call_of_a['id']}/recording", headers=as_a, json={"content_type": "audio/wav", "size_bytes": 2 * 1024 * 1024})
    assert too_big.status_code == 422 and too_big.json()["error"]["code"] == "file_too_large"

    # the declared size is only a hint: the real stream is capped as well
    rec_id = create_meta(client, as_a, call_of_a["id"], wav_bytes(1)).json()["id"]
    oversized = wav_bytes(1) + b"\x00" * (1024 * 1024 + 10)
    resp = upload(client, as_a, rec_id, oversized)
    assert resp.status_code == 413 and resp.json()["error"]["code"] == "file_too_large"
    assert client.get(f"/api/v1/recordings/{rec_id}", headers=as_a).json()["upload_status"] == "failed"


def test_admin_delete_removes_object_and_metadata(client, recording_on, call_of_a, as_a, as_admin):
    from app.services.storage import get_storage

    audio = wav_bytes()
    rec_id = create_meta(client, as_a, call_of_a["id"], audio).json()["id"]
    up = upload(client, as_a, rec_id, audio).json()
    key_path = get_storage()._path(f"recordings/{now_utc():%Y}/{now_utc():%m}/{call_of_a['employee_id']}/{call_of_a['id']}.wav")  # noqa: SLF001
    assert key_path.exists() and up["size_bytes"] == len(audio)
    assert client.delete(f"/api/v1/recordings/{rec_id}", headers=as_a).status_code == 403
    assert client.delete(f"/api/v1/recordings/{rec_id}", headers=as_admin).status_code == 204
    assert not key_path.exists()
    assert client.get(f"/api/v1/recordings/{rec_id}", headers=as_admin).status_code == 404


def test_local_storage_blocks_path_traversal(tmp_path):
    from app.services.storage import LocalStorage

    storage = LocalStorage(str(tmp_path))
    with pytest.raises(ValueError):
        storage.save("../../escape.wav", io.BytesIO(wav_bytes()), "audio/wav", 10_000_000)
    with pytest.raises(ValueError):
        storage.size("../secret")


def test_s3_backend_issues_presigned_urls_and_stores_encrypted_objects(client, recording_on, call_of_a, as_a, monkeypatch):
    boto3 = pytest.importorskip("boto3")
    moto = pytest.importorskip("moto")
    from app.services import storage as storage_module

    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    settings = get_settings()
    monkeypatch.setattr(settings, "storage_backend", "s3")
    monkeypatch.setattr(settings, "aws_s3_bucket", "calling-recordings-test")
    monkeypatch.setattr(settings, "aws_region", "ap-south-1")
    storage_module.reset_storage()
    try:
        with moto.mock_aws():
            s3 = boto3.client("s3", region_name="ap-south-1")
            s3.create_bucket(Bucket="calling-recordings-test", CreateBucketConfiguration={"LocationConstraint": "ap-south-1"})
            audio = wav_bytes()
            rec_id = create_meta(client, as_a, call_of_a["id"], audio).json()["id"]
            assert upload(client, as_a, rec_id, audio).json()["upload_status"] == "available"

            keys = [o["Key"] for o in s3.list_objects_v2(Bucket="calling-recordings-test")["Contents"]]
            assert len(keys) == 1 and keys[0].startswith("recordings/")
            head = s3.head_object(Bucket="calling-recordings-test", Key=keys[0])
            assert head["ServerSideEncryption"] == "AES256"

            url = client.get(f"/api/v1/recordings/{rec_id}/playback-url", headers=as_a).json()["url"]
            assert url.startswith("https://") and "X-Amz-Signature=" in url and "X-Amz-Expires=" in url
    finally:
        monkeypatch.undo()
        storage_module.reset_storage()
