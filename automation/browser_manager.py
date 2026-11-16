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
        Launches browser in headed mode to let the developer/operator inspect
        elements, explore the portal, or log in manually.
        """
        logger.info(f"Launching Setup/Inspector Mode at: {url}")
        page = self.start_browser(headless=False)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            logger.warning(f"Inspector navigation notice: {e}")
        return page
