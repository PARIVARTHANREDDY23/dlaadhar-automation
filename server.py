import os
import sys
import time
import json
import base64
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, Request, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Enforce proactor loop on Windows for Playwright subprocesses
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

from config import (
    BASE_DIR, INPUT_DIR, OUTPUT_DIR, REPORTS_DIR,
    DEFAULT_COLUMN_MAPPING, SUREPASS_LOGIN_URL, SUREPASS_DL_URL, DB_PATH
)
from database import db_manager
from core.job_manager import JobManager
from core.excel_processor import ExcelProcessor
from utils.logger import get_logger, get_recent_logs
from utils.file_manager import get_reports_summary, create_reports_zip

logger = get_logger("FastAPIServer")
job_mgr = JobManager()

app = FastAPI(
    title="Driving Licence Verification Automation API",
    description="Professional enterprise backend for Surepass DL Verification with automated queuing and PDF capture.",
    version="2.0.0"
)

# Enable CORS for external/cloud access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure web directory exists
WEB_DIR = BASE_DIR / "web"
WEB_DIR.mkdir(parents=True, exist_ok=True)


# --- REST ENDPOINTS ---

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    """Serves the single-page application dashboard."""
    index_file = WEB_DIR / "index.html"
    if index_file.exists():
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h2>DL Verification Web UI is loading...</h2>")


@app.post("/api/upload/inspect")
async def inspect_uploaded_excel(request: Request):
    """
    Step 1: Uploads file temporarily and extracts sheet headers/columns
    so the operator can verify and choose column mapping before processing.
    """
    content_type = request.headers.get("content-type", "")
    filename = "driver_upload.xlsx"
    file_bytes = b""

    try:
        if "application/json" in content_type:
            payload = await request.json()
            filename = payload.get("filename", "drivers.xlsx")
            content_b64 = payload.get("content_base64", "")
            file_bytes = base64.b64decode(content_b64)
        elif "multipart/form-data" in content_type:
            form = await request.form()
            file_field = form.get("file")
            if hasattr(file_field, "filename") and hasattr(file_field, "read"):
                filename = file_field.filename
                file_bytes = await file_field.read()
            else:
                file_bytes = await request.body()
        else:
            filename = request.query_params.get("filename", "drivers.xlsx")
            file_bytes = await request.body()

        if not file_bytes:
            raise HTTPException(status_code=400, detail="Empty file payload received.")

        # Save to input folder with unique prefix
        file_id = f"upload_{int(time.time())}_{Path(filename).name}"
        dest_path = INPUT_DIR / file_id
        with open(dest_path, "wb") as f:
            f.write(file_bytes)

        # Inspect headers
        proc = ExcelProcessor(str(dest_path))
        columns, row_count = proc.load_and_inspect()
        auto_mapping = proc.auto_detect_mapping(columns)

        return {
            "success": True,
            "file_id": file_id,
            "filename": filename,
            "columns": columns,
            "auto_mapping": auto_mapping,
            "total_rows": row_count
        }

    except Exception as e:
        logger.error(f"Error inspecting upload: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload/confirm")
async def confirm_upload_mapping(request: Request):
    """
    Step 2: Receives the user-selected column mappings, initializes the verification job,
    validates the driver rows, and returns the preview.
    """
    try:
        body = await request.json()
        file_id = body.get("file_id")
        if not file_id:
            raise HTTPException(status_code=400, detail="Missing file_id.")

        dest_path = INPUT_DIR / file_id
        if not dest_path.exists():
            raise HTTPException(status_code=404, detail="Uploaded file not found.")

        column_mapping = body.get("column_mapping") or DEFAULT_COLUMN_MAPPING

        # Initialize job with operator's chosen mapping
        job_id, records, summary = job_mgr.initialize_new_job(str(dest_path), column_mapping)

        # Return preview with masked data
        preview_records = []
        for r in records[:50]:
            preview_records.append({
                "row_index": r["row_index"],
                "gsm_id": r["gsm_id"],
                "phone_number": r["phone_number"],
                "dl_number_masked": r["dl_number_masked"],
                "dob_masked": r["dob_masked"],
                "is_valid": r["is_valid"],
                "remarks": r["verification_remarks"]
            })

        return {
            "success": True,
            "job_id": job_id,
            "filename": file_id,
            "summary": summary,
            "preview": preview_records
        }

    except Exception as e:
        logger.error(f"Error confirming mapping: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload")
