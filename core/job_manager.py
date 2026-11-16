import threading
import uuid
import traceback
from typing import Optional, Dict, Any, Callable, List, Tuple
from pathlib import Path

from config import SUREPASS_LOGIN_URL, PROFILE_DIR
from core.excel_processor import ExcelProcessor
from core.verification_engine import VerificationEngine
from automation.browser_manager import BrowserManager
from database import db_manager
from utils.logger import get_logger

logger = get_logger("JobManager")

class JobManager:
    """
    Singleton-style manager coordinating background execution threads,
    browser lifecycle, and exposing execution state to the Streamlit frontend.
    """
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(JobManager, cls).__new__(cls, *args, **kwargs)
            cls._instance._init_manager()
        return cls._instance

    def _init_manager(self):
        self.current_job_id: Optional[str] = None
        self.excel_processor: Optional[ExcelProcessor] = None
        self.browser_manager: Optional[BrowserManager] = None
        self.engine: Optional[VerificationEngine] = None
        self.worker_thread: Optional[threading.Thread] = None
        self.inspector_thread: Optional[threading.Thread] = None
        self.latest_state: Dict[str, Any] = {
            "stage": "Idle",
            "message": "Ready to start",
            "current_gsm": "-",
            "current_phone": "-",
            "current_row": "-",
            "progress_current": 0,
            "progress_total": 0,
            "latest_status": "None"
        }

    def get_or_create_browser(self, headless: bool = False) -> BrowserManager:
        """Returns the shared BrowserManager instance."""
        if not self.browser_manager:
            self.browser_manager = BrowserManager(headless=headless)
        return self.browser_manager

    def open_browser_inspector(self, url: str = SUREPASS_LOGIN_URL) -> Tuple[bool, str]:
        """
        Launches or focuses the headed browser so operator can log in or inspect Surepass.
        Runs safely without freezing Streamlit.
        """
        bm = self.get_or_create_browser(headless=False)
        try:
            bm.open_inspector_mode(url)
            self.latest_state["stage"] = "Inspector Open"
            self.latest_state["message"] = f"Browser open at {url}. Log in or inspect the portal."
            return True, "Browser opened successfully."
        except Exception as e:
            err = str(e) or repr(e)
            logger.error(f"Error launching inspector browser: {err}", exc_info=True)
            self.latest_state["stage"] = "Browser Error"
            self.latest_state["message"] = f"Could not open browser: {err}"
            return False, err

    def close_browser(self):
        """Closes the active browser session."""
        if self.browser_manager:
            self.browser_manager.close()
            self.browser_manager = None
            self.latest_state["stage"] = "Browser Closed"
            self.latest_state["message"] = "Browser closed cleanly."

    def reset_browser(self):
        """Forces termination of lingering Chrome processes, deletes locks, and resets browser."""
        self.close_browser()
        BrowserManager.kill_lingering_chrome()
        BrowserManager.clean_stale_locks(PROFILE_DIR)
        self.latest_state["stage"] = "Browser Reset"
        self.latest_state["message"] = "Browser processes and profile locks cleared."

    def ensure_job_loaded(self, job_id: str) -> bool:
        """Restores job state and ExcelProcessor from database if available."""
        if self.excel_processor and self.current_job_id == job_id:
            return True

        job = db_manager.get_job(job_id)
        if not job:
            return False

        input_path = job["input_file_path"]
        if not Path(input_path).exists():
            return False

        try:
            proc = ExcelProcessor(input_path)
            proc.load_and_inspect()
            proc.prepare_and_validate()
            self.excel_processor = proc
            self.current_job_id = job_id
            return True
        except Exception as e:
            logger.error(f"Failed to restore job {job_id}: {e}")
            return False

    def initialize_new_job(
        self,
        excel_path: str,
        column_mapping: Dict[str, str]
    ) -> Tuple[str, List[Dict[str, Any]], Dict[str, Any]]:
        """
        Loads Excel, creates DB entries, sets up output file and backup.
        """
        job_id = f"job_{uuid.uuid4().hex[:8]}"
        self.current_job_id = job_id
        
        proc = ExcelProcessor(excel_path, column_mapping)
        proc.load_and_inspect()
        records = proc.prepare_and_validate()
        output_path = proc.setup_output_excel()

        # Insert into DB
        db_manager.create_job(
            job_id=job_id,
            input_filename=Path(excel_path).name,
            input_file_path=str(Path(excel_path).resolve()),
            output_file_path=str(output_path.resolve()),
            total_records=len(records)
        )
        db_manager.insert_job_records(job_id, records)

        self.excel_processor = proc
        
        # Summary
        valid_count = sum(1 for r in records if r["is_valid"])
        invalid_count = len(records) - valid_count
        summary = {
            "job_id": job_id,
            "total_records": len(records),
            "valid_records": valid_count,
            "invalid_records": invalid_count,
            "output_path": str(output_path)
        }

        self.latest_state.update({
            "stage": "Initialized",
            "message": f"Job {job_id} ready with {len(records)} records ({valid_count} valid).",
            "progress_current": 0,
            "progress_total": len(records),
            "current_gsm": "-",
            "current_phone": "-",
            "current_row": "-",
            "latest_status": "Ready"
        })

        return job_id, records, summary

    def _state_callback(self, data: Dict[str, Any]):
        """Internal callback to capture live updates from the engine."""
        stage = data.get("stage", self.latest_state.get("stage"))
        msg = data.get("message", self.latest_state.get("message"))
        
        self.latest_state["stage"] = stage
        self.latest_state["message"] = msg
        
        if "gsm_id" in data:
            self.latest_state["current_gsm"] = data["gsm_id"]
        if "phone" in data:
            self.latest_state["current_phone"] = data["phone"]
        if "row" in data:
            self.latest_state["current_row"] = data["row"]
        if "status" in data:
            self.latest_state["latest_status"] = data["status"]
        if "progress" in data:
            curr, tot = data["progress"]
            self.latest_state["progress_current"] = curr
            self.latest_state["progress_total"] = tot

    def start_verification(
        self,
        dry_run: bool = False,
        headless: bool = False,
        retry_failed_only: bool = False
    ) -> bool:
        """Launches the verification engine in a background thread."""
        if self.worker_thread and self.worker_thread.is_alive():
            logger.warning("Verification is already running.")
            return False

        if not self.current_job_id:
            latest = db_manager.get_latest_job()
            if latest:
                self.current_job_id = latest["job_id"]

        if not self.current_job_id or not self.ensure_job_loaded(self.current_job_id):
            logger.error("No active job configured to start.")
            self.latest_state["stage"] = "Error"
            self.latest_state["message"] = "No active job found. Please upload and validate an Excel file first."
            return False

        bm = self.get_or_create_browser(headless=headless)

        self.engine = VerificationEngine(
            job_id=self.current_job_id,
            excel_processor=self.excel_processor,
            browser_manager=bm,
            dry_run=dry_run,
            headless=headless,
            status_callback=self._state_callback
        )

        def runner():
            try:
                self.engine.run(retry_failed_only=retry_failed_only)
            except Exception as e:
                logger.error(f"Error in verification runner thread: {e}", exc_info=True)
                self.latest_state["stage"] = "Thread Exception"
                self.latest_state["message"] = str(e) or repr(e)

        self.worker_thread = threading.Thread(target=runner, daemon=True)
        self.worker_thread.start()
        logger.info(f"Verification worker thread launched for job {self.current_job_id}")
        return True

    def pause_verification(self):
        if self.engine:
            self.engine.pause()
            self.latest_state["stage"] = "Paused"
            self.latest_state["message"] = "Verification paused by operator."

    def resume_verification(self):
        if self.engine:
            self.engine.resume()
            self.latest_state["stage"] = "Resuming"
            self.latest_state["message"] = "Resuming verification..."

    def stop_verification(self):
        if self.engine:
            self.engine.stop()
            self.latest_state["stage"] = "Stopping"
            self.latest_state["message"] = "Stopping verification gracefully..."

    def is_running(self) -> bool:
        return bool(self.worker_thread and self.worker_thread.is_alive())

    def get_state(self) -> Dict[str, Any]:
        return self.latest_state
