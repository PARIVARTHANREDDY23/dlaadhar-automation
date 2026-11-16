import time
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from playwright.sync_api import Page, Download, TimeoutError as PlaywrightTimeout

from config import REPORTS_DIR
from core.status_manager import ReportStatus
from utils.file_manager import generate_report_filename, validate_pdf_file
from utils.logger import get_logger

logger = get_logger("DownloadManager")

class DownloadManager:
    """
    Manages Playwright downloads, PDF validation, file renaming, and error handling.
    """
    def __init__(self, reports_dir: Optional[Path] = None):
        self.reports_dir = Path(reports_dir or REPORTS_DIR)
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def capture_download(
        self,
        trigger_action_callback,
        gsm_id: str,
        phone_number: str,
        page: Page,
        timeout_ms: int = 30000
    ) -> Dict[str, Any]:
        """
        Executes trigger_action_callback (e.g. clicking the download button),
        captures the Playwright download event, saves it, and validates the PDF.
        """
        target_filename = generate_report_filename(gsm_id, phone_number)
        target_path = self.reports_dir / target_filename

        try:
            with page.expect_download(timeout=timeout_ms) as download_info:
                # Trigger the download action
                trigger_action_callback()

            download: Download = download_info.value
            logger.info(f"Download initiated: {download.suggested_filename}")

            # Temporary download destination
            temp_path = self.reports_dir / f"temp_{target_filename}"
            download.save_as(str(temp_path))

            # Validate that it is genuinely a PDF and not an HTML error
            is_valid, reason = validate_pdf_file(temp_path)
            if not is_valid:
                logger.error(f"Downloaded file failed validation: {reason}")
                if temp_path.exists():
                    temp_path.unlink()
                return {
                    "status": ReportStatus.DOWNLOAD_FAILED.value,
                    "filename": "",
                    "path": "",
                    "error": f"Invalid PDF: {reason}"
                }

            # If target already exists, remove or overwrite cleanly
            if target_path.exists():
                target_path.unlink()
            temp_path.rename(target_path)

            logger.info(f"Successfully saved and verified report: {target_filename}")
            return {
                "status": ReportStatus.DOWNLOADED.value,
                "filename": target_filename,
                "path": str(target_path.resolve()),
                "error": ""
            }

        except PlaywrightTimeout:
            logger.warning("Download timed out. No download event triggered.")
            return {
                "status": ReportStatus.DOWNLOAD_FAILED.value,
                "filename": "",
                "path": "",
                "error": "Download timed out"
            }
        except Exception as e:
            logger.error(f"Error while downloading report: {str(e)}")
            return {
                "status": ReportStatus.DOWNLOAD_FAILED.value,
                "filename": "",
                "path": "",
                "error": str(e)
            }

