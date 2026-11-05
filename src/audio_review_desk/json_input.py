"""Parse external JSON without silently choosing among repeated properties."""
from __future__ import annotations

import json
from typing import Callable


def loads_unique(content: str | bytes, *, context: str,
                 checkpoint: Callable[[], None] | None = None):
    def unique_object(pairs):
        result = {}
        for name, value in pairs:
            if checkpoint is not None:
                checkpoint()
            if name in result:
                raise ValueError(f"{context} contains duplicate property {name!r}")
            result[name] = value
        return result

    return json.loads(content, object_pairs_hook=unique_object)
