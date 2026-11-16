import time
import json
from pathlib import Path
from datetime import date
from typing import Dict, Any, Optional, List, Tuple
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout

from config import SELECTORS_CONFIG_PATH, SUREPASS_DL_URL, DEFAULT_VERIFICATION_TIMEOUT
from core.status_manager import VerificationStatus, ReportStatus
from utils.date_utils import format_date_for_portal
from utils.logger import get_logger
from automation.download_manager import DownloadManager

logger = get_logger("SurepassAutomation")

class SurepassAutomation:
    def __init__(
        self,
        selectors_config_path: Optional[Path] = None,
        download_manager: Optional[DownloadManager] = None,
        dry_run: bool = False
    ):
        self.config_path = selectors_config_path or SELECTORS_CONFIG_PATH
        self.selectors = self._load_selectors()
        self.download_mgr = download_manager or DownloadManager()
        self.dry_run = dry_run

    def _load_selectors(self) -> Dict[str, Any]:
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading selectors configuration: {e}")
        return {}

    def reload_selectors(self):
        """Reloads selectors from disk if updated by user."""
        self.selectors = self._load_selectors()

    def _find_first_visible(self, page: Page, selectors: List[str], timeout_ms: int = 3000):
        """Finds first visible element matching any of the candidate selectors."""
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=timeout_ms):
                    return loc, sel
            except Exception:
                continue
        return None, None

    def navigate_to_dl_service(self, page: Page) -> bool:
        """Navigates to the DL Verification section on Surepass."""
        if self.dry_run:
            logger.info("[DRY-RUN] Simulated navigation to DL verification page.")
            return True

        target_url = self.selectors.get("urls", {}).get("dl_verification_url", SUREPASS_DL_URL)
        
        # Check if already on the DL verification page
        if target_url in page.url:
            logger.info("Already on DL Verification page.")
            return True

        logger.info(f"Navigating to DL verification page: {target_url}")
        try:
            page.goto(target_url, wait_until="domcontentloaded", timeout=45000)
            time.sleep(1.5)
            return True
        except Exception as e:
            logger.warning(f"Direct navigation failed ({e}), attempting menu navigation...")

        # Fallback to navigation menu link
        nav_selectors = self.selectors.get("navigation", {}).get("dl_service_link", [])
        loc, sel = self._find_first_visible(page, nav_selectors, timeout_ms=5000)
        if loc:
            try:
                loc.click()
                time.sleep(2)
                return True
            except Exception as e:
                logger.error(f"Failed to click DL service navigation element: {e}")

        logger.error("Could not navigate to DL verification service page.")
        return False

    def fill_and_submit(
        self,
        page: Page,
        dl_number: str,
        dob: Optional[date]
    ) -> Tuple[bool, str]:
        """
        Fills the DL Number and DOB in the form and clicks submit.
        Returns (success: bool, message: str).
        """
        if self.dry_run:
            logger.info(f"[DRY-RUN] Simulating form entry for DL: {dl_number[:4]}*****")
            time.sleep(0.5)
            return True, "Simulated submission"

        dl_selectors = self.selectors.get("dl_form", {}).get("dl_number_input", [])
        dob_selectors = self.selectors.get("dl_form", {}).get("dob_input", [])
        submit_selectors = self.selectors.get("dl_form", {}).get("submit_button", [])
        dob_format = self.selectors.get("dl_form", {}).get("dob_format", "DD-MM-YYYY")

        # 1. Fill DL Number
        dl_loc, dl_sel = self._find_first_visible(page, dl_selectors, timeout_ms=5000)
        if not dl_loc:
            return False, f"DL number input field not found on page (tried: {dl_selectors})"
        
        dl_loc.click()
        dl_loc.fill("")
        dl_loc.fill(dl_number)
        page.keyboard.press("Tab")

        # Verify entered DL matches
        val = dl_loc.input_value()
        if val.replace(" ", "").upper() != dl_number.replace(" ", "").upper():
            logger.warning(f"Entered DL value '{val}' differs slightly from '{dl_number}'. Retrying fill...")
            dl_loc.fill(dl_number)

        # 2. Fill DOB
        if dob:
            dob_str = format_date_for_portal(dob, dob_format)
            dob_loc, dob_sel = self._find_first_visible(page, dob_selectors, timeout_ms=3000)
            if not dob_loc:
                return False, f"DOB input field not found on page (tried: {dob_selectors})"

            dob_loc.click()
            dob_loc.fill("")
            dob_loc.fill(dob_str)
            page.keyboard.press("Tab")

        time.sleep(0.5)

        # 3. Submit
        submit_loc, submit_sel = self._find_first_visible(page, submit_selectors, timeout_ms=4000)
        if not submit_loc:
            return False, f"Submit/Verify button not found on page (tried: {submit_selectors})"

        submit_loc.click()
        logger.info("Submitted DL verification form.")
        return True, "Form submitted successfully"

    def detect_verification_result(
        self,
        page: Page,
        timeout_ms: int = DEFAULT_VERIFICATION_TIMEOUT
    ) -> Tuple[str, str]:
        """
        Monitors the page for result badges, error banners, or status messages.
        Returns (VerificationStatus, remarks_string).
        """
        if self.dry_run:
            logger.info("[DRY-RUN] Generating simulated verification result (Verified).")
            time.sleep(1.0)
            return VerificationStatus.VERIFIED.value, "Simulated verification in dry-run mode"

        res_cfg = self.selectors.get("results", {})
        loading_selectors = res_cfg.get("loading_indicator", [])
        success_selectors = res_cfg.get("success_indicators", [])
        invalid_selectors = res_cfg.get("invalid_indicators", [])
        not_found_selectors = res_cfg.get("not_found_indicators", [])
        error_selectors = res_cfg.get("error_indicators", [])

        start_time = time.time()
        max_duration = timeout_ms / 1000.0

        # Wait briefly for loading indicator to appear or process to initiate
        time.sleep(1.0)

        while time.time() - start_time < max_duration:
            # Check for loading spinner
            is_loading = False
            for sel in loading_selectors:
                try:
                    if page.locator(sel).first.is_visible(timeout=500):
                        is_loading = True
                        break
                except Exception:
                    pass

            if is_loading:
                time.sleep(1)
                continue

            # Check for Success / Verified
            for sel in success_selectors:
                try:
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=500):
                        text = loc.inner_text().strip()
                        logger.info(f"Detected success status: {text}")
                        return VerificationStatus.VERIFIED.value, f"Status: {text}"
                except Exception:
                    continue

            # Check for Invalid Details
            for sel in invalid_selectors:
                try:
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=500):
                        text = loc.inner_text().strip()
                        logger.info(f"Detected invalid details status: {text}")
                        return VerificationStatus.INVALID_DETAILS.value, f"Portal message: {text}"
                except Exception:
                    continue

            # Check for Record Not Found
            for sel in not_found_selectors:
                try:
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=500):
                        text = loc.inner_text().strip()
                        logger.info(f"Detected record not found: {text}")
                        return VerificationStatus.RECORD_NOT_FOUND.value, f"Portal message: {text}"
                except Exception:
                    continue

            # Check for Server or Application Error
            for sel in error_selectors:
                try:
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=500):
                        text = loc.inner_text().strip()
                        logger.error(f"Detected portal error: {text}")
                        return VerificationStatus.VERIFICATION_ERROR.value, f"Error: {text}"
                except Exception:
                    continue

            time.sleep(1.5)

        logger.warning("Verification result detection timed out.")
        return VerificationStatus.NOT_VERIFIED.value, "Verification result detection timed out"

    def download_report_if_available(
        self,
        page: Page,
        gsm_id: str,
        phone_number: str,
        timeout_ms: int = 15000
    ) -> Dict[str, Any]:
        """
        Attempts to click the download PDF button and save the report.
        """
        if self.dry_run:
            logger.info("[DRY-RUN] Simulating PDF report generation.")
            return {
                "status": ReportStatus.DOWNLOADED.value,
                "filename": f"{gsm_id}_{phone_number}_DL_Report.pdf",
                "path": "data/reports/simulated.pdf",
                "error": ""
            }

        pdf_selectors = self.selectors.get("results", {}).get("download_pdf_button", [])
        loc, sel = self._find_first_visible(page, pdf_selectors, timeout_ms=3000)

        if not loc:
            logger.info("No download report button available on portal for this record.")
            return {
                "status": ReportStatus.NOT_AVAILABLE.value,
                "filename": "",
                "path": "",
                "error": "Report download button not found or not generated"
            }

        def trigger_download():
            loc.click()

        return self.download_mgr.capture_download(
            trigger_action_callback=trigger_download,
            gsm_id=gsm_id,
            phone_number=phone_number,
            page=page,
            timeout_ms=timeout_ms
        )
