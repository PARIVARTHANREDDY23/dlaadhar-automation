import sys
import time
import threading
from datetime import datetime, date
from pathlib import Path
from typing import Dict, Any, Optional, Callable, List, Tuple
from playwright.sync_api import Page

from config import DEFAULT_PROCESSING_DELAY, DEFAULT_MAX_RETRIES
from core.status_manager import ProcessingStatus, VerificationStatus, ReportStatus
from core.excel_processor import ExcelProcessor
from database import db_manager
from automation.browser_manager import BrowserManager
from automation.login_handler import LoginHandler
from automation.surepass_automation import SurepassAutomation
from utils.logger import get_logger

logger = get_logger("VerificationEngine")

class VerificationEngine:
    def __init__(
        self,
        job_id: str,
        excel_processor: ExcelProcessor,
        browser_manager: Optional[BrowserManager] = None,
        dry_run: bool = False,
        headless: bool = False,
        status_callback: Optional[Callable[[Dict[str, Any]], None]] = None
    ):
        self.job_id = job_id
        self.excel_processor = excel_processor
        self.browser_manager = browser_manager or BrowserManager(headless=headless)
        self.dry_run = dry_run
        self.headless = headless
        self.status_callback = status_callback

        self.login_handler = LoginHandler()
        self.surepass_automation = SurepassAutomation(dry_run=dry_run)
        
        self._pause_event = threading.Event()
        self._pause_event.set()  # Set means running (not paused)
        self._stop_requested = False
        self.is_running = False

    def pause(self):
        """Pauses the verification loop."""
        logger.info("Pause requested.")
        self._pause_event.clear()
        db_manager.update_job_status(self.job_id, "Paused")

    def resume(self):
        """Resumes the verification loop."""
        logger.info("Resume requested.")
        self._pause_event.set()
        db_manager.update_job_status(self.job_id, "Running")

    def stop(self):
        """Signals the verification loop to stop safely."""
        logger.info("Stop requested.")
        self._stop_requested = True
        self._pause_event.set()  # Unblock if paused so thread can exit
        db_manager.update_job_status(self.job_id, "Stopped")

    def _notify(self, data: Dict[str, Any]):
        if self.status_callback:
            try:
                self.status_callback(data)
            except Exception as e:
                logger.error(f"Error in status callback: {e}")

    def run(self, retry_failed_only: bool = False):
        """
        Main execution loop. Sequentially processes records.
        """
        self.is_running = True
        self._stop_requested = False
        self._pause_event.set()

        db_manager.update_job_status(self.job_id, "Running")
        logger.info(f"Starting verification execution for job {self.job_id} (Dry-Run: {self.dry_run})...")

        page = None
        if not self.dry_run:
            try:
                if sys.platform == "win32":
                    import asyncio
                    try:
                        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
                    except Exception:
                        pass
                self._notify({"stage": "Initializing Browser", "message": "Starting Chromium..."})
                page = self.browser_manager.start_browser(headless=self.headless)
                
                # Check authentication
                self._notify({"stage": "Checking Authentication", "message": "Verifying Surepass login session..."})
                is_authed = self.login_handler.wait_for_manual_login(
                    page,
                    timeout_seconds=300,
                    status_callback=lambda msg: self._notify({"stage": "Authentication", "message": msg})
                )
                if not is_authed:
                    logger.error("Authentication failed or operator timed out.")
                    self._notify({
                        "stage": "Authentication Required",
                        "message": "Manual login was not completed. Please log into Surepass in the browser window."
                    })
                    db_manager.update_job_status(self.job_id, "Auth Required")
                    self.is_running = False
                    return
            except Exception as e:
                err_text = str(e) or repr(e)
                logger.error(f"Failed to initialize browser session: {err_text}", exc_info=True)
                self._notify({
                    "stage": "Browser Initialization Error",
                    "message": f"Could not launch browser: {err_text}. Please ensure any other open Chrome/Surepass windows are closed."
                })
                db_manager.update_job_status(self.job_id, "Failed")
                self.is_running = False
                return

        # Fetch records to process
        if retry_failed_only:
            records = db_manager.get_failed_records(self.job_id)
            logger.info(f"Retrying {len(records)} failed records.")
        else:
            records = db_manager.get_pending_records(self.job_id)
            logger.info(f"Found {len(records)} pending records to process.")

        total_count = len(records)
        processed_in_this_run = 0

        try:
            for rec in records:
                # Check if stop requested
                if self._stop_requested:
                    logger.info("Processing halted by operator.")
                    break

                # Check if paused (blocks thread until resume() is called)
                self._pause_event.wait()
                if self._stop_requested:
                    break

                rec_id = rec["id"]
                row_idx = rec["row_index"]
                gsm_id = rec["gsm_id"]
                phone_num = rec["phone_number"]
                dl_masked = rec["dl_number_masked"]

                # Retrieve raw DL and DOB from Excel processor's memory
                full_rec = None
                for pr in self.excel_processor.processed_records:
                    if pr["row_index"] == row_idx:
                        full_rec = pr
                        break

                if not full_rec:
                    logger.warning(f"Could not locate memory record for row {row_idx}, skipping.")
                    continue

                if not full_rec["is_valid"]:
                    # Already marked as skipped
                    logger.info(f"Skipping row {row_idx} ({gsm_id}) due to invalid input data.")
                    continue

                dl_number = full_rec["dl_number"]
                dob = full_rec["dob"]

                self._notify({
                    "stage": "Processing Driver",
                    "row": row_idx,
                    "gsm_id": gsm_id,
                    "phone": phone_num,
                    "dl_masked": dl_masked,
                    "message": f"Processing row {row_idx}: GSM {gsm_id}"
                })

                now_ts = datetime.now().isoformat()
                db_manager.update_record_status(
                    rec_id,
                    processing_status=ProcessingStatus.PROCESSING.value,
                    start_timestamp=now_ts
                )

                # Process transaction
                ver_status, ver_remarks, rep_status, rep_filename, rep_path, err_msg = self._process_single_driver(
                    page=page,
                    gsm_id=gsm_id,
                    phone_number=phone_num,
                    dl_number=dl_number,
                    dob=dob
                )

                completion_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                final_proc_status = ProcessingStatus.COMPLETED.value if ver_status != VerificationStatus.VERIFICATION_ERROR.value else ProcessingStatus.FAILED.value

                # 1. Update SQLite DB
                db_manager.update_record_status(
                    rec_id,
                    processing_status=final_proc_status,
                    verification_status=ver_status,
                    verification_date=completion_ts,
                    verification_remarks=ver_remarks,
                    report_filename=rep_filename,
                    report_path=rep_path,
                    report_download_status=rep_status,
                    error_message=err_msg,
                    completion_timestamp=completion_ts
                )

                # 2. Update Excel immediately
                self.excel_processor.update_row(row_idx, {
                    "verification_status": ver_status,
                    "verification_date": completion_ts,
                    "verification_remarks": ver_remarks,
                    "report_filename": rep_filename,
                    "report_download_status": rep_status,
                    "processing_status": final_proc_status
                })

                processed_in_this_run += 1
                logger.info(f"Row {row_idx} [{gsm_id}] complete: {ver_status} | Report: {rep_status}")

                self._notify({
                    "stage": "Driver Completed",
                    "row": row_idx,
                    "gsm_id": gsm_id,
                    "status": ver_status,
                    "report_status": rep_status,
                    "progress": (processed_in_this_run, total_count)
                })

                # Safe inter-transaction delay
                time.sleep(DEFAULT_PROCESSING_DELAY)

        except Exception as e:
            logger.error(f"Unexpected error in verification loop: {e}", exc_info=True)
            db_manager.update_job_status(self.job_id, "Error")
        finally:
            self.is_running = False
            # Check remaining pending
            remaining = db_manager.get_pending_records(self.job_id)
            if not self._stop_requested and len(remaining) == 0:
                db_manager.update_job_status(self.job_id, "Completed")
                logger.info(f"Job {self.job_id} processing completed successfully.")
            elif self._stop_requested:
                db_manager.update_job_status(self.job_id, "Stopped")
            
            self._notify({"stage": "Finished", "message": "Verification run ended."})

    def _process_single_driver(
        self,
        page: Optional[Page],
        gsm_id: str,
        phone_number: str,
        dl_number: str,
        dob: Optional[date]
    ) -> Tuple[str, str, str, str, str, str]:
        """
        Executes single verification workflow.
        Returns: (ver_status, ver_remarks, report_status, report_filename, report_path, error_msg)
        """
        if self.dry_run:
            # Simulate processing delay and success
            time.sleep(1.0)
            sim_filename = f"{gsm_id}_{phone_number}_DL_Report.pdf"
            return (
                VerificationStatus.VERIFIED.value,
                "Simulated Verified [Dry-Run]",
                ReportStatus.DOWNLOADED.value,
                sim_filename,
                f"data/reports/{sim_filename}",
                ""
            )

        try:
            # 1. Check session
            if self.login_handler.is_session_expired(page):
                logger.warning("Session expired before record submission. Requesting re-auth...")
                reauthed = self.login_handler.wait_for_manual_login(page, timeout_seconds=180)
                if not reauthed:
                    return (
                        VerificationStatus.VERIFICATION_ERROR.value,
                        "Session expired and re-login timed out",
                        ReportStatus.NOT_AVAILABLE.value,
                        "",
                        "",
                        "Session expired"
                    )

            # 2. Navigate to DL service
            nav_ok = self.surepass_automation.navigate_to_dl_service(page)
            if not nav_ok:
                return (
                    VerificationStatus.VERIFICATION_ERROR.value,
                    "Failed to navigate to DL Verification page",
                    ReportStatus.NOT_AVAILABLE.value,
                    "",
                    "",
                    "Navigation failure"
                )

            # 3. Fill and submit
            submit_ok, submit_msg = self.surepass_automation.fill_and_submit(page, dl_number, dob)
            if not submit_ok:
                return (
                    VerificationStatus.VERIFICATION_ERROR.value,
                    f"Form submission failed: {submit_msg}",
                    ReportStatus.NOT_AVAILABLE.value,
                    "",
                    "",
                    submit_msg
                )

            # 4. Detect verification outcome
            ver_status, ver_remarks = self.surepass_automation.detect_verification_result(page)

            # 5. Handle report download
            report_status = ReportStatus.NOT_AVAILABLE.value
            report_filename = ""
            report_path = ""
            
            # If verified or portal generates report on check
            download_res = self.surepass_automation.download_report_if_available(
                page=page,
                gsm_id=gsm_id,
                phone_number=phone_number
            )
            report_status = download_res.get("status", ReportStatus.NOT_AVAILABLE.value)
            report_filename = download_res.get("filename", "")
            report_path = download_res.get("path", "")

            return (
                ver_status,
                ver_remarks,
                report_status,
                report_filename,
                report_path,
                ""
            )

        except Exception as e:
            logger.error(f"Error processing driver {gsm_id}: {e}", exc_info=True)
            return (
                VerificationStatus.VERIFICATION_ERROR.value,
                f"Exception: {str(e)}",
                ReportStatus.DOWNLOAD_FAILED.value,
                "",
                "",
                str(e)
            )
