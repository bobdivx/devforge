#!/usr/bin/env python3
"""
Proxy transparent devant LiteLLM (:4000 → :4001).

Avant toute requête /v1/* (chat, models, embeddings…), acquiert le slot GPU `llm`
via l'arbitre (:8790). Cursor / agent.briseteia.me n'ont rien à changer.

Usage:
  LiteLLM écoute en interne sur 127.0.0.1:4001
  Ce proxy écoute sur 0.0.0.0:4000
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import time
import urllib.error
import urllib.request
from typing import Optional

LISTEN_HOST = os.environ.get("LITELLM_PROXY_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("LITELLM_PROXY_PORT", "4000"))
UPSTREAM = (
    os.environ.get("LITELLM_UPSTREAM_HOST", "127.0.0.1"),
    int(os.environ.get("LITELLM_UPSTREAM_PORT", "4001")),
)
ARBITER = os.environ.get("GPU_ARBITER_URL", "http://127.0.0.1:8790")
OWNER = os.environ.get("GPU_ARBITER_OWNER", "litellm-proxy")
ACQUIRE_TIMEOUT = float(os.environ.get("GPU_ACQUIRE_TIMEOUT_S", "600"))
LOG = os.environ.get("LITELLM_PROXY_LOG", "/mnt/ia/logs/litellm-gpu-proxy.log")

DOMAIN_SUFFIX = os.environ.get("CORS_ALLOW_DOMAIN_SUFFIX") or os.environ.get(
    "BRISETEIA_DOMAIN", "briseteia.me"
)


def origin_allowed(origin: str) -> bool:
    if not origin:
        return True
    o = origin.strip().lower().rstrip("/")
    # *.briseteia.me
    suf = DOMAIN_SUFFIX.lower().lstrip(".")
    if o.endswith("." + suf) or o.endswith("://" + suf):
        if o.startswith("https://") or o.startswith("http://"):
            return True
    return False


def cors_headers(origin: str | None) -> bytes:
    allow = "*"
    if origin and origin_allowed(origin):
        allow = origin
    return (
        f"Access-Control-Allow-Origin: {allow}\r\n"
        f"Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS\r\n"
        f"Access-Control-Allow-Headers: *\r\n"
        f"Access-Control-Allow-Credentials: true\r\n"
        f"Vary: Origin\r\n"
    ).encode("latin-1")


def parse_origin(header_block: bytes) -> str | None:
    for line in header_block.decode("latin-1", errors="replace").split("\n"):
        if line.lower().startswith("origin:"):
            return line.split(":", 1)[1].strip()
    return None


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def http_json(method: str, url: str, body: dict | None = None, timeout: float = 30) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def ensure_llm_slot() -> tuple[bool, str]:
    """Acquire llm slot (blocks until ready or timeout)."""
    try:
        # Fast path: already llm + llama up?
        st = http_json("GET", f"{ARBITER}/status", timeout=5)
        if st.get("slot") == "llm" and st.get("procs", {}).get("llama") and not st.get("switching"):
            try:
                http_json("POST", f"{ARBITER}/touch", {"owner": OWNER}, timeout=5)
            except Exception:  # noqa: BLE001
                pass
            return True, "already"
        log("acquire llm for Cursor/LiteLLM…")
        r = http_json(
            "POST",
            f"{ARBITER}/acquire",
            {"slot": "llm", "owner": OWNER, "timeout_s": ACQUIRE_TIMEOUT},
            timeout=ACQUIRE_TIMEOUT + 30,
        )
        if r.get("ok"):
            log(f"llm ready vram={r.get('vram_used_mib')} MiB")
            return True, "acquired"
        return False, str(r.get("error") or r)
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def path_needs_llm(path: str) -> bool:
    p = path.split("?", 1)[0]
    if p in ("/health", "/health/liveliness", "/health/readiness", "/"):
        return False
    return any(p.startswith(pref) for pref in NEED_LLM_PREFIXES)


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (asyncio.CancelledError, ConnectionResetError, BrokenPipeError, OSError):
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass


async def read_headers(reader: asyncio.StreamReader) -> tuple[bytes, bytes, str, str]:
    """Return (request_line, header_block, method, path)."""
    line = await reader.readline()
    if not line:
        raise ConnectionError("empty request")
    parts = line.decode("latin-1", errors="replace").strip().split()
    method = parts[0] if parts else "GET"
    path = parts[1] if len(parts) > 1 else "/"
    headers = bytearray()
    while True:
        h = await reader.readline()
        if not h or h in (b"\r\n", b"\n"):
            headers.extend(h)
            break
        headers.extend(h)
    return line, bytes(headers), method, path


async def send_error(writer: asyncio.StreamWriter, code: int, msg: str) -> None:
    body = json.dumps(
        {
            "error": {
                "message": msg,
                "type": "gpu_arbiter_error",
                "code": code,
            }
        }
    ).encode("utf-8")
    writer.write(
        f"HTTP/1.1 {code} Error\r\n"
        f"Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Connection: close\r\n\r\n".encode("latin-1")
        + body
    )
    await writer.drain()
    writer.close()
    try:
        await writer.wait_closed()
    except Exception:  # noqa: BLE001
        pass


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("peername")
    try:
        req_line, header_block, method, path = await read_headers(reader)
    except Exception as e:  # noqa: BLE001
        log(f"bad request from {peer}: {e}")
        writer.close()
        return

    origin = parse_origin(header_block)

    # Preflight CORS (frontends *.briseteia.me → agent.briseteia.me)
    if method.upper() == "OPTIONS":
        body = b""
        writer.write(
            b"HTTP/1.1 204 No Content\r\n"
            + cors_headers(origin)
            + b"Content-Length: 0\r\nConnection: close\r\n\r\n"
            + body
        )
        await writer.drain()
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        return

    # Ensure GPU before proxying LLM traffic
    if path_needs_llm(path):
        ok, detail = await asyncio.get_event_loop().run_in_executor(None, ensure_llm_slot)
        if not ok:
            log(f"acquire failed for {path}: {detail}")
            await send_error(
                writer,
                503,
                f"GPU busy / LLM unavailable: {detail}. "
                f"Try again or demeter-gpu status. Arbiter={ARBITER}",
            )
            return

    try:
        up_reader, up_writer = await asyncio.open_connection(UPSTREAM[0], UPSTREAM[1])
    except OSError as e:
        log(f"upstream {UPSTREAM} down: {e}")
        await send_error(writer, 502, f"LiteLLM upstream {UPSTREAM[0]}:{UPSTREAM[1]} unreachable: {e}")
        return

    # Forward original request head; remaining body streams via pipe
    up_writer.write(req_line + header_block)
    await up_writer.drain()

    t1 = asyncio.create_task(pipe(reader, up_writer))
    t2 = asyncio.create_task(pipe(up_reader, writer))
    done, pending = await asyncio.wait({t1, t2}, return_when=asyncio.FIRST_COMPLETED)
    for t in pending:
        t.cancel()
    for t in done:
        try:
            t.result()
        except Exception:  # noqa: BLE001
            pass


async def main() -> None:
    log(f"LiteLLM GPU proxy {LISTEN_HOST}:{LISTEN_PORT} → {UPSTREAM[0]}:{UPSTREAM[1]} arbiter={ARBITER}")
    server = await asyncio.start_server(handle, LISTEN_HOST, LISTEN_PORT)
    stop = asyncio.Event()

    def _stop(*_a: object) -> None:
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _stop)
        except NotImplementedError:
            pass

    async with server:
        await stop.wait()
    log("proxy stopped")


if __name__ == "__main__":
    asyncio.run(main())
