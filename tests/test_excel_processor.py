import pytest
from pathlib import Path
import pandas as pd
import openpyxl

from core.excel_processor import ExcelProcessor
from core.status_manager import VerificationStatus, ProcessingStatus

def test_excel_processor_load_and_validate(tmp_path):
    # Create test input Excel file
    test_excel = tmp_path / "drivers_test.xlsx"
    df = pd.DataFrame({
        "GSM ID": ["GSM001", "GSM002", "GSM003"],
        "Phone Number": ["09876543210", "9876543211", "12345"], # 3rd is invalid phone
        "DL Number": ["00123DL45678", "KA0120110001234", ""],    # 1st has leading zeros, 3rd is missing DL
        "DOB": ["15-08-1990", "1995-12-25", "invalid-dob"]
    })
    df.to_excel(test_excel, index=False)

    processor = ExcelProcessor(str(test_excel))
    cols, count = processor.load_and_inspect()
    assert count == 3
    assert "GSM ID" in cols
    assert "DL Number" in cols

    auto_map = processor.auto_detect_mapping(cols)
    assert auto_map["gsm_id"] == "GSM ID"
    assert auto_map["dl_number"] == "DL Number"

    records = processor.prepare_and_validate()
    assert len(records) == 3

    # Row 1 is valid (phone converted from 09876543210 to 9876543210)
    assert records[0]["is_valid"] is True
    assert records[0]["processing_status"] == ProcessingStatus.PENDING.value

    # Row 2 is valid
    assert records[1]["is_valid"] is True

    # Row 3 is invalid (missing DL, invalid DOB, invalid phone)
    assert records[2]["is_valid"] is False
    assert records[2]["processing_status"] == ProcessingStatus.SKIPPED.value
    assert len(records[2]["validation_errors"]) >= 2

def test_excel_processor_setup_output_and_incremental_update(tmp_path):
    test_excel = tmp_path / "drivers_output_test.xlsx"
    df = pd.DataFrame({
        "GSM ID": ["GSM101"],
        "Phone Number": ["9876543210"],
        "DL Number": ["DL1420110012345"],
        "DOB": ["01-01-1990"]
    })
    df.to_excel(test_excel, index=False)

    processor = ExcelProcessor(str(test_excel))
    processor.load_and_inspect()
    processor.prepare_and_validate()
    out_path = processor.setup_output_excel()

    assert out_path.exists()

    # Verify that the 6 output columns were added
    wb = openpyxl.load_workbook(out_path)
    ws = wb.active
    headers = [cell.value for cell in ws[1]]
    assert "Verification Status" in headers
    assert "Processing Status" in headers
    assert "Report Filename" in headers
    wb.close()

    # Now update row 2 (row 1 is header)
    processor.update_row(2, {
        "verification_status": "Verified",
        "verification_date": "2026-11-16 15:30:00",
        "verification_remarks": "Test Remarks",
        "report_filename": "GSM101_9876543210_DL_Report.pdf",
        "report_download_status": "Downloaded",
        "processing_status": "Completed"
    })

    # Verify values written to cell
    wb = openpyxl.load_workbook(out_path)
    ws = wb.active
    status_col = headers.index("Verification Status") + 1
    report_col = headers.index("Report Filename") + 1
    
    assert ws.cell(row=2, column=status_col).value == "Verified"
    assert ws.cell(row=2, column=report_col).value == "GSM101_9876543210_DL_Report.pdf"
    wb.close()

