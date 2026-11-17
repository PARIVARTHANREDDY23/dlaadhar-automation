import pytest
from pathlib import Path
from server import app
from config import BASE_DIR
from core.job_manager import JobManager
from database import db_manager
from utils.file_manager import get_reports_summary, create_reports_zip

def test_web_index_html_structure():
    index_file = BASE_DIR / "web" / "index.html"
    assert index_file.exists(), "web/index.html must exist"
    content = index_file.read_text(encoding="utf-8")
    assert "DL Verification Automation" in content
    assert "Operations Dashboard" in content
    assert "Upload Excel" in content
    assert "Cloud Browser Mirror" in content
    assert "PDF Reports" in content
    assert "Live Terminal" in content

def test_server_routes_registered():
    route_paths = [r.path for r in app.routes]
    expected_routes = [
        "/",
        "/api/upload",
        "/api/jobs",
        "/api/jobs/{job_id}",
        "/api/jobs/{job_id}/records",
        "/api/jobs/{job_id}/start",
        "/api/jobs/{job_id}/pause",
        "/api/jobs/{job_id}/resume",
        "/api/jobs/{job_id}/stop",
        "/api/jobs/{job_id}/status",
        "/api/jobs/{job_id}/export",
        "/api/reports",
        "/api/reports/download/{filename}",
        "/api/reports/zip",
        "/api/browser/screenshot",
        "/api/browser/launch",
        "/api/browser/login",
        "/api/browser/otp",
        "/api/browser/navigate",
        "/api/browser/close",
        "/api/logs",
        "/ws/live"
    ]
    for route in expected_routes:
        assert route in route_paths, f"Route {route} must be registered in FastAPI app"

def test_job_manager_and_db_flow():
    sample_file = BASE_DIR / "data" / "input" / "sample_drivers.xlsx"
    if not sample_file.exists():
        pytest.skip("sample_drivers.xlsx does not exist")

    jm = JobManager()
    job_id, records, summary = jm.initialize_new_job(
        str(sample_file),
        {"gsm_id": "GSM ID", "phone_number": "Phone Number", "dl_number": "DL Number", "dob": "DOB"}
    )
    assert job_id.startswith("job_")
    assert summary["total_records"] >= 3
    assert summary["valid_records"] >= 3

    # Database query check
    job = db_manager.get_job(job_id)
    assert job is not None
    assert job["total_records"] >= 3

    # Records query check
    recs = db_manager.get_job_records(job_id)
    assert len(recs) >= 3
    for r in recs:
        assert "dl_number_masked" in r
        assert "gsm_id" in r
        assert "verification_status" in r

def test_reports_manager_summary():
    reports = get_reports_summary()
    assert isinstance(reports, list)
