import os
import sys
import asyncio

# Fix Windows asyncio subprocess NotImplementedError with Playwright under Streamlit/Tornado
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

import time
import json
import subprocess
from pathlib import Path
import pandas as pd
import streamlit as st

# Configure page
st.set_page_config(
    page_title="Surepass DL Verification Automation",
    page_icon="🚗",
    layout="wide",
    initial_sidebar_state="expanded"
)

from config import (
    BASE_DIR, INPUT_DIR, OUTPUT_DIR, REPORTS_DIR,
    DEFAULT_COLUMN_MAPPING, SELECTORS_CONFIG_PATH, SUREPASS_LOGIN_URL
)
from database import db_manager
from core.status_manager import STATUS_COLORS, VerificationStatus, ProcessingStatus, ReportStatus
import importlib
import core.job_manager
importlib.reload(core.job_manager)
from core.job_manager import JobManager
from utils.logger import get_logger, get_recent_logs
from utils.file_manager import get_reports_summary, create_reports_zip

logger = get_logger("StreamlitApp")
job_mgr = JobManager()

# --- Custom Styling ---
st.markdown("""
<style>
    .main-header {
        font-size: 26px;
        font-weight: 700;
        color: #1E293B;
        margin-bottom: 4px;
    }
    .sub-header {
        font-size: 14px;
        color: #64748B;
        margin-bottom: 20px;
    }
    .metric-card {
        background-color: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        padding: 14px;
        text-align: center;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .metric-val {
        font-size: 24px;
        font-weight: 700;
        color: #0F172A;
    }
    .metric-lbl {
        font-size: 12px;
        font-weight: 600;
        color: #64748B;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .status-badge {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        color: white;
    }
</style>
""", unsafe_allow_html=True)

# --- Sidebar Controls ---
st.sidebar.image("https://img.icons8.com/fluency/96/driver-license.png", width=64)
st.sidebar.title("DL Automation")
st.sidebar.caption("Automated Driving Licence Verification via Surepass")

# Cloud / Headless warning
if sys.platform != "win32" and not os.environ.get("DISPLAY"):
    st.sidebar.warning(
        "☁️ **Streamlit Cloud Detected**\n\n"
        "The dashboard and Excel analysis are active. However, opening a visible browser for **Surepass manual login, OTP, and CAPTCHA** requires running the app on a desktop machine."
    )

st.sidebar.markdown("---")
st.sidebar.subheader("⚙️ System Execution Modes")
dry_run_mode = st.sidebar.toggle("🧪 Dry-Run Mode (Simulation)", value=False, help="Simulates processing without making real portal submissions or consuming credits.")
headless_mode = st.sidebar.toggle("👁️ Headless Browser", value=False, help="Run browser in background without visible window. Turn off to see operator browser actions.")

st.sidebar.markdown("---")
st.sidebar.subheader("🌐 Portal Interactive Setup")
custom_portal_url = st.sidebar.text_input("Surepass Portal URL", value=SUREPASS_LOGIN_URL)
if st.sidebar.button("🚀 Launch Browser / Inspector", use_container_width=True, help="Opens a persistent headed browser to log in, solve CAPTCHA/OTP, or inspect Surepass elements."):
    if not hasattr(job_mgr, "open_browser_inspector"):
        import importlib
        import core.job_manager
        importlib.reload(core.job_manager)
        job_mgr = core.job_manager.JobManager()
    ok, msg = job_mgr.open_browser_inspector(custom_portal_url.strip() or SUREPASS_LOGIN_URL)
    if ok:
        st.sidebar.success("Browser window opened! Log in or inspect the page.")
        st.rerun()
    else:
        st.sidebar.error(f"Error opening browser: {msg}")

b_col1, b_col2 = st.sidebar.columns(2)
with b_col1:
    if st.button("🛑 Close Browser", use_container_width=True, help="Closes open Chromium browser window."):
        if hasattr(job_mgr, "close_browser"):
            job_mgr.close_browser()
        st.sidebar.info("Browser closed.")
        st.rerun()
with b_col2:
    if st.button("🔄 Reset / Kill", use_container_width=True, help="Kills any stuck or orphaned Chrome processes and clears profile locks."):
        if hasattr(job_mgr, "reset_browser"):
            job_mgr.reset_browser()
        st.sidebar.warning("Lingering Chrome killed and locks cleared.")
        st.rerun()

