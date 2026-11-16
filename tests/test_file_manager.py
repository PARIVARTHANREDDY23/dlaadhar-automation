import pytest
from pathlib import Path
from utils.file_manager import (
    sanitize_filename_part,
    generate_report_filename,
    create_backup,
    validate_pdf_file,
    create_reports_zip
)

def test_sanitize_filename_part():
    assert sanitize_filename_part("GSM/001:test") == "GSM_001_test"
    assert sanitize_filename_part("  GSM 002  ") == "GSM_002"
    assert sanitize_filename_part("") == "UNKNOWN"

def test_generate_report_filename():
    name = generate_report_filename("GSM001", "9876543210")
    assert name == "GSM001_9876543210_DL_Report.pdf"

def test_create_backup(tmp_path):
    orig = tmp_path / "test.xlsx"
    orig.write_text("sample content")
    
    backup = create_backup(orig)
    assert backup.exists()
    assert backup.name.startswith("test_backup_")
    assert backup.suffix == ".xlsx"

def test_validate_pdf_file_non_existent():
    ok, reason = validate_pdf_file(Path("non_existent_file.pdf"))
    assert ok is False
    assert "does not exist" in reason

def test_validate_pdf_file_html_rejection(tmp_path):
    fake_pdf = tmp_path / "fake_report.pdf"
    fake_pdf.write_bytes(b"<!DOCTYPE html><html><body>Error 404 Not Found</body></html>" + b" " * 200)
    
    ok, reason = validate_pdf_file(fake_pdf)
    assert ok is False
    assert "HTML or JSON" in reason

def test_validate_pdf_file_valid_minimal(tmp_path):
    valid_pdf = tmp_path / "valid.pdf"
    # Minimal valid 1-page PDF 1.4 byte content
    pdf_content = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000102 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n"
    )
    valid_pdf.write_bytes(pdf_content)
    ok, reason = validate_pdf_file(valid_pdf)
    assert ok is True
    assert "Valid PDF" in reason

