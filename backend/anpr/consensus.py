"""
TraceNet Phase 2 — multi-frame OCR consensus.

Reads from the top-K quality-ranked crops of one transit are compared with a
normalised edit distance, weighted by OCR confidence, and the most consistent
string wins. Same-length agreeing reads also get a confidence-weighted
per-character vote, so one mis-read character in one frame is out-voted:

    TS09AB4521 0.94 · TS09AB4521 0.91 · TS09A84521 0.72   →   TS09AB4521
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


def build_consensus(
    reads: Sequence[Candidate],
    similarity_threshold: float = 0.8,
    validator: Optional[Callable[[str], tuple[str, bool]]] = None,
) -> Optional[ConsensusResult]:
    """
    Pick the most consistent plate string. `validator(text) -> (corrected, valid)`
    re-checks a character-voted string. Returns None when no read has text.
    """
    usable = [r for r in reads if r.text]
    if not usable:
        return None

    # Valid-format strings are preferred as consensus centres when any exist.
    pool = [r for r in usable if r.valid] or usable

    def support(text: str) -> float:
        return sum(r.confidence * s for r in usable if (s := similarity(text, r.text)) >= similarity_threshold)

    centres = sorted({r.text for r in pool})   # sorted: deterministic tie-breaking
    best = max(centres, key=lambda t: (support(t), max(r.confidence for r in pool if r.text == t)))
    best_valid = any(r.valid for r in pool if r.text == best)

    agreeing = [r for r in usable if similarity(best, r.text) >= similarity_threshold]

    voted = False
    same_len = [r for r in agreeing if len(r.text) == len(best)]
    if len(same_len) >= 2 and validator is not None:
        candidate = _char_vote(same_len, len(best))
        if candidate != best:
            corrected, ok = validator(candidate)
            # Accept the vote only if it does not lose format validity.
            if ok or not best_valid:
                best, best_valid, voted = corrected, ok, True
                agreeing = [r for r in usable if similarity(best, r.text) >= similarity_threshold]

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
