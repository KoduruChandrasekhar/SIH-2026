"""
TraceNet — License Plate OCR Engine (Phase 2 Preparation)

Isolated OCR module utilizing PaddleOCR for license plate recognition.
Accepts an image file path or numpy array crop and returns:
{
    "text": "...",
    "confidence": 0.0
}
"""

from typing import Union, Dict, Any, Optional
import numpy as np

try:
    from paddleocr import PaddleOCR
    PADDLE_AVAILABLE = True
except ImportError:
    PADDLE_AVAILABLE = False


class LicensePlateOCR:
    """
    Reusable OCR module using PaddleOCR API.
    """

    def __init__(self, use_angle_cls: bool = True, lang: str = "en"):
        self.enabled = PADDLE_AVAILABLE
        self.ocr = None
        if self.enabled:
            try:
                # Initialize PaddleOCR with English OCR model
                self.ocr = PaddleOCR(use_angle_cls=use_angle_cls, lang=lang)
            except Exception as e:
                print(f"[OCR Module Warning] Failed to initialize PaddleOCR: {e}")
                self.enabled = False

    def predict(self, img_input: Union[str, np.ndarray]) -> Dict[str, Any]:
        """
        Recognize license plate text from image path or numpy crop array.

        Returns:
            Dict containing:
                "text": Recognized license plate string or empty string
                "confidence": Float confidence score (0.0 to 1.0)
        """
        if not self.enabled or self.ocr is None:
            return {
                "text": "",
                "confidence": 0.0,
                "error": "PaddleOCR is not installed or initialized."
            }

        try:
            try:
                results = self.ocr.ocr(img_input)
            except Exception:
                results = self.ocr.predict(img_input)

            if not results:
                return {"text": "", "confidence": 0.0}

            best_text = ""
            max_conf = 0.0

            lines = results[0] if isinstance(results, list) and len(results) > 0 else results
            if isinstance(lines, dict) and "rec_text" in lines:
                best_text = lines.get("rec_text", "")
                max_conf = float(lines.get("rec_score", 0.0))
            elif isinstance(lines, list):
                for line in lines:
                    if isinstance(line, dict):
                        text = line.get("rec_text", line.get("text", ""))
                        conf = float(line.get("rec_score", line.get("score", 0.0)))
                        if conf > max_conf:
                            best_text = text
                            max_conf = conf
                    elif isinstance(line, (tuple, list)) and len(line) >= 2:
                        if isinstance(line[1], (tuple, list)):
                            text, conf = line[1][0], float(line[1][1])
                            if conf > max_conf:
                                best_text = text
                                max_conf = conf

            clean_text = "".join(c for c in str(best_text) if c.isalnum()).upper()

            return {
                "text": clean_text if clean_text else str(best_text).strip(),
                "confidence": round(max_conf, 4)
            }
        except Exception as e:
            return {
                "text": "",
                "confidence": 0.0,
                "error": str(e)
            }


# Shared singleton instance
_ocr_instance: Optional[LicensePlateOCR] = None

def recognize_plate(img_input: Union[str, np.ndarray]) -> Dict[str, Any]:
    """
    Helper function to run OCR on an image crop or path.
    """
    global _ocr_instance
    if _ocr_instance is None:
        _ocr_instance = LicensePlateOCR()
    return _ocr_instance.predict(img_input)
