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


def create_driver_pdf_report(
    gsm_id: str,
    phone_number: str,
    dl_number: str,
    dob: str,
    verification_status: str,
    verification_date: str,
    remarks: str = "",
    output_dir: Optional[Path] = None
) -> Tuple[str, str]:
    """
    Generates an enterprise-grade Driving Licence Verification Certificate PDF
    using ReportLab and saves it as GSMID_PHONENUMBER_DL_Report.pdf in data/reports/.
    Returns: (filename, full_path)
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas

    target_dir = Path(output_dir or REPORTS_DIR)
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = generate_report_filename(gsm_id, phone_number)
    save_path = target_dir / filename

    c = canvas.Canvas(str(save_path), pagesize=letter)
    width, height = letter

    # Header banner
    c.setFillColor(colors.HexColor("#0F172A"))
    c.rect(0, height - 80, width, 80, fill=True, stroke=False)

    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(40, height - 45, "DRIVING LICENCE VERIFICATION CERTIFICATE")
    c.setFont("Helvetica", 10)
    c.drawString(40, height - 65, "Official Automated Verification via Surepass KYC Portal")

    # Status Badge
    is_verified = (verification_status or "").lower() == "verified"
    badge_color = colors.HexColor("#059669") if is_verified else colors.HexColor("#DC2626")
    badge_text = "VERIFIED / ACTIVE" if is_verified else "NOT VERIFIED / INVALID"

    c.setFillColor(badge_color)
    c.roundRect(40, height - 130, 220, 32, 6, fill=True, stroke=False)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(55, height - 118, f"STATUS: {badge_text}")

    # Details Box
    c.setFillColor(colors.HexColor("#F8FAFC"))
    c.roundRect(40, height - 390, width - 80, 240, 8, fill=True, stroke=True)

    c.setFillColor(colors.HexColor("#334155"))
    c.setFont("Helvetica-Bold", 12)
    c.drawString(60, height - 170, "DRIVER & VERIFICATION DETAILS")

    # Table rows
    rows = [
        ("GSM ID:", gsm_id or "-"),
        ("Mobile Number:", phone_number or "-"),
        ("Driving Licence Number:", dl_number or "-"),
        ("Date of Birth:", dob or "-"),
        ("Verification Outcome:", verification_status or "-"),
        ("Verification Timestamp:", verification_date or datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        ("Remarks / Notes:", remarks or "Automated Surepass Verification")
    ]

    y = height - 200
    for label, val in rows:
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(colors.HexColor("#64748B"))
        c.drawString(60, y, label)
        c.setFont("Helvetica", 10)
        c.setFillColor(colors.HexColor("#0F172A"))
        c.drawString(240, y, str(val))
        y -= 24

    # Security Footer
    c.setStrokeColor(colors.HexColor("#E2E8F0"))
    c.line(40, 80, width - 40, 80)

    c.setFillColor(colors.HexColor("#94A3B8"))
    c.setFont("Helvetica", 8)
    c.drawString(40, 60, "This digital record was verified directly against the National Register / Parivahan database via Surepass API.")
    c.drawString(40, 45, f"Certificate Hash ID: {abs(hash(f'{gsm_id}{dl_number}{verification_date}'))} | Confidential Document.")

    c.save()
    logger.info(f"Generated verification report PDF: {filename}")
    return filename, str(save_path.resolve())
