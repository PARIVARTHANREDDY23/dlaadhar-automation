import logging
import re
from logging.handlers import RotatingFileHandler
from collections import deque
from pathlib import Path
from typing import List, Dict, Any
from config import LOG_FILE, LOGS_DIR

# Thread-safe in-memory log buffer for dashboard display
LOG_BUFFER = deque(maxlen=500)

class PIIMaskingFormatter(logging.Formatter):
    """
    Formatter that masks sensitive personal identifiable information (PII)
    such as DL Numbers, DOBs, and Phone Numbers in log messages.
    """
    # Matches patterns like DL0420110012345 or DL-14-2011-0012345
    DL_PATTERN = re.compile(r'\b([A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?)[0-9]{4,7}\b', re.IGNORECASE)
    # Matches DOB patterns like 15-08-1990, 1990/08/15, 15/08/1990
    DOB_PATTERN = re.compile(r'\b(\d{1,4}[-/]\d{1,2}[-/]\d{1,4})\b')
    # Matches 10-digit Indian phone numbers
    PHONE_PATTERN = re.compile(r'\b(?:\+91[- ]?|0)?[6-9]\d{5}(\d{4})\b')

    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        
        # Mask DL number - keep first 8 characters, mask the rest
        def mask_dl(match):
            prefix = match.group(1)
            return prefix + "*****"
            
        # Mask phone - keep last 4 digits
        def mask_phone(match):
            suffix = match.group(1)
            return "******" + suffix

        msg = self.DL_PATTERN.sub(mask_dl, msg)
        msg = self.PHONE_PATTERN.sub(mask_phone, msg)
        # In logs, mask explicit DOB formats if labeled or detected
        msg = re.sub(r'(DOB\s*[:=]\s*)(\S+)', r'\1**/**/****', msg, flags=re.IGNORECASE)
        msg = re.sub(r'(Date of Birth\s*[:=]\s*)(\S+)', r'\1**/**/****', msg, flags=re.IGNORECASE)
        return msg

class InMemoryLogHandler(logging.Handler):
    """Stores recent logs in memory for live display in the Streamlit UI."""
    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            LOG_BUFFER.append({
                "timestamp": self.formatter.formatTime(record, "%Y-%m-%d %H:%M:%S") if self.formatter else "",
                "level": record.levelname,
                "message": msg
            })
        except Exception:
            self.handleError(record)

_logger = None

def get_logger(name: str = "DL_Verification") -> logging.Logger:
    global _logger
    if _logger is not None:
        return _logger

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if not logger.handlers:
        formatter = PIIMaskingFormatter(
            fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )

        # File Handler (5 MB max, 5 backups)
        file_handler = RotatingFileHandler(
            LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(logging.INFO)
        logger.addHandler(file_handler)

        # Console Handler
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        console_handler.setLevel(logging.INFO)
        logger.addHandler(console_handler)

        # In-memory buffer handler for Streamlit
        mem_handler = InMemoryLogHandler()
        mem_handler.setFormatter(formatter)
        mem_handler.setLevel(logging.INFO)
        logger.addHandler(mem_handler)

    _logger = logger
    return _logger

def get_recent_logs(limit: int = 100) -> List[Dict[str, Any]]:
    """Retrieve recent in-memory logs for UI."""
    return list(LOG_BUFFER)[-limit:]

