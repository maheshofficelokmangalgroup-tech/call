"""Private object storage for call recordings: local filesystem (development) or AWS S3 (production).

Objects are never public. Playback goes through short-lived signed URLs only.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path
from typing import BinaryIO, Protocol

from app.core.config import get_settings
from app.core.errors import PayloadTooLarge

CHUNK = 256 * 1024


class StorageBackend(Protocol):
    name: str

    def save(self, key: str, fileobj: BinaryIO, content_type: str, max_bytes: int) -> tuple[int, str]: ...
    def size(self, key: str) -> int: ...
    def iter_range(self, key: str, start: int, end: int) -> Iterator[bytes]: ...
    def delete(self, key: str) -> None: ...
    def presigned_url(self, key: str, ttl_seconds: int, *, content_type: str, filename: str, download: bool) -> str | None: ...


def _copy_limited(src: BinaryIO, dst: BinaryIO, max_bytes: int) -> tuple[int, str]:
    sha = hashlib.sha256()
    size = 0
    while True:
        chunk = src.read(CHUNK)
        if not chunk:
            break
        size += len(chunk)
        if size > max_bytes:
            raise PayloadTooLarge(f"Recording is larger than {max_bytes // (1024 * 1024)} MB.", code="file_too_large")
        sha.update(chunk)
        dst.write(chunk)
    return size, sha.hexdigest()


class LocalStorage:
    name = "local"

    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root != path and self.root not in path.parents:
            raise ValueError("Invalid storage key")
        return path

    def save(self, key: str, fileobj: BinaryIO, content_type: str, max_bytes: int) -> tuple[int, str]:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), suffix=".part")
        try:
            with os.fdopen(fd, "wb") as out:
                size, digest = _copy_limited(fileobj, out, max_bytes)
            os.replace(tmp_name, target)
            return size, digest
        except Exception:
            Path(tmp_name).unlink(missing_ok=True)
            raise

    def size(self, key: str) -> int:
        return self._path(key).stat().st_size

    def iter_range(self, key: str, start: int, end: int) -> Iterator[bytes]:
        remaining = end - start + 1
        with open(self._path(key), "rb") as fh:
            fh.seek(start)
            while remaining > 0:
                chunk = fh.read(min(CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def presigned_url(self, key: str, ttl_seconds: int, *, content_type: str, filename: str, download: bool) -> str | None:
        return None  # served by the API itself through a signed /stream URL


class S3Storage:
    name = "s3"

    def __init__(self) -> None:
        import boto3

        settings = get_settings()
        self.bucket = settings.aws_s3_bucket or ""
        kwargs: dict = {"region_name": settings.aws_region}
        if settings.aws_access_key_id and settings.aws_secret_access_key:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        if settings.s3_endpoint_url:
            kwargs["endpoint_url"] = settings.s3_endpoint_url
        self.client = boto3.client("s3", **kwargs)

    def save(self, key: str, fileobj: BinaryIO, content_type: str, max_bytes: int) -> tuple[int, str]:
        with tempfile.TemporaryFile() as tmp:
            size, digest = _copy_limited(fileobj, tmp, max_bytes)
            tmp.seek(0)
            self.client.upload_fileobj(
                tmp,
                self.bucket,
                key,
                ExtraArgs={"ContentType": content_type, "ServerSideEncryption": "AES256"},
            )
        return size, digest

    def size(self, key: str) -> int:
        return int(self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])

    def iter_range(self, key: str, start: int, end: int) -> Iterator[bytes]:
        obj = self.client.get_object(Bucket=self.bucket, Key=key, Range=f"bytes={start}-{end}")
        yield from obj["Body"].iter_chunks(CHUNK)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def presigned_url(self, key: str, ttl_seconds: int, *, content_type: str, filename: str, download: bool) -> str | None:
        disposition = f'{"attachment" if download else "inline"}; filename="{filename}"'
        return self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentType": content_type,
                "ResponseContentDisposition": disposition,
            },
            ExpiresIn=ttl_seconds,
        )


@lru_cache
def get_storage() -> StorageBackend:
    settings = get_settings()
    if settings.storage_backend == "s3":
        return S3Storage()
    return LocalStorage(settings.local_storage_path)


def reset_storage() -> None:
    get_storage.cache_clear()


# Magic-number checks so a renamed executable/document cannot be stored as "audio".
def looks_like_audio(header: bytes) -> bool:
    if len(header) < 12:
        return False
    if header[:3] == b"ID3" or (header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):  # mp3 / aac (ADTS)
        return True
    if header[4:8] == b"ftyp":  # mp4 / m4a / 3gp
        return True
    if header[:4] == b"RIFF" and header[8:12] == b"WAVE":
        return True
    if header[:4] == b"OggS" or header[:4] == b"fLaC":
        return True
    if header.startswith(b"#!AMR"):  # AMR-NB and AMR-WB
        return True
    if header[:4] == b"\x1a\x45\xdf\xa3":  # webm / matroska
        return True
    return False