st.sidebar.markdown("---")
if st.sidebar.button("📂 Open Reports Folder", use_container_width=True):
    try:
        os.startfile(str(REPORTS_DIR.resolve()))
    except Exception as e:
        st.sidebar.error(f"Could not open folder: {e}")

# Header
st.markdown('<div class="main-header">🚗 Driving Licence Verification System</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">Surepass Browser Automation Operations Dashboard</div>', unsafe_allow_html=True)

# Active Job Detection
active_job = None
latest_job_db = db_manager.get_latest_job()
if job_mgr.current_job_id:
    active_job = db_manager.get_job(job_mgr.current_job_id)
elif latest_job_db:
    active_job = latest_job_db
    job_mgr.current_job_id = latest_job_db["job_id"]

# SECTION A: Overview Metrics
stats = {"total": 0, "verified": 0, "not_verified": 0, "pending": 0, "failed": 0, "reports_downloaded": 0, "percentage": 0.0}
if active_job:
    stats = db_manager.get_job_statistics(active_job["job_id"])

col1, col2, col3, col4, col5, col6, col7 = st.columns(7)
with col1:
    st.markdown(f'<div class="metric-card"><div class="metric-val">{stats.get("total", 0)}</div><div class="metric-lbl">Total Drivers</div></div>', unsafe_allow_html=True)
with col2:
    st.markdown(f'<div class="metric-card"><div class="metric-val" style="color:#10B981;">{stats.get("verified", 0)}</div><div class="metric-lbl">Verified</div></div>', unsafe_allow_html=True)
with col3:
    st.markdown(f'<div class="metric-card"><div class="metric-val" style="color:#F59E0B;">{stats.get("not_verified", 0)}</div><div class="metric-lbl">Not Verified</div></div>', unsafe_allow_html=True)
with col4:
    st.markdown(f'<div class="metric-card"><div class="metric-val" style="color:#3B82F6;">{stats.get("pending", 0) + stats.get("processing", 0)}</div><div class="metric-lbl">Pending</div></div>', unsafe_allow_html=True)
with col5:
    st.markdown(f'<div class="metric-card"><div class="metric-val" style="color:#EF4444;">{stats.get("failed", 0)}</div><div class="metric-lbl">Failed</div></div>', unsafe_allow_html=True)
with col6:
    st.markdown(f'<div class="metric-card"><div class="metric-val" style="color:#6366F1;">{stats.get("reports_downloaded", 0)}</div><div class="metric-lbl">Reports</div></div>', unsafe_allow_html=True)
with col7:
    st.markdown(f'<div class="metric-card"><div class="metric-val" style="color:#0F172A;">{stats.get("percentage", 0.0)}%</div><div class="metric-lbl">Progress</div></div>', unsafe_allow_html=True)

st.progress(float(stats.get("percentage", 0.0)) / 100.0)

# Dashboard Tabs
tab_ops, tab_upload, tab_reports, tab_selectors, tab_logs = st.tabs([
    "⚡ Verification Operations",
    "📁 Excel Upload & Validation",
    "📄 PDF Reports",
    "⚙️ Portal Selectors",
    "📜 System Logs"
])

