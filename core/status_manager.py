from enum import Enum

class VerificationStatus(str, Enum):
    PENDING = "Pending"
    VERIFIED = "Verified"
    NOT_VERIFIED = "Not Verified"
    INVALID_DETAILS = "Invalid Details"
    RECORD_NOT_FOUND = "Record Not Found"
    VERIFICATION_ERROR = "Verification Error"

class ProcessingStatus(str, Enum):
    PENDING = "Pending"
    PROCESSING = "Processing"
    COMPLETED = "Completed"
    FAILED = "Failed"
    SKIPPED = "Skipped"

class ReportStatus(str, Enum):
    PENDING = "Pending"
    DOWNLOADED = "Downloaded"
    DOWNLOAD_FAILED = "Download Failed"
    NOT_AVAILABLE = "Not Available"

# Color mappings for Streamlit badges / UI styling
STATUS_COLORS = {
    VerificationStatus.VERIFIED.value: "#28a745",        # Green
    VerificationStatus.NOT_VERIFIED.value: "#ffc107",    # Yellow/Amber
    VerificationStatus.INVALID_DETAILS.value: "#fd7e14", # Orange
    VerificationStatus.RECORD_NOT_FOUND.value: "#6c757d",# Grey
    VerificationStatus.VERIFICATION_ERROR.value: "#dc3545", # Red
    VerificationStatus.PENDING.value: "#17a2b8",         # Blue/Cyan
    
    ProcessingStatus.COMPLETED.value: "#28a745",
    ProcessingStatus.PROCESSING.value: "#007bff",
    ProcessingStatus.FAILED.value: "#dc3545",
    ProcessingStatus.SKIPPED.value: "#6c757d",
    ProcessingStatus.PENDING.value: "#ffc107",

    ReportStatus.DOWNLOADED.value: "#28a745",
    ReportStatus.DOWNLOAD_FAILED.value: "#dc3545",
    ReportStatus.NOT_AVAILABLE.value: "#6c757d",
    ReportStatus.PENDING.value: "#ffc107",
}

