import threading

from ytmusicapi import YTMusic

_clients: dict[str, YTMusic] = {}
_lock = threading.Lock()


def get_client(slot: str = "default") -> YTMusic:
    with _lock:
        if slot not in _clients:
            _clients[slot] = YTMusic()
        return _clients[slot]
