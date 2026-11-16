import pytest
from pathlib import Path
import pandas as pd
from datetime import date
from core.excel_processor import ExcelProcessor
from core.verification_engine import VerificationEngine
from core.status_manager import VerificationStatus, ProcessingStatus, ReportStatus
from database import db_manager

def test_dry_run_workflow(tmp_path):
    # Setup test excel
    test_excel = tmp_path / "test_dry_run.xlsx"
    df = pd.DataFrame({
        "GSM ID": ["GSM901", "GSM902"],
        "Phone Number": ["9876543210", "9876543211"],
        "DL Number": ["DL1420110012345", "KA0120110001234"],
        "DOB": ["15-08-1990", "20-05-1992"]
    })
    df.to_excel(test_excel, index=False)

    proc = ExcelProcessor(str(test_excel))
    proc.load_and_inspect()
    records = proc.prepare_and_validate()
    proc.setup_output_excel()

    import uuid
    job_id = f"test_job_{uuid.uuid4().hex[:8]}"
    db_manager.create_job(
        job_id=job_id,
        input_filename="test_dry_run.xlsx",
        input_file_path=str(test_excel),
        output_file_path=str(proc.output_file_path),
        total_records=len(records)
    )
    db_manager.insert_job_records(job_id, records)

    engine = VerificationEngine(
        job_id=job_id,
        excel_processor=proc,
        dry_run=True,
        headless=True
    )

    # Run the engine
    engine.run()

    # Check database status
    job_stats = db_manager.get_job_statistics(job_id)
    assert job_stats["total"] == 2
    assert job_stats["verified"] == 2
    assert job_stats["completed"] == 2
    assert job_stats["pending"] == 0

    # Check updated Excel
    import openpyxl
    wb = openpyxl.load_workbook(proc.output_file_path)
    ws = wb.active
    # Headers
    headers = [cell.value for cell in ws[1]]
    ver_status_col = headers.index("Verification Status") + 1
    assert ws.cell(row=2, column=ver_status_col).value == VerificationStatus.VERIFIED.value
    assert ws.cell(row=3, column=ver_status_col).value == VerificationStatus.VERIFIED.value
    wb.close()
