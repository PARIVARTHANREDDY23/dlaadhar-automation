import os
import sys
import time
import asyncio
from pathlib import Path
from typing import Optional, Tuple
from playwright.sync_api import sync_playwright, BrowserContext, Page, Playwright

from config import PROFILE_DIR, DEFAULT_HEADLESS, DEFAULT_SLOW_MO, DEFAULT_NAV_TIMEOUT, SUREPASS_LOGIN_URL
from utils.logger import get_logger

logger = get_logger("BrowserManager")

class BrowserManager:
    """
    Manages Playwright browser lifecycle with a persistent context.
    Preserves cookies, session storage, and login state across application runs.
    Includes automated self-healing for orphaned processes and locked profiles.
    """
    def __init__(self, headless: bool = DEFAULT_HEADLESS, slow_mo: int = DEFAULT_SLOW_MO):
        self.headless = headless
        self.slow_mo = slow_mo
        # Cloud/Linux fallback: Force headless if no graphical display is present
        if sys.platform != "win32" and not os.environ.get("DISPLAY"):
            self.headless = True
        self.playwright: Optional[Playwright] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.is_running = False

    @staticmethod
    def kill_lingering_chrome():
        """Terminates any orphaned Chrome processes holding locks on browser_profile."""
        try:
            import psutil
            target_str = str(PROFILE_DIR).lower()
            for p in psutil.process_iter(['pid', 'name', 'cmdline']):
                try:
                    name = (p.info.get('name') or '').lower()
                    cmd = ' '.join(p.info.get('cmdline') or []).lower()
                    if 'chrome' in name and (target_str in cmd or 'browser_profile' in cmd):
                        logger.warning(f"Terminating lingering Chrome process (PID: {p.pid})")
                        p.kill()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            time.sleep(1)
        except Exception as e:
            logger.debug(f"Error checking lingering processes: {e}")

    @staticmethod
    def clean_stale_locks(profile_dir: Path):
        """Removes Chromium singleton lock files if previous session terminated abnormally."""
        if not profile_dir.exists():
            return
        lock_names = ["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"]
        for name in lock_names:
            lock_path = profile_dir / name
            try:
                if lock_path.exists():
                    lock_path.unlink()
                    logger.info(f"Removed stale Chromium lock: {name}")
            except Exception as e:
                logger.debug(f"Could not remove lock {name}: {e}")

        # Also clear lock files inside Default/
        default_dir = profile_dir / "Default"
        if default_dir.exists():
            for lock_file in default_dir.glob("*LOCK*"):
                try:
                    lock_file.unlink()
                except Exception:
                    pass

    def is_alive(self) -> bool:
        """Checks if browser context and page are still active and open."""
        try:
            if not self.is_running or not self.page or self.page.is_closed():
                return False
            _ = self.page.url
            return True
        except Exception:
            return False

    def _create_context(self) -> BrowserContext:
        """Internal helper to instantiate persistent context with robust flags."""
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        self.clean_stale_locks(PROFILE_DIR)

        # Force headless on cloud/headless Linux environments without a display
        if sys.platform != "win32" and not os.environ.get("DISPLAY"):
            self.headless = True

        if not self.headless:
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--start-maximized"
            ]
            return self.playwright.chromium.launch_persistent_context(
                user_data_dir=str(PROFILE_DIR),
                headless=False,
                slow_mo=self.slow_mo,
                accept_downloads=True,
                no_viewport=True,
                args=launch_args
            )
        else:
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox"
            ]
            return self.playwright.chromium.launch_persistent_context(
                user_data_dir=str(PROFILE_DIR),
                headless=True,
                slow_mo=self.slow_mo,
                accept_downloads=True,
                viewport={"width": 1366, "height": 768},
                args=launch_args
            )

    def start_browser(self, headless: Optional[bool] = None) -> Page:
        """Starts or returns the active persistent Chromium context."""
        if self.is_alive():
            logger.info("Reusing existing active browser session.")
            return self.page

        # Cleanly shut down any dead handles before fresh launch
        self.close()

        if headless is not None:
            self.headless = headless

        # Cloud/Linux fallback: Force headless if no graphical display is present
        if sys.platform != "win32" and not os.environ.get("DISPLAY"):
            self.headless = True

        logger.info(f"Starting Chromium browser (Headless: {self.headless}, Profile: {PROFILE_DIR})...")

        try:
            if sys.platform == "win32":
                try:
                    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
                except Exception as loop_err:
                    logger.debug(f"Event loop policy notice: {loop_err}")

            self.playwright = sync_playwright().start()

            try:
                self.context = self._create_context()
            except Exception as launch_err:
                err_msg = str(launch_err) or repr(launch_err)
                if "already in use" in err_msg or "existing browser session" in err_msg:
                    logger.warning("Chromium profile was in use by another process. Terminating orphaned instance and retrying...")
                    self.kill_lingering_chrome()
                    self.clean_stale_locks(PROFILE_DIR)
                    time.sleep(1.5)
                    self.context = self._create_context()
                elif "Executable doesn't exist" in err_msg or "playwright install" in err_msg:
                    logger.warning("Playwright Chromium browser binary missing. Auto-installing now...")
                    import subprocess
                    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
                    logger.info("Playwright Chromium installed. Retrying browser launch...")
                    self.context = self._create_context()
                else:
                    raise launch_err

            # Set default timeouts
            self.context.set_default_navigation_timeout(DEFAULT_NAV_TIMEOUT)
            self.context.set_default_timeout(DEFAULT_NAV_TIMEOUT)

            # Get or create page
            if self.context.pages:
                self.page = self.context.pages[0]
            else:
                self.page = self.context.new_page()

            self.is_running = True
            logger.info("Browser initialized successfully.")
            return self.page

        except Exception as e:
            err_msg = str(e) or repr(e)
            logger.error(f"Failed to start Chromium context: {err_msg}", exc_info=True)
            self.close()
            raise RuntimeError(f"Could not launch browser: {err_msg}")

    def get_page(self) -> Page:
        """Returns the active page or initializes browser if needed."""
        if not self.is_alive():
            return self.start_browser()
        return self.page

    def close(self):
        """Closes browser context and Playwright cleanly."""
        try:
            if self.page and not self.page.is_closed():
                self.page.close()
        except Exception:
            pass

        try:
            if self.context:
                self.context.close()
        except Exception:
            pass

        try:
            if self.playwright:
                self.playwright.stop()
        except Exception:
            pass

        self.page = None
        self.context = None
        self.playwright = None
        self.is_running = False

    def open_inspector_mode(self, url: str = SUREPASS_LOGIN_URL):
        """
        Launches browser to let the developer/operator inspect
        elements, explore the portal, or log in manually.
        Automatically uses headless mode on cloud/Linux environments without a display.
        """
        is_cloud = (sys.platform != "win32" and not os.environ.get("DISPLAY"))
        logger.info(f"Launching Setup/Inspector Mode at: {url} (Cloud Headless: {is_cloud})")
        page = self.start_browser(headless=True if is_cloud else False)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            logger.warning(f"Inspector navigation notice: {e}")
        return page

    def take_screenshot(self) -> Optional[bytes]:
        """Captures page screenshot as bytes for UI mirroring."""
        try:
            if self.is_alive() and self.page:
                return self.page.screenshot(type="png", full_page=False)
        except Exception as e:
            logger.debug(f"Failed to capture screenshot: {e}")
        return None

    def export_storage_state(self, file_path: Path) -> bool:
        """Exports cookies and session to a JSON file."""
        try:
            if self.context:
                self.context.storage_state(path=str(file_path))
                return True
        except Exception as e:
            logger.error(f"Error exporting storage state: {e}")
        return False

    def import_storage_state(self, file_path: Path) -> bool:
        """Restores cookies and session from a JSON file."""
        try:
            if file_path.exists() and self.context:
                with open(file_path, "r", encoding="utf-8") as f:
                    state_data = json.load(f)
                if "cookies" in state_data:
                    self.context.add_cookies(state_data["cookies"])
                    return True
        except Exception as e:
            logger.error(f"Error importing storage state: {e}")
        return False

    def remote_navigate(self, url: str) -> Tuple[bool, str]:
        """Navigates to a specific URL."""
        try:
            page = self.get_page()
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            return True, f"Navigated to {url}"
        except Exception as e:
            return False, f"Navigation failed: {e}"

    def remote_fill_and_submit_login(self, username: str, password: str) -> Tuple[bool, str]:
        """Remotely fills login username and password on the page."""
        try:
            page = self.get_page()
            user_selectors = [
                "input[type='email']", "input[name='email']", "input[name='username']",
                "input[placeholder*='email' i]", "input[placeholder*='mobile' i]",
                "input[placeholder*='phone' i]", "input[type='text']"
            ]
            for sel in user_selectors:
                try:
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=1500):
                        loc.fill(username)
                        break
                except Exception:
                    continue

            pass_selectors = ["input[type='password']", "input[name='password']"]
            for sel in pass_selectors:
                try:
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=1500):
                        loc.fill(password)
                        break
                except Exception:
                    continue

            submit_selectors = [
                "button[type='submit']", "button:has-text('Sign In')",
                "button:has-text('Login')", "button:has-text('Log In')", "button:has-text('Continue')"
            ]
            clicked = False
            for sel in submit_selectors:
                try:
                    btn = page.locator(sel).first
                    if btn.is_visible(timeout=1500):
                        btn.click()
                        clicked = True
                        break
                except Exception:
                    continue

            if not clicked:
                page.keyboard.press("Enter")

            time.sleep(2)
            return True, "Credentials submitted. Refresh live screen below."
        except Exception as e:
            return False, f"Failed submitting credentials: {e}"

    def remote_submit_otp(self, otp: str) -> Tuple[bool, str]:
        """Remotely fills and submits OTP code."""
        try:
            page = self.get_page()
            otp_selectors = [
                "input[name='otp']", "input[placeholder*='otp' i]",
                "input[aria-label*='otp' i]", "input[type='text']", "input[type='number']"
            ]
            for sel in otp_selectors:
                try:
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=1500):
                        loc.fill(otp)
                        break
                except Exception:
                    continue

            btn_selectors = [
                "button:has-text('Verify')", "button:has-text('Submit')",
                "button:has-text('Continue')", "button[type='submit']"
            ]
            for sel in btn_selectors:
                try:
                    btn = page.locator(sel).first
                    if btn.is_visible(timeout=1500):
                        btn.click()
                        break
                except Exception:
                    continue

            time.sleep(2)
            return True, "OTP submitted. Refresh live screen below."
        except Exception as e:
            return False, f"Failed submitting OTP: {e}"
