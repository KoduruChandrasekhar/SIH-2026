"""
TraceNet Phase 2 — multi-frame OCR consensus.

The reads of one transit are grouped as the same underlying plate when they are within
`max_edit_distance` (default 1) of any read already in a group, so a single mis-read
character (KA40A5855 / KA20A5855) never splits a vehicle into two plates. The largest
group wins (majority), and inside it the most frequent string (the mode) is the plate:

    TS09AB4521 0.94 · TS09AB4521 0.91 · TS09A84521 0.72   →   TS09AB4521

When no string is more frequent than the others, same-length reads get a
confidence-weighted per-character vote, so one mis-read character per frame is out-voted.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Optional, Sequence


@dataclass(frozen=True)
class Candidate:
    text: str          # corrected text (normalised when invalid)
    confidence: float
    valid: bool


@dataclass(frozen=True)
class ConsensusResult:
    text: str
    confidence: float
    valid: bool
    frames_used: int       # reads considered
    consensus_count: int   # reads exactly equal to `text`
    agreeing_count: int    # reads within the similarity tolerance
    voted: bool            # text came from the per-character vote


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def similarity(a: str, b: str) -> float:
    longest = max(len(a), len(b))
    return 1.0 if longest == 0 else 1.0 - levenshtein(a, b) / longest


def _char_vote(reads: Sequence[Candidate], length: int) -> str:
    votes: list[dict[str, float]] = [defaultdict(float) for _ in range(length)]
    for r in reads:
        for i, ch in enumerate(r.text):
            votes[i][ch] += r.confidence
    return "".join(max(v.items(), key=lambda kv: kv[1])[0] for v in votes)


def group_reads(reads: Sequence[Candidate], max_edit_distance: int = 1) -> list[list[Candidate]]:
    """Single-linkage grouping: a read joins the first group holding a read within `max_edit_distance`."""
    groups: list[list[Candidate]] = []
    # valid, confident reads seed the groups first so grouping does not depend on frame order
    for r in sorted(reads, key=lambda r: (not r.valid, -r.confidence, r.text)):
        home = next((g for g in groups if any(levenshtein(r.text, m.text) <= max_edit_distance for m in g)), None)
        if home is None:
            groups.append([r])
        else:
            home.append(r)
    return groups


def build_consensus(
    reads: Sequence[Candidate],
    max_edit_distance: int = 1,
    validator: Optional[Callable[[str], tuple[str, bool]]] = None,
) -> Optional[ConsensusResult]:
    """
    Group near-identical reads, take the majority group and its most frequent string.
    `validator(text) -> (corrected, valid)` re-checks a character-voted string. Returns None when no read has text.
    """
    usable = [r for r in reads if r.text]
    if not usable:
        return None

    # majority group: most reads, then most total confidence, then one holding a valid-format read
    groups = group_reads(usable, max_edit_distance)
    agreeing = max(groups, key=lambda g: (len(g), sum(r.confidence for r in g), any(r.valid for r in g)))

    # mode inside the group (valid-format strings preferred); ties broken by summed confidence, then text
    pool = [r for r in agreeing if r.valid] or agreeing
    counts: dict[str, int] = defaultdict(int)
    conf: dict[str, float] = defaultdict(float)
    for r in pool:
        counts[r.text] += 1
        conf[r.text] += r.confidence
    ranked = sorted(counts, key=lambda t: (-counts[t], -conf[t], t))
    best = ranked[0]
    best_valid = any(r.valid for r in pool if r.text == best)
    tied = len(ranked) > 1 and counts[ranked[1]] == counts[best]

    voted = False
    same_len = [r for r in agreeing if len(r.text) == len(best)]
    if tied and len(same_len) >= 2 and validator is not None:
        candidate = _char_vote(same_len, len(best))
        if candidate != best:
            corrected, ok = validator(candidate)
            # Accept the vote only if it does not lose format validity.
            if ok or not best_valid:
                best, best_valid, voted = corrected, ok, True

    exact = [r for r in usable if r.text == best]
    total_conf = sum(r.confidence for r in usable)
    agree_conf = sum(r.confidence for r in agreeing)
    base = (
        sum(r.confidence for r in exact) / len(exact)
        if exact
        else sum(r.confidence * similarity(best, r.text) for r in agreeing) / max(len(agreeing), 1)
    )
    confidence = base * (agree_conf / total_conf if total_conf > 0 else 0.0)

    return ConsensusResult(
        text=best,
        confidence=confidence,
        valid=best_valid,
        frames_used=len(reads),
        consensus_count=len(exact),
        agreeing_count=len(agreeing),
        voted=voted,
    )
