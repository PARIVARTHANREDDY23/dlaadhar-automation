import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
INPUT_DIR = DATA_DIR / "input"
OUTPUT_DIR = DATA_DIR / "output"
REPORTS_DIR = DATA_DIR / "reports"
BACKUPS_DIR = DATA_DIR / "backups"
LOGS_DIR = BASE_DIR / "logs"
PROFILE_DIR = BASE_DIR / "browser_profile"
DB_PATH = DATA_DIR / "verification_jobs.db"
LOG_FILE = LOGS_DIR / "dl_verification.log"
SELECTORS_CONFIG_PATH = BASE_DIR / "portal_selectors.json"

# Ensure runtime directories exist
for folder in [INPUT_DIR, OUTPUT_DIR, REPORTS_DIR, BACKUPS_DIR, LOGS_DIR, PROFILE_DIR]:
    folder.mkdir(parents=True, exist_ok=True)

# Default Surepass URLs (Customizable via UI or portal_selectors.json)
SUREPASS_LOGIN_URL = "https://console.surepass.app/login"
SUREPASS_DASHBOARD_URL = "https://console.surepass.app/"
SUREPASS_DL_URL = "https://console.surepass.app/services/driving-license"

# Browser Execution Settings
DEFAULT_HEADLESS = False  # Headed mode by default as requested
DEFAULT_SLOW_MO = 500     # Milliseconds between actions
DEFAULT_NAV_TIMEOUT = 45000    # 45 seconds navigation timeout
DEFAULT_ACTION_TIMEOUT = 30000 # 30 seconds element action timeout
DEFAULT_VERIFICATION_TIMEOUT = 60000  # 60s for verification result
DEFAULT_PROCESSING_DELAY = 3.0       # Seconds between successive records
DEFAULT_MAX_RETRIES = 2

# Input Column Names Expected / Default Mappings
DEFAULT_COLUMN_MAPPING = {
    "gsm_id": "GSM ID",
    "phone_number": "Phone Number",
    "dl_number": "DL Number",
    "dob": "DOB"
}

# New Output Columns
OUTPUT_COLUMNS = [
    "Verification Status",
    "Verification Date",
    "Verification Remarks",
    "Report Filename",
    "Report Download Status",
    "Processing Status"
]