async def upload_excel(request: Request):
    """
    Direct single-step upload fallback with auto-mapping.
    """
    content_type = request.headers.get("content-type", "")
    filename = "driver_upload.xlsx"
    file_bytes = b""
    column_mapping = None

    try:
        if "application/json" in content_type:
            payload = await request.json()
            filename = payload.get("filename", "drivers.xlsx")
            content_b64 = payload.get("content_base64", "")
            file_bytes = base64.b64decode(content_b64)
            column_mapping = payload.get("column_mapping")
        elif "multipart/form-data" in content_type:
            form = await request.form()
            file_field = form.get("file")
            if hasattr(file_field, "filename") and hasattr(file_field, "read"):
                filename = file_field.filename
                file_bytes = await file_field.read()
            else:
                file_bytes = await request.body()
        else:
            filename = request.query_params.get("filename", "drivers.xlsx")
            file_bytes = await request.body()

        if not file_bytes:
            raise HTTPException(status_code=400, detail="Empty file payload received.")

        dest_path = INPUT_DIR / filename
        with open(dest_path, "wb") as f:
            f.write(file_bytes)

        # Auto-detect mapping if not supplied
        if not column_mapping:
            proc = ExcelProcessor(str(dest_path))
            cols, _ = proc.load_and_inspect()
            column_mapping = proc.auto_detect_mapping(cols)

        # Initialize job
        job_id, records, summary = job_mgr.initialize_new_job(str(dest_path), column_mapping)

        preview_records = []
        for r in records[:50]:
            preview_records.append({
                "row_index": r["row_index"],
                "gsm_id": r["gsm_id"],
                "phone_number": r["phone_number"],
                "dl_number_masked": r["dl_number_masked"],
                "dob_masked": r["dob_masked"],
                "is_valid": r["is_valid"],
                "remarks": r["verification_remarks"]
            })

        return {
            "success": True,
            "job_id": job_id,
            "filename": filename,
            "summary": summary,
            "preview": preview_records
        }

    except Exception as e:
        logger.error(f"Error processing upload: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/jobs")
async def list_jobs():
    """Lists recent verification jobs from SQLite."""
    with db_manager.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20")
        jobs = [dict(row) for row in cursor.fetchall()]
    return {"jobs": jobs}


@app.get("/api/jobs/{job_id}")
async def get_job_info(job_id: str):
    """Returns detailed statistics and metadata for a specific job."""
    job = db_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    stats = db_manager.get_job_statistics(job_id)
    return {"job": job, "statistics": stats}


