"""Exponential backoff with jitter for failed job retries."""

import random


def calculate_backoff(attempt: int) -> float:
    """Return backoff delay in seconds for the given attempt number (1-indexed).

    Formula:
        base_delays = [1, 5, 25]
        jitter_ranges = [0.2, 1.0, 3.0]
        base = base_delays[attempt - 1]
        jitter = random.uniform(-jitter_ranges[attempt - 1], jitter_ranges[attempt - 1])
        return max(0.1, base + jitter)
    """
    base_delays = [1, 5, 25]
    jitter_ranges = [0.2, 1.0, 3.0]
    if attempt < 1:
        attempt = 1
    idx = min(attempt - 1, len(base_delays) - 1)
    base = base_delays[idx]
    jitter = random.uniform(-jitter_ranges[idx], jitter_ranges[idx])
    return max(0.1, base + jitter)
