import threading

from ytmusicapi import YTMusic

_clients: dict[str, YTMusic] = {}
_lock = threading.Lock()


def get_client(slot: str = "default") -> YTMusic:
    client = _clients.get(slot)
    if client is None:
        with _lock:
            client = _clients.get(slot)
            if client is None:
                client = YTMusic()
                _clients[slot] = client
    return client


def reset_client() -> None:
    with _lock:
        _clients.clear()