@app.get("/api/jobs/{job_id}/records")
async def get_job_records(
    job_id: str,
    status: str = Query("All", description="Status filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    search: str = Query("", description="Search GSM ID or Phone")
):
    """Returns filtered, paginated records for the job table."""
    records = db_manager.get_job_records(job_id, status_filter=status)
    if search:
        s = search.strip().lower()
        records = [r for r in records if s in str(r.get("gsm_id", "")).lower() or s in str(r.get("phone_number", "")).lower()]

    total_count = len(records)
    start_idx = (page - 1) * page_size
    paged = records[start_idx:start_idx + page_size]

    return {
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "records": paged
    }


@app.post("/api/jobs/{job_id}/start")
async def start_job(
    job_id: str,
    dry_run: bool = Query(False),
    headless: bool = Query(True),
    retry_failed: bool = Query(False)
):
    """Starts verification engine for the specified job."""
    job_mgr.current_job_id = job_id
    success = job_mgr.start_verification(
        dry_run=dry_run,
        headless=headless,
        retry_failed_only=retry_failed
    )
    if not success:
        state = job_mgr.get_state()
        raise HTTPException(status_code=400, detail=state.get("message", "Could not start verification."))
    return {"success": True, "message": "Verification started successfully."}


@app.post("/api/jobs/{job_id}/pause")
async def pause_job(job_id: str):
    """Pauses the verification worker cleanly."""
    job_mgr.pause_verification()
    return {"success": True, "message": "Verification paused."}


@app.post("/api/jobs/{job_id}/resume")
async def resume_job(job_id: str):
    """Resumes a paused verification worker."""
    job_mgr.resume_verification()
    return {"success": True, "message": "Verification resumed."}


@app.post("/api/jobs/{job_id}/stop")
async def stop_job(job_id: str):
    """Stops the verification worker cleanly."""
    job_mgr.stop_verification()
    return {"success": True, "message": "Verification stopped."}


@app.get("/api/jobs/{job_id}/status")
async def get_live_status(job_id: str):
    """Returns live execution state and statistics for polling/dashboard."""
    state = job_mgr.get_state()
    stats = db_manager.get_job_statistics(job_id)
    is_running = job_mgr.is_running()
    is_paused = job_mgr.is_paused()
    return {
        "job_id": job_id,
        "is_running": is_running,
        "is_paused": is_paused,
        "state": state,
        "statistics": stats
    }


@app.get("/api/jobs/{job_id}/export")
async def export_excel(job_id: str):
    """Downloads updated output Excel sheet with all verification columns populated."""
    job = db_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    output_path = Path(job["output_file_path"])
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Output file not generated yet.")
    return FileResponse(
        path=str(output_path),
        filename=output_path.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


# --- CHROME EXTENSION CONNECTOR ENDPOINTS ---

@app.get("/api/extension/status")
async def extension_status():
    """Returns the current active job status to the Chrome Extension."""
    current_job = job_mgr.current_job_id
    if not current_job:
        latest = db_manager.get_latest_job()
        if latest:
            current_job = latest["job_id"]
            job_mgr.current_job_id = current_job

    if not current_job:
        return {"connected": True, "has_job": False, "message": "No active batch in queue."}

    stats = db_manager.get_job_statistics(current_job)
    job = db_manager.get_job(current_job)
    return {
        "connected": True,
        "has_job": True,
        "job_id": current_job,
        "filename": job.get("input_filename", "") if job else "",
        "statistics": stats
    }


@app.get("/api/extension/next_driver")
async def extension_next_driver():
    """Provides the Chrome Extension with the next pending driver record to verify."""
    current_job = job_mgr.current_job_id
    if not current_job:
        latest = db_manager.get_latest_job()
        if latest:
            current_job = latest["job_id"]
            job_mgr.current_job_id = current_job

    if not current_job:
        raise HTTPException(status_code=404, detail="No active batch found.")

    pending_records = db_manager.get_pending_records(current_job)
    if not pending_records:
        return {"has_driver": False, "message": "All drivers in batch have been verified!"}

    rec = pending_records[0]
    dl_val = rec.get("dl_number") or ""
    dob_val = rec.get("dob") or ""

    # If unmasked DL or DOB is missing from DB record, backfill from original Excel
    if not dl_val or not dob_val:
        job = db_manager.get_job(current_job)
        if job and job.get("input_file_path"):
            try:
                import pandas as pd
                df_raw = pd.read_excel(job["input_file_path"])
                idx = rec["row_index"] - 2
                if 0 <= idx < len(df_raw):
                    row = df_raw.iloc[idx]
                    for col in df_raw.columns:
                        c_lower = str(col).strip().lower()
                        if not dl_val and c_lower in ["dl", "dl number", "dl_number", "driving licence", "driving license", "dl_no"]:
                            dl_val = str(row[col]).strip() if pd.notna(row[col]) else ""
                        if not dob_val and c_lower in ["dob", "date of birth", "birth date", "d.o.b"]:
                            if pd.notna(row[col]):
                                dob_val = str(row[col]).split(" ")[0].strip()
                    
                    if dl_val or dob_val:
                        with db_manager.get_connection() as conn:
                            conn.cursor().execute(
                                "UPDATE job_records SET dl_number = ?, dob = ? WHERE id = ?",
                                (dl_val, dob_val, rec["id"])
                            )
                            conn.commit()
            except Exception as e:
                logger.warning(f"Could not backfill driver info from Excel: {e}")

    return {
        "has_driver": True,
        "job_id": current_job,
        "record_id": rec["id"],
        "row_index": rec["row_index"],
        "gsm_id": rec.get("gsm_id", ""),
        "phone_number": rec.get("phone_number", ""),
        "dl_number": dl_val,
        "dob": dob_val,
        "pending_count": len(pending_records)
    }


@app.post("/api/extension/submit_result")
async def extension_submit_result(request: Request):
    """
    Receives verification outcome and optional PDF report from the Chrome Extension.
    Updates SQLite DB, writes to the output Excel spreadsheet, and notifies web dashboard.
    """
    body = await request.json()
    record_id = body.get("record_id")
    v_status = body.get("verification_status", "Verified")
    remarks = body.get("remarks", "")
    rep_filename = body.get("report_filename")
    rep_b64 = body.get("report_base64")

    if not record_id:
        raise HTTPException(status_code=400, detail="Missing record_id.")

    # Save PDF if provided
    rep_path = None
    rep_download_status = "Pending"
    if rep_filename and rep_b64:
        try:
            pdf_bytes = base64.b64decode(rep_b64)
            save_path = REPORTS_DIR / rep_filename
            with open(save_path, "wb") as f:
                f.write(pdf_bytes)
            rep_path = str(save_path.resolve())
            rep_download_status = "Downloaded"
        except Exception as e:
            logger.warning(f"Could not save extension uploaded report: {e}")

    now_iso = time.strftime("%Y-%m-%d %H:%M:%S")

    # Update SQLite Record
    db_manager.update_record_status(
        record_id=record_id,
        processing_status="Completed" if v_status in ["Verified", "Not Verified", "Invalid Details"] else "Failed",
        verification_status=v_status,
        verification_date=now_iso,
        verification_remarks=remarks,
        report_filename=rep_filename,
        report_path=rep_path,
        report_download_status=rep_download_status,
        completion_timestamp=now_iso
    )

    # Incrementally update output Excel file
    current_job = job_mgr.current_job_id
    if current_job:
        job_mgr.ensure_job_loaded(current_job)
        if job_mgr.excel_processor:
            with db_manager.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT row_index, gsm_id, phone_number FROM job_records WHERE id = ?", (record_id,))
                r_info = cursor.fetchone()
                if r_info:
                    row_idx = r_info["row_index"]
                    job_mgr.excel_processor.update_row(
                        row_index=row_idx,
                        verification_status=v_status,
                        verification_date=now_iso,
                        verification_remarks=remarks,
                        report_filename=rep_filename or "",
                        report_download_status=rep_download_status,
                        processing_status="Completed"
                    )
                    # Update live state for WebSocket dashboard
                    job_mgr.latest_state.update({
                        "stage": "Extension Verifying",
                        "message": f"Verified row {row_idx} ({r_info['gsm_id']}): {v_status}",
                        "current_gsm": r_info["gsm_id"],
                        "current_phone": r_info["phone_number"],
                        "current_row": row_idx,
                        "latest_status": v_status
                    })

    return {"success": True, "message": f"Record {record_id} updated to {v_status}."}


@app.get("/api/extension/download-zip")
async def download_extension_zip():
    """Bundles the Chrome Extension files into a ZIP archive for easy team distribution."""
    import zipfile
    ext_dir = BASE_DIR / "extension"
    zip_dest = DATA_DIR / "surepass_dl_extension.zip"
    with zipfile.ZipFile(zip_dest, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ext_dir.glob("*"):
            if f.is_file():
                z.write(f, arcname=f.name)
    return FileResponse(
        path=str(zip_dest),
        filename="surepass_dl_extension.zip",
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="surepass_dl_extension.zip"'}
    )


# --- REPORT ENDPOINTS ---

@app.get("/api/reports")
async def list_reports():
    """Lists downloaded PDF verification reports with validation status and metadata."""
    reports = get_reports_summary()
    return {"total": len(reports), "reports": reports}


@app.get("/api/reports/download/{filename}")
async def download_report(filename: str):
    """Downloads an individual PDF verification report."""
    report_path = REPORTS_DIR / filename
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report file not found.")
    return FileResponse(
        path=str(report_path),
        filename=filename,
        media_type="application/pdf"
    )


@app.get("/api/reports/zip")
async def download_all_reports_zip():
    """Bundles all verification PDFs into a timestamped ZIP archive."""
    zip_path = create_reports_zip()
    if not zip_path or not zip_path.exists():
        raise HTTPException(status_code=404, detail="No valid reports found to zip.")
    return FileResponse(
        path=str(zip_path),
        filename=zip_path.name,
        media_type="application/zip"
    )


# --- BROWSER REMOTE VIEW & CONTROL ENDPOINTS ---

@app.get("/api/browser/screenshot")
async def get_browser_screenshot():
    """Captures live PNG screenshot of the Chromium context."""
    bm = job_mgr.browser_manager
    if not bm or not bm.is_alive():
        raise HTTPException(status_code=404, detail="Browser is not running.")
    screen_bytes = bm.take_screenshot()
    if not screen_bytes:
        raise HTTPException(status_code=500, detail="Could not capture screenshot.")
    return Response(content=screen_bytes, media_type="image/png")


@app.post("/api/browser/launch")
async def launch_browser(url: str = Query(SUREPASS_LOGIN_URL)):
    """Launches or focuses the Chromium browser."""
    ok, msg = job_mgr.open_browser_inspector(url)
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    return {"success": True, "message": msg}


@app.post("/api/browser/login")
async def submit_remote_login(request: Request):
    """Submits login credentials remotely into the Chromium browser."""
    bm = job_mgr.browser_manager
    if not bm or not bm.is_alive():
        raise HTTPException(status_code=400, detail="Browser is not active.")
    body = await request.json()
    username = body.get("username", "")
    password = body.get("password", "")
    ok, msg = bm.remote_fill_and_submit_login(username, password)
    return {"success": ok, "message": msg}


@app.post("/api/browser/otp")
async def submit_remote_otp(request: Request):
    """Submits OTP/verification code remotely into the Chromium browser."""
    bm = job_mgr.browser_manager
    if not bm or not bm.is_alive():
        raise HTTPException(status_code=400, detail="Browser is not active.")
    body = await request.json()
    otp = body.get("otp", "")
    ok, msg = bm.remote_submit_otp(otp)
    return {"success": ok, "message": msg}


@app.post("/api/browser/navigate")
async def navigate_browser(url: str = Query(...)):
    """Navigates browser to specified URL."""
    bm = job_mgr.browser_manager
    if not bm or not bm.is_alive():
        raise HTTPException(status_code=400, detail="Browser is not active.")
    ok, msg = bm.remote_navigate(url)
    return {"success": ok, "message": msg}


@app.post("/api/browser/close")
async def close_browser():
    """Closes browser session cleanly."""
    job_mgr.close_browser()
    return {"success": True, "message": "Browser session closed."}


@app.get("/api/logs")
async def get_logs(limit: int = Query(100)):
    """Returns recent log messages with PII masked."""
    logs = get_recent_logs(max_lines=limit)
    return {"logs": logs}


# --- WEBSOCKET LIVE STREAMING ---

@app.websocket("/ws/live")
async def live_websocket_stream(websocket: WebSocket):
    """Streams live execution metrics and state every second to connected frontends."""
    await websocket.accept()
    try:
        while True:
            state = job_mgr.get_state()
            is_running = job_mgr.is_running()
            is_paused = job_mgr.is_paused()
            current_job = job_mgr.current_job_id
            if not current_job:
                latest = db_manager.get_latest_job()
                if latest:
                    current_job = latest["job_id"]
                    job_mgr.current_job_id = current_job

            job_info = db_manager.get_job(current_job) if current_job else None
            filename = job_info.get("input_filename") if job_info else None
            stats = db_manager.get_job_statistics(current_job) if current_job else {}
            logs = get_recent_logs(max_lines=30)

            payload = {
                "timestamp": time.time(),
                "job_id": current_job,
                "filename": filename,
                "is_running": is_running,
                "is_paused": is_paused,
                "state": state,
                "statistics": stats,
                "recent_logs": logs
            }
            await websocket.send_json(payload)
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WebSocket closed: {e}")


def find_available_port(start_port: int = 8000, max_attempts: int = 30) -> int:
    """Finds an available TCP port starting from start_port."""
    import socket
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    return start_port


def get_local_ip() -> str:
    """Dynamically detects the active local Wi-Fi or LAN IP address."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()


if __name__ == "__main__":
    import uvicorn
    import argparse

    parser = argparse.ArgumentParser(description="Surepass Verification API Server")
    parser.add_argument("--port", type=int, default=None, help="Port to bind server")
    args, _ = parser.parse_known_args()

    env_port = int(os.environ.get("PORT", 0)) if os.environ.get("PORT") else None
    chosen_port = args.port or env_port or find_available_port(8000)
    local_ip = get_local_ip()

    print("\n=======================================================")
    print(f"🚀 Surepass Verification Dashboard Ready!")
    print(f"👉 Local Browser Access:   http://localhost:{chosen_port}")
    print(f"👉 Team / Wi-Fi Access:    http://{local_ip}:{chosen_port}")
    print("=======================================================\n")

    uvicorn.run("server:app", host="0.0.0.0", port=chosen_port, reload=True)