# --- TAB 1: OPERATIONS & LIVE CONTROLS ---
with tab_ops:
    st.subheader("Verification Controls")
    
    ctrl_col1, ctrl_col2, ctrl_col3, ctrl_col4, ctrl_col5 = st.columns(5)
    is_running = job_mgr.is_running()

    with ctrl_col1:
        if st.button("▶️ Start Verification", disabled=is_running or not active_job, use_container_width=True, type="primary"):
            success = job_mgr.start_verification(dry_run=dry_run_mode, headless=headless_mode)
            if success:
                st.success("Verification started!")
                st.rerun()
            else:
                st.error(f"Failed to start: {job_mgr.get_state().get('message')}")

    with ctrl_col2:
        if st.button("⏸️ Pause", disabled=not is_running, use_container_width=True):
            job_mgr.pause_verification()
            st.info("Verification paused.")
            st.rerun()

    with ctrl_col3:
        if st.button("⏯️ Resume", disabled=not is_running, use_container_width=True):
            job_mgr.resume_verification()
            st.info("Verification resumed.")
            st.rerun()

    with ctrl_col4:
        if st.button("⏹️ Stop Safely", disabled=not is_running, use_container_width=True):
            job_mgr.stop_verification()
            st.warning("Stop signal sent. Finishing current transaction...")
            st.rerun()

    with ctrl_col5:
        if st.button("🔄 Retry Failed", disabled=is_running or not active_job, use_container_width=True):
            success = job_mgr.start_verification(dry_run=dry_run_mode, headless=headless_mode, retry_failed_only=True)
            if success:
                st.success("Retrying failed records...")
                st.rerun()

    # Live Status Bar
    state = job_mgr.get_state()
    st.markdown("---")
    status_box = st.container()
    with status_box:
        stage = state.get('stage', 'Idle')
        msg = state.get('message', '')

        if "Error" in stage or "Failed" in stage or "Exception" in stage:
            st.error(f"⚠️ **{stage}**: {msg}")
        elif "Auth" in stage or "login" in msg.lower():
            st.warning(f"🔑 **{stage}**: {msg}\n\n👉 *Please switch to the Chromium browser window on your taskbar, enter your credentials/OTP, and solve any CAPTCHA.*")
        elif is_running:
            st.info(f"🔄 **{stage}**: {msg}")

        st.markdown(f"""
        **Current Execution Details:**
        - **Current Stage:** `{stage}` | **Status:** `{state.get('latest_status')}`
        - **Processing Row:** `{state.get('current_row')}` | **Driver GSM ID:** `{state.get('current_gsm')}`
        """)

    # Live Data Table
    st.markdown("### 📋 Driver Verification Queue")
    
    filter_col1, filter_col2 = st.columns([2, 4])
    with filter_col1:
        status_filter = st.selectbox(
            "Filter by Status:",
            ["All", "Verified", "Not Verified", "Pending", "Failed", "Completed", "Skipped"]
        )

    if active_job:
        records = db_manager.get_job_records(active_job["job_id"], status_filter=status_filter)
        if records:
            df_display = pd.DataFrame(records)[[
                "row_index", "gsm_id", "phone_number", "dl_number_masked",
                "verification_status", "processing_status", "report_download_status",
                "verification_remarks", "verification_date"
            ]]
            df_display.columns = [
                "Row #", "GSM ID", "Phone Number", "DL Number (Masked)",
                "Verification Status", "Processing Status", "Report Status",
                "Remarks", "Processed At"
            ]
            st.dataframe(df_display, use_container_width=True, height=400)
        else:
            st.info(f"No records found matching status '{status_filter}'.")
    else:
        st.info("No active verification job. Upload an Excel file in the 'Excel Upload' tab to start.")

    # Auto refresh checkbox
    if is_running:
        time.sleep(2)
        st.rerun()

# --- TAB 2: EXCEL UPLOAD & VALIDATION ---
with tab_upload:
    st.subheader("Upload Driver Excel File")
    uploaded_file = st.file_uploader("Upload Excel Sheet (.xlsx or .xls)", type=["xlsx", "xls"])
    
    if uploaded_file is not None:
        # Save uploaded file to input directory
        temp_input_path = INPUT_DIR / uploaded_file.name
        with open(temp_input_path, "wb") as f:
            f.write(uploaded_file.getbuffer())

        # Load file for inspection
        from core.excel_processor import ExcelProcessor
        preview_proc = ExcelProcessor(str(temp_input_path))
        cols, row_count = preview_proc.load_and_inspect()
        auto_map = preview_proc.auto_detect_mapping(cols)

        st.success(f"File loaded successfully: **{uploaded_file.name}** ({row_count} rows detected).")

        st.markdown("#### ⚙️ Column Mapping Configuration")
        col_m1, col_m2, col_m3, col_m4 = st.columns(4)
        
        with col_m1:
            gsm_col = st.selectbox("GSM ID Column", cols, index=cols.index(auto_map.get("gsm_id", cols[0])))
        with col_m2:
            phone_col = st.selectbox("Phone Number Column", cols, index=cols.index(auto_map.get("phone_number", cols[0])))
        with col_m3:
            dl_col = st.selectbox("DL Number Column", cols, index=cols.index(auto_map.get("dl_number", cols[0])))
        with col_m4:
            dob_col = st.selectbox("DOB Column", cols, index=cols.index(auto_map.get("dob", cols[0])))

        final_mapping = {
            "gsm_id": gsm_col,
            "phone_number": phone_col,
            "dl_number": dl_col,
            "dob": dob_col
        }

        # Validate Button
        if st.button("🔍 Validate Data & Prepare Job Queue", type="primary"):
            job_id, records, summary = job_mgr.initialize_new_job(str(temp_input_path), final_mapping)
            st.session_state["prepared_job_id"] = job_id
            st.success(f"Job initialized successfully! (ID: {job_id})")
            st.markdown(f"""
            - **Total Records:** {summary['total_records']}
            - **Valid Records (Eligible for verification):** {summary['valid_records']}
            - **Invalid / Ineligible Records (Skipped):** {summary['invalid_records']}
            """)

            # Display Preview
            df_preview = pd.DataFrame(records)[[
                "row_index", "gsm_id", "phone_number", "dl_number_masked",
                "dob_masked", "is_valid", "verification_remarks"
            ]]
            df_preview.columns = ["Row", "GSM ID", "Phone", "DL (Masked)", "DOB (Masked)", "Is Valid?", "Validation Notes"]
            st.dataframe(df_preview, use_container_width=True)

            st.info("Navigate to the **Verification Operations** tab to start automated processing.")

    # Export Section
    st.markdown("---")
    st.subheader("📥 Export Output Excel")
    if active_job:
        out_path = Path(active_job["output_file_path"])
        if out_path.exists():
            with open(out_path, "rb") as f:
                st.download_button(
                    label=f"⬇️ Download Updated Excel ({out_path.name})",
                    data=f.read(),
                    file_name=out_path.name,
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    type="primary"
                )
        else:
            st.info("Output Excel file will be generated when verification starts.")

