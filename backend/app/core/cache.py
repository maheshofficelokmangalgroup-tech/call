"""Shared, short-lived caches in Redis, cleared by the change they depend on.

Why: most requests only *read* (who is signed in, what the settings are, today's queue, the numbers on the admin panel). Asking MySQL
the same question for every request is what makes a service slow when hundreds of phones are calling at the same time.

Rules that keep an answer from ever being wrong:
  * a cache only ever holds something that was true when it was stored, and only for a few seconds;
  * the change that makes it untrue clears it - after the database has committed it, never before (`defer_until_commit`);
  * a cached value carries the "epoch" it was made under; bumping the epoch makes every value of that kind invalid at once;
  * when Redis cannot be reached - or is only the per-process stand-in on a real server - nothing is cached and the database answers.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from typing import Any

import redis
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.redis_client import get_redis

log = logging.getLogger(__name__)

EPOCH_TTL_SECONDS = 30 * 24 * 3600


def enabled() -> bool:
    """Caches are used with a real Redis. The in-memory stand-in is shared by nobody (every worker has its own), so on a real
    server it would hide changes made through another worker: there it is only accepted while developing and testing."""
    store = get_redis()
    if getattr(store, "is_fallback", False):
        return get_settings().app_env in ("local", "development", "test")
    return True


# ------------------------------------------------------------------------------------------------ plain values
def get_json(key: str) -> Any | None:
    if not enabled():
        return None
    try:
        raw = get_redis().get(f"c:{key}")
    except redis.RedisError:
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    if ttl_seconds <= 0 or not enabled():
        return
    try:
        get_redis().set(f"c:{key}", json.dumps(value, default=str, separators=(",", ":")), ex=ttl_seconds)
    except redis.RedisError:
        pass


def delete(*keys: str) -> None:
    if not keys or not enabled():
        return
    try:
        get_redis().delete(*[f"c:{k}" for k in keys])
    except redis.RedisError:
        pass


def once_per(key: str, seconds: int) -> bool:
    """True for the first caller in each `seconds` window (a cheap "first one wins" gate that all workers share)."""
    try:
        return bool(get_redis().set(f"c:once:{key}", "1", ex=max(1, seconds), nx=True))
    except redis.RedisError:
        return True  # cannot tell: let the caller do the work (it is only ever a little more work, never a wrong answer)


# ------------------------------------------------------------------------------------------------ epochs
def epochs(*names: str) -> list[int] | None:
    """The current epoch of each name, or None if any of them is unknown (then nothing built on it may be trusted)."""
    if not enabled():
        return None
    try:
        values = get_redis().mget([f"c:ep:{n}" for n in names])
    except redis.RedisError:
        return None
    if any(v is None for v in values):
        return None
    try:
        return [int(v) for v in values]  # type: ignore[arg-type]
    except ValueError:
        return None


def ensure_epochs(*names: str) -> list[int] | None:
    """Like `epochs`, creating a name that does not exist yet. A name that later vanishes (evicted, flushed) never matches an
    older cached value again, because values are stamped with what was read here."""
    if not enabled():
        return None
    try:
        store = get_redis()
        now_ms = str(int(time.time() * 1000))
        for n in names:
            store.set(f"c:ep:{n}", now_ms, ex=EPOCH_TTL_SECONDS, nx=True)
    except redis.RedisError:
        return None
    return epochs(*names)


def bump_now(*names: str) -> None:
    """Make everything built on these epochs invalid. Used from `bump` after the database commit."""
    if not names or not enabled():
        return
    try:
        store = get_redis()
        # a time-based value only ever grows, even if two workers bump in the same millisecond (a counter would also work)
        stamp = int(time.time() * 1000)
        for n in names:
            current = store.get(f"c:ep:{n}")
            nxt = max(stamp, int(current) + 1) if current and current.isdigit() else stamp
            store.set(f"c:ep:{n}", str(nxt), ex=EPOCH_TTL_SECONDS)
    except redis.RedisError:
        pass


def stamped_get(key: str, *epoch_names: str) -> Any | None:
    """A value stored with `stamped_set`, if the epochs it was made under are still the current ones."""
    current = epochs(*epoch_names)
    if current is None:
        return None
    entry = get_json(key)
    if not isinstance(entry, dict) or entry.get("ep") != current:
        return None
    return entry.get("v")


def stamped_set(key: str, value: Any, ttl_seconds: int, *epoch_names: str) -> None:
    current = ensure_epochs(*epoch_names)
    if current is None:
        return
    set_json(key, {"ep": current, "v": value}, ttl_seconds)


# ------------------------------------------------------------------------------------------------ after the commit
_DEFERRED = "cache.after_commit"


def defer_until_commit(db: Session, action: Callable[[], None]) -> None:
    """Run `action` once the current transaction has really been committed (and never if it is rolled back).

    Clearing a cache *before* the commit would let another request read the old rows, cache them again, and keep serving
    them after the commit.
    """
    db.info.setdefault(_DEFERRED, []).append(action)


_BUMPS = "cache.bumps"


def bump(db: Session, *names: str) -> None:
    """Make everything built on these epochs invalid, once this transaction has committed. (A transaction that changes the same
    thing a hundred times bumps it once.)"""
    pending = db.info.get(_BUMPS)
    if pending is None:
        pending = db.info[_BUMPS] = set()

        def _apply() -> None:
            bump_now(*sorted(pending))

        defer_until_commit(db, _apply)
    pending.update(names)


_DIRTY = "cache.dirty"


def mark_dirty(db: Session, name: str) -> None:
    """This transaction has changed what `name` caches but has not committed yet: until it does, its own reads must go to the
    database (it has to see its own change), and the cache is cleared once the change is committed."""
    db.info.setdefault(_DIRTY, set()).add(name)


def is_dirty(db: Session, name: str) -> bool:
    return name in db.info.get(_DIRTY, ())


def _forget_notes(session: Session) -> None:
    for key in [k for k in session.info if isinstance(k, str) and k.startswith("cache.")]:
        session.info.pop(key, None)


@event.listens_for(Session, "after_commit")
def _run_deferred(session: Session) -> None:
    actions = session.info.get(_DEFERRED) or []
    # (what an action needs it holds itself; the next transaction starts with clean notes)
    _forget_notes(session)
    for action in actions:
        try:
            action()
        except Exception:  # a cache must never break a request that has already succeeded
            log.warning("A cache could not be cleared after a commit", exc_info=True)


@event.listens_for(Session, "after_rollback")
def _drop_deferred(session: Session) -> None:
    _forget_notes(session)


def digest(*parts: object) -> str:
    """A short stable name for a set of request parameters."""
    import hashlib

    return hashlib.blake2b("|".join(str(p) for p in parts).encode("utf-8"), digest_size=8).hexdigest()  # 16 characters; a cache key, not a secret


# ------------------------------------------------------------------------------------------------ stale while revalidate
def _refresh_in_background(key: str, keep_seconds: int, compute: Callable[[], Any]) -> None:
    try:
        set_json(key, {"at": time.time(), "v": compute()}, keep_seconds)
    except Exception:  # noqa: BLE001 - the old answer stays; the next look tries again
        log.warning("Could not refresh %s in the background", key, exc_info=True)


def stale_while_revalidate(key: str, fresh_seconds: int, keep_seconds: int, compute: Callable[[], Any]) -> Any:
    """The last answer of `compute()`, however old (up to `keep_seconds`), at once. An answer older than `fresh_seconds` is still
    given, and ONE caller (of all the workers) starts working out a new one in the background - so nobody ever waits for a slow
    question except the very first time, when there is no answer yet. `compute` must not use the caller's database session: it runs
    in a thread of its own after the request is over."""
    if not enabled():
        return compute()
    entry = get_json(key)
    if isinstance(entry, dict) and "v" in entry and "at" in entry:
        try:
            age = time.time() - float(entry["at"])
        except (TypeError, ValueError):
            age = fresh_seconds + 1
        if age > fresh_seconds and once_per(f"swr:{key}", max(5, fresh_seconds)):
            threading.Thread(target=_refresh_in_background, args=(key, keep_seconds, compute), name="swr-refresh", daemon=True).start()
        return entry["v"]
    value = compute()
    set_json(key, {"at": time.time(), "v": value}, keep_seconds)
    return value


# ------------------------------------------------------------------------------------------------ single flight
def single_flight(key: str, ttl_seconds: int, compute: Callable[[], Any], *, epoch_names: tuple[str, ...] = (), lock_seconds: int = 10) -> Any:
    """Cached JSON-able result of `compute()`. When many viewers ask at the same moment, one computes and the rest wait for it
    (a dashboard refreshed by ten people every few seconds costs the database one query set per few seconds, not ten).

    The result is good for `ttl_seconds` - unless one of the epochs it was made under changes first (an employee is added, a
    setting is edited): then nobody is served the old one.
    """
    if ttl_seconds <= 0 or not enabled():
        return compute()
    stamp = ensure_epochs(*epoch_names) if epoch_names else []  # read BEFORE computing: a change during the work makes the result stale on arrival
    if stamp is None:
        return compute()

    def remembered() -> Any | None:
        entry = get_json(key)
        return entry["v"] if isinstance(entry, dict) and entry.get("ep") == stamp and "v" in entry else None

    hit = remembered()
    if hit is not None:
        return hit
    store = get_redis()
    lock_key = f"c:lock:{key}:{'.'.join(str(s) for s in stamp)}"
    try:
        won = bool(store.set(lock_key, "1", ex=lock_seconds, nx=True))
    except redis.RedisError:
        return compute()
    if not won:
        deadline = time.monotonic() + lock_seconds
        while time.monotonic() < deadline:
            time.sleep(0.05)
            hit = remembered()
            if hit is not None:
                return hit
        return compute()  # the other worker was too slow or died: do it ourselves
    try:
        value = compute()
        set_json(key, {"ep": stamp, "v": value}, ttl_seconds)
        return value
    finally:
        try:
            store.delete(lock_key)
        except redis.RedisError:
            pass
