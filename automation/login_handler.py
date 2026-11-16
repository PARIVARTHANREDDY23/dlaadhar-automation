import time
import json
from pathlib import Path
from typing import Optional, Dict, Any, List
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout

from config import SELECTORS_CONFIG_PATH, SUREPASS_LOGIN_URL, SUREPASS_DASHBOARD_URL
from utils.logger import get_logger

logger = get_logger("LoginHandler")

class LoginHandler:
    """
    Handles authentication status checking, manual login observation,
    and session expiry detection.
    """
    def __init__(self, selectors_config_path: Optional[Path] = None):
        self.config_path = selectors_config_path or SELECTORS_CONFIG_PATH
        self.selectors = self._load_selectors()

    def _load_selectors(self) -> Dict[str, Any]:
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load selectors config: {e}")
        return {}

    def is_logged_in(self, page: Page) -> bool:
        """
        Determines if the session is currently authenticated.
        Checks current URL and logged-in indicator selectors.
        """
        try:
            current_url = page.url.lower()

            # If explicitly on login or signin page
            if "login" in current_url or "signin" in current_url:
                # Also check if login form elements are present
                email_selectors = self.selectors.get("login", {}).get("email_input", [])
                for sel in email_selectors:
                    if page.locator(sel).first.is_visible(timeout=1500):
                        return False

            # Check indicators
            indicators = self.selectors.get("login", {}).get("logged_in_indicators", [])
            for ind in indicators:
                try:
                    if page.locator(ind).first.is_visible(timeout=1500):
                        logger.info(f"Detected logged-in indicator: {ind}")
                        return True
                except Exception:
                    continue

            # If URL is in console, dashboard or services and no login input visible
            if ("dashboard" in current_url or "services" in current_url or "console.surepass" in current_url) and "login" not in current_url:
                return True

            return False
        except Exception as e:
            logger.debug(f"Error checking login status: {e}")
            return False

    def wait_for_manual_login(
        self,
        page: Page,
        timeout_seconds: int = 300,
        status_callback=None
    ) -> bool:
        """
        Navigates to login URL if needed and waits for operator to log in manually.
        Handles OTP / CAPTCHA via operator interaction.
        """
        login_url = self.selectors.get("urls", {}).get("login_url", SUREPASS_LOGIN_URL)
        
        # Check if already logged in
        if self.is_logged_in(page):
            logger.info("Session already authenticated.")
            if status_callback:
                status_callback("Authenticated")
            return True

        logger.info(f"Navigating to login page: {login_url}")
        if status_callback:
            status_callback("Navigating to login page...")

        try:
            page.goto(login_url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            logger.warning(f"Navigation warning: {e}")

        # Check again in case persistent cookies logged us in immediately
        time.sleep(2)
        if self.is_logged_in(page):
            logger.info("Persistent session restored.")
            if status_callback:
                status_callback("Authenticated")
            return True

        msg = f"Waiting for operator to complete manual login / OTP / CAPTCHA (Timeout: {timeout_seconds}s)..."
        logger.warning(msg)
        if status_callback:
            status_callback("Awaiting manual login / OTP in browser window...")

        start_time = time.time()
        while time.time() - start_time < timeout_seconds:
            if self.is_logged_in(page):
                logger.info("Manual login successfully completed by operator!")
                if status_callback:
                    status_callback("Login successful!")
                return True
            time.sleep(2)

        logger.error("Timed out waiting for manual login.")
        if status_callback:
            status_callback("Login timed out.")
        return False

    def is_session_expired(self, page: Page) -> bool:
        """Detects if session expired mid-verification."""
        try:
            current_url = page.url.lower()
            if "login" in current_url or "signin" in current_url:
                return True
            # Check for session expired toast/modal
            expired_text = page.locator("text='Session Expired'").first
            if expired_text.is_visible(timeout=500):
                return True
        except Exception:
            pass
        return False

