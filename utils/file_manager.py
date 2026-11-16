import os
import shutil
import zipfile
import re
from datetime import datetime
from pathlib import Path
from typing import Tuple, List, Dict, Optional, Any
from config import BACKUPS_DIR, REPORTS_DIR
from utils.logger import get_logger

logger = get_logger("FileManager")

def sanitize_filename_part(part: str) -> str:
    """Removes invalid characters for Windows filenames."""
    if not part:
        return "UNKNOWN"
    # Remove chars that are illegal in Windows filenames: \ / : * ? " < > |
    sanitized = re.sub(r'[\\/*?:"<>|\s]', '_', str(part).strip())
    return sanitized if sanitized else "UNKNOWN"

def generate_report_filename(gsm_id: str, phone_number: str) -> str:
    """
    Format required: GSMID_PHONENUMBER_DL_Report.pdf
    Example: GSM001_9876543210_DL_Report.pdf
    """
    clean_gsm = sanitize_filename_part(gsm_id)
    clean_phone = sanitize_filename_part(phone_number)
    return f"{clean_gsm}_{clean_phone}_DL_Report.pdf"

def create_backup(source_path: Path) -> Path:
    """
    Creates a timestamped backup of the given file in data/backups/.
    Returns the backup path.
    """
    source_path = Path(source_path)
    if not source_path.exists():
        raise FileNotFoundError(f"File to backup does not exist: {source_path}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"{source_path.stem}_backup_{timestamp}{source_path.suffix}"
    backup_path = BACKUPS_DIR / backup_filename
    shutil.copy2(source_path, backup_path)
    logger.info(f"Created file backup: {backup_path.name}")
    return backup_path

def validate_pdf_file(file_path: Path) -> Tuple[bool, str]:
    """
    Validates that a file is a valid, readable, uncorrupted PDF document.
    Ensures HTML error pages are rejected.
    Returns (is_valid: bool, reason: str).
    """
    path = Path(file_path)
    if not path.exists():
        return False, "File does not exist"

    file_size = path.stat().st_size
    if file_size < 100:  # PDFs are typically at least a few hundred bytes
        return False, f"File too small ({file_size} bytes)"

    try:
        with open(path, "rb") as f:
            header = f.read(1024)
            # Check for HTML error pages masquerading as PDF
            header_lower = header.lower()
            if b"<!doctype html" in header_lower or b"<html" in header_lower or b"{\"error\"" in header_lower:
                return False, "File content is HTML or JSON error response, not PDF"
            
            if not header.startswith(b"%PDF-"):
                # Search anywhere in first 1024 bytes in case of leading whitespace/BOM
                if b"%PDF-" not in header:
                    return False, "Missing %PDF- header in file"

        # Try to parse with PyMuPDF or pypdf
        try:
            import fitz
            doc = fitz.open(str(path))
            page_count = len(doc)
            doc.close()
            if page_count < 1:
                return False, "PDF has 0 pages"
            return True, f"Valid PDF with {page_count} page(s)"
        except ImportError:
            # Fallback to pypdf
            import pypdf
            reader = pypdf.PdfReader(str(path))
            page_count = len(reader.pages)
            if page_count < 1:
                return False, "PDF has 0 pages"
            return True, f"Valid PDF with {page_count} page(s)"
    except Exception as e:
        return False, f"Corrupted or invalid PDF format: {str(e)}"

def create_reports_zip(reports_dir: Optional[Path] = None, output_zip_path: Optional[Path] = None) -> Optional[Path]:
    """
    Creates a ZIP archive containing all downloaded PDF reports.
    Returns the Path to the zip file, or None if no reports found.
    """
    dir_to_zip = Path(reports_dir or REPORTS_DIR)
    pdf_files = list(dir_to_zip.glob("*.pdf"))
    if not pdf_files:
        return None

    if output_zip_path is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_zip_path = dir_to_zip.parent / f"DL_Reports_Bundle_{timestamp}.zip"

    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for pdf in pdf_files:
            zipf.write(pdf, arcname=pdf.name)

    logger.info(f"Created ZIP bundle with {len(pdf_files)} reports: {output_zip_path.name}")
    return output_zip_path

def get_reports_summary(reports_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Returns a list of downloaded report metadata for display."""
    dir_to_check = Path(reports_dir or REPORTS_DIR)
    summary = []
    for file in sorted(dir_to_check.glob("*.pdf"), key=lambda f: f.stat().st_mtime, reverse=True):
        stat = file.stat()
        summary.append({
            "filename": file.name,
            "size_kb": round(stat.st_size / 1024, 2),
            "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            "path": str(file.resolve())
        })
    return summary