# --- TAB 3: REPORTS SECTION ---
with tab_reports:
    st.subheader("Downloaded Verification PDF Reports")
    reports = get_reports_summary()

    col_r1, col_r2 = st.columns([3, 1])
    with col_r1:
        st.write(f"Total Downloaded Reports: **{len(reports)}**")
    with col_r2:
        if reports:
            zip_path = create_reports_zip()
            if zip_path and zip_path.exists():
                with open(zip_path, "rb") as zf:
                    st.download_button(
                        label="📦 Download All Reports (ZIP)",
                        data=zf.read(),
                        file_name=zip_path.name,
                        mime="application/zip",
                        type="primary",
                        use_container_width=True
                    )

    if reports:
        for rep in reports:
            with st.expander(f"📄 {rep['filename']} ({rep['size_kb']} KB) - Modified: {rep['modified']}"):
                r_col1, r_col2 = st.columns([4, 1])
                with r_col1:
                    st.text(f"File Path: {rep['path']}")
                with r_col2:
                    with open(rep['path'], "rb") as pf:
                        st.download_button(
                            label="⬇️ Download PDF",
                            data=pf.read(),
                            file_name=rep['filename'],
                            mime="application/pdf",
                            key=f"dl_btn_{rep['filename']}"
                        )
    else:
        st.info("No reports downloaded yet. Downloaded PDFs will appear here.")

# --- TAB 4: SELECTORS CONFIGURATION ---
with tab_selectors:
    st.subheader("Surepass Portal Selectors & Inspection")
    st.caption("Inspect and customize page element selectors for your specific Surepass portal setup.")

    selectors_content = ""
    if SELECTORS_CONFIG_PATH.exists():
        with open(SELECTORS_CONFIG_PATH, "r", encoding="utf-8") as f:
            selectors_content = f.read()

    new_selectors = st.text_area("portal_selectors.json", value=selectors_content, height=450)
    
    if st.button("💾 Save Selectors Configuration"):
        try:
            # Validate JSON
            parsed = json.loads(new_selectors)
            with open(SELECTORS_CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(parsed, f, indent=2)
            st.success("Selectors configuration updated successfully!")
        except Exception as e:
            st.error(f"Invalid JSON format: {e}")

# --- TAB 5: SYSTEM LOGS ---
with tab_logs:
    st.subheader("System Activity & Security Logs")
    st.caption("Sensitive PII (DL numbers, phone numbers, DOBs) are automatically masked in all log entries.")

    if st.button("🔄 Refresh Logs"):
        st.rerun()

    logs = get_recent_logs(limit=150)
    log_text = "\n".join([f"[{l['timestamp']}] [{l['level']}] {l['message']}" for l in reversed(logs)])
    st.text_area("Activity Log", value=log_text, height=400, disabled=True)

