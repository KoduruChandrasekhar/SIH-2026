"""
TraceNet Phase 2 — Indian registration plate normalisation + validation.

Formats:
    STANDARD  ^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$   e.g. TS09AB4521, DL8CAK0211 (1-digit Delhi/UT district)
    BH        ^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$           e.g. 22BH1234AA

A STANDARD plate must also start with a real state / UT code (STATE_CODES); BH plates carry no state code.
Stock-footage watermark text (Getty, iStock, …) is rejected before any format is tried.

OCR confusions are corrected POSITIONALLY: the format is fixed first, then a
substitution is only applied where that position expects the other character
class (a digit in the state code becomes a letter, a letter in the serial
number becomes a digit). Characters are never substituted blindly.
"""

from __future__ import annotations

import re
from typing import Optional

from .models import PlateValidation

HSRP_REGEX = re.compile(r"^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$")
STANDARD_RE = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$")
BH_RE = re.compile(r"^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$")

# Registration codes of every Indian state and union territory, legacy codes included
# (OR→OD, UA→UK, DN→DD, TS→TG). TG is Telangana's code since March 2024.
STATE_CODES = frozenset({
    "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DD", "DL", "DN", "GA", "GJ", "HP", "HR", "JH", "JK", "KA", "KL",
    "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "TG",
    "UK", "UA", "UP", "WB",
})

# Stock-footage watermarks OCR picks up from demo clips — never a plate
WATERMARK_TOKENS = ("GETTY", "ISTOCK", "SHUTTER", "ALAMY", "IMAGES")

# Digit → letter where a letter is expected
STATE_TO_ALPHA = {"0": "O", "8": "B", "1": "I"}
SERIES_TO_ALPHA = {"0": "O", "8": "B", "1": "I", "2": "Z"}   # 2→Z mirrors the district Z→2
# Letter → digit where a digit is expected
DISTRICT_TO_DIGIT = {"O": "0", "B": "8", "Z": "2"}
NUMBER_TO_DIGIT = {"O": "0", "B": "8"}

_NOISE = re.compile(r"[^A-Z0-9]")


def normalize_text(text: Optional[str]) -> str:
    """Uppercase and strip spaces, hyphens, punctuation and other noise."""
    return _NOISE.sub("", (text or "").upper())


def _correct(text: str, layout: list[tuple[str, dict[str, str]]], corrections: list[str]) -> str:
    """Apply per-position maps. layout[i] = (expected 'A'|'D'|literal, substitution map)."""
    out = []
    for i, (ch, (expect, mapping)) in enumerate(zip(text, layout)):
        wrong_class = (expect == "A" and ch.isdigit()) or (expect == "D" and ch.isalpha()) or (
            len(expect) == 1 and expect not in ("A", "D") and ch != expect
        )
        if wrong_class and ch in mapping:
            corrections.append(f"{ch}->{mapping[ch]}@{i}")
            ch = mapping[ch]
        out.append(ch)
    return "".join(out)


def _standard_layout(length: int, district_len: int) -> Optional[list[tuple[str, dict[str, str]]]]:
    series_len = length - 2 - district_len - 4      # state + district + series + 4-digit number
    if not 0 <= series_len <= 3:
        return None
    return (
        [("A", STATE_TO_ALPHA)] * 2
        + [("D", DISTRICT_TO_DIGIT)] * district_len
        + [("A", SERIES_TO_ALPHA)] * series_len
        + [("D", NUMBER_TO_DIGIT)] * 4
    )


def _bh_layout(length: int) -> Optional[list[tuple[str, dict[str, str]]]]:
    suffix_len = length - 8      # 2 year + "BH" + 4 number
    if not 1 <= suffix_len <= 2:
        return None
    return (
        [("D", DISTRICT_TO_DIGIT)] * 2
        + [("B", {"8": "B"}), ("H", {})]
        + [("D", NUMBER_TO_DIGIT)] * 4
        + [("A", SERIES_TO_ALPHA)] * suffix_len
    )


def _try(text: str, fmt: str) -> tuple[Optional[str], list[str], Optional[str]]:
    """(corrected text | None, corrections, reject reason). STANDARD tries a 2-digit district first, then 1-digit."""
    if fmt == "BH":
        layouts = [_bh_layout(len(text))]
    else:
        layouts = [_standard_layout(len(text), 2), _standard_layout(len(text), 1)]
    reason = None
    for layout in layouts:
        if layout is None:
            continue
        corrections: list[str] = []
        corrected = _correct(text, layout, corrections)
        if not (BH_RE if fmt == "BH" else STANDARD_RE).match(corrected):
            continue
        if fmt == "STANDARD" and corrected[:2] not in STATE_CODES:
            reason = "unknown_state_code"       # right shape, but no such state (e.g. XA03BF1027)
            continue
        return corrected, corrections, None
    return None, [], reason


def validate_plate(raw_text: Optional[str]) -> PlateValidation:
    """Normalise, pick the format, correct positionally and validate."""
    raw = raw_text or ""
    normalized = normalize_text(raw)

    if any(token in normalized for token in WATERMARK_TOKENS):
        return PlateValidation(raw, normalized, normalized, None, False, [], "watermark_text")

    # Many Indian plates carry an "IND" hologram strip that OCR picks up.
    variants = [normalized]
    if normalized.startswith("IND") and len(normalized) > 11:
        variants.append(normalized[3:])

    reason = None
    for text in variants:
        # BH is only considered when positions 2-3 read as BH (or 8H) — never a guess.
        formats = ["BH", "STANDARD"] if text[2:4] in ("BH", "8H") else ["STANDARD"]
        for fmt in formats:
            corrected, corrections, why = _try(text, fmt)
            if corrected:
                if text is not normalized:
                    corrections = ["strip:IND"] + corrections
                return PlateValidation(raw, normalized, corrected, fmt, True, corrections)
            reason = reason or why

    return PlateValidation(raw, normalized, normalized, None, False, [], reason or ("no_text" if not normalized else "format"))
