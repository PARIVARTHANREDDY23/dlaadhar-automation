import pytest
from core.status_manager import VerificationStatus, ProcessingStatus, ReportStatus, STATUS_COLORS

def test_status_enums():
    # Verification statuses
    assert VerificationStatus.VERIFIED == "Verified"
    assert VerificationStatus.NOT_VERIFIED == "Not Verified"
    assert VerificationStatus.INVALID_DETAILS == "Invalid Details"
    assert VerificationStatus.RECORD_NOT_FOUND == "Record Not Found"
    assert VerificationStatus.VERIFICATION_ERROR == "Verification Error"
    assert VerificationStatus.PENDING == "Pending"

    # Processing statuses
    assert ProcessingStatus.PENDING == "Pending"
    assert ProcessingStatus.PROCESSING == "Processing"
    assert ProcessingStatus.COMPLETED == "Completed"
    assert ProcessingStatus.FAILED == "Failed"
    assert ProcessingStatus.SKIPPED == "Skipped"

    # Report statuses
    assert ReportStatus.PENDING == "Pending"
    assert ReportStatus.DOWNLOADED == "Downloaded"
    assert ReportStatus.DOWNLOAD_FAILED == "Download Failed"
    assert ReportStatus.NOT_AVAILABLE == "Not Available"

def test_status_colors():
    assert "Verified" in STATUS_COLORS
    assert "Completed" in STATUS_COLORS
    assert "Downloaded" in STATUS_COLORS

