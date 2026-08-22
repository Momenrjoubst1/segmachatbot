from __future__ import annotations

import os
import re
import sys

# Ensure the pdf-processor root is on sys.path so `app` package resolves
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Patch missing constants in app.constants BEFORE any module that depends on
# them (extraction.py, figures.py) is imported by the test modules.
import app.constants as _constants  # noqa: E402

if not hasattr(_constants, "ARABIC_RE"):
    _constants.ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
if not hasattr(_constants, "LATIN_RE"):
    _constants.LATIN_RE = re.compile(r"[a-zA-Z]")
if not hasattr(_constants, "LTR_TOKEN_RE"):
    _constants.LTR_TOKEN_RE = re.compile(r"[a-zA-Z0-9]+")
if not hasattr(_constants, "ARABIC_PRESENTATION_RE"):
    _constants.ARABIC_PRESENTATION_RE = re.compile(
        r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]"
    )
if not hasattr(_constants, "MIN_CAPTION_LENGTH"):
    _constants.MIN_CAPTION_LENGTH = 10
