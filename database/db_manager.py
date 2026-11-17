import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from config import DB_PATH
from core.status_manager import ProcessingStatus, VerificationStatus, ReportStatus
from utils.logger import get_logger

logger = get_logger("DBManager")

@contextmanager
def get_connection(db_path: Optional[Path] = None):
    path = db_path or DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db(db_path: Optional[Path] = None):
    """Initializes SQLite database schema."""
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        
        # Jobs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                input_filename TEXT NOT NULL,
                input_file_path TEXT NOT NULL,
                output_file_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                total_records INTEGER DEFAULT 0,
                processed_records INTEGER DEFAULT 0,
                verified_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'Pending'
            )
        """)

        # Job records table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS job_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                row_index INTEGER NOT NULL,
                gsm_id TEXT,
                phone_number TEXT,
                dl_number TEXT,
                dob TEXT,
                dl_number_masked TEXT,
                dob_masked TEXT,
                processing_status TEXT NOT NULL DEFAULT 'Pending',
                verification_status TEXT NOT NULL DEFAULT 'Pending',
                verification_date TEXT,
                verification_remarks TEXT,
                report_filename TEXT,
                report_path TEXT,
                report_download_status TEXT NOT NULL DEFAULT 'Pending',
                error_message TEXT,
                retry_count INTEGER DEFAULT 0,
                start_timestamp TEXT,
                completion_timestamp TEXT,
                FOREIGN KEY (job_id) REFERENCES jobs(job_id)
            )
        """)
        
        # Schema migration check
        for col in ["dl_number", "dob"]:
            try:
                cursor.execute(f"ALTER TABLE job_records ADD COLUMN {col} TEXT")
            except Exception:
                pass

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_records_job ON job_records(job_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_records_status ON job_records(job_id, processing_status)")
        conn.commit()
        logger.info("Database initialized successfully.")

def create_job(job_id: str, input_filename: str, input_file_path: str, output_file_path: str, total_records: int) -> str:
    now = datetime.now().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO jobs (job_id, input_filename, input_file_path, output_file_path, created_at, updated_at, total_records, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (job_id, input_filename, input_file_path, output_file_path, now, now, total_records, "Pending"))
        conn.commit()
    logger.info(f"Created job {job_id} with {total_records} records.")
    return job_id

def insert_job_records(job_id: str, records: List[Dict[str, Any]]):
    with get_connection() as conn:
        cursor = conn.cursor()
        for r in records:
            cursor.execute("""
                INSERT INTO job_records (
                    job_id, row_index, gsm_id, phone_number, dl_number, dob, dl_number_masked, dob_masked,
                    processing_status, verification_status, report_download_status, verification_remarks
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job_id,
                r.get("row_index", 0),
                r.get("gsm_id", ""),
                r.get("phone_number", ""),
                r.get("dl_number", ""),
                r.get("dob", ""),
                r.get("dl_number_masked", ""),
                r.get("dob_masked", ""),
                r.get("processing_status", ProcessingStatus.PENDING.value),
                r.get("verification_status", VerificationStatus.PENDING.value),
                r.get("report_download_status", ReportStatus.PENDING.value),
                r.get("verification_remarks", "")
            ))
        conn.commit()
    logger.info(f"Inserted {len(records)} records for job {job_id}.")

def update_job_status(job_id: str, status: str):
    now = datetime.now().isoformat()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE jobs SET status = ?, updated_at = ? WHERE job_id = ?
        """, (status, now, job_id))
        conn.commit()

def update_record_status(
    record_id: int,
    processing_status: Optional[str] = None,
    verification_status: Optional[str] = None,
    verification_date: Optional[str] = None,
    verification_remarks: Optional[str] = None,
    report_filename: Optional[str] = None,
    report_path: Optional[str] = None,
    report_download_status: Optional[str] = None,
    error_message: Optional[str] = None,
    start_timestamp: Optional[str] = None,
    completion_timestamp: Optional[str] = None,
    increment_retry: bool = False
):
    updates = []
    params = []

    if processing_status is not None:
        updates.append("processing_status = ?")
        params.append(processing_status)
    if verification_status is not None:
        updates.append("verification_status = ?")
        params.append(verification_status)
    if verification_date is not None:
        updates.append("verification_date = ?")
        params.append(verification_date)
    if verification_remarks is not None:
        updates.append("verification_remarks = ?")
        params.append(verification_remarks)
    if report_filename is not None:
        updates.append("report_filename = ?")
        params.append(report_filename)
    if report_path is not None:
        updates.append("report_path = ?")
        params.append(report_path)
    if report_download_status is not None:
        updates.append("report_download_status = ?")
        params.append(report_download_status)
    if error_message is not None:
        updates.append("error_message = ?")
        params.append(error_message)
    if start_timestamp is not None:
        updates.append("start_timestamp = ?")
        params.append(start_timestamp)
    if completion_timestamp is not None:
        updates.append("completion_timestamp = ?")
        params.append(completion_timestamp)
    if increment_retry:
        updates.append("retry_count = retry_count + 1")

    if not updates:
        return

    params.append(record_id)
    query = f"UPDATE job_records SET {', '.join(updates)} WHERE id = ?"

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()

def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_latest_job() -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 1")
        row = cursor.fetchone()
        return dict(row) if row else None

def get_job_records(job_id: str, status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        cursor = conn.cursor()
        if status_filter and status_filter != "All":
            cursor.execute("""
                SELECT * FROM job_records 
                WHERE job_id = ? AND (verification_status = ? OR processing_status = ?)
                ORDER BY row_index ASC
            """, (job_id, status_filter, status_filter))
        else:
            cursor.execute("SELECT * FROM job_records WHERE job_id = ? ORDER BY row_index ASC", (job_id,))
        return [dict(r) for r in cursor.fetchall()]

def get_pending_records(job_id: str) -> List[Dict[str, Any]]:
    """Returns records that still need processing (Pending or Processing)."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM job_records 
            WHERE job_id = ? AND processing_status IN ('Pending', 'Processing')
            ORDER BY row_index ASC
        """, (job_id,))
        return [dict(r) for r in cursor.fetchall()]

def get_failed_records(job_id: str) -> List[Dict[str, Any]]:
    """Returns records marked as Failed for retry."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM job_records 
            WHERE job_id = ? AND processing_status = 'Failed'
            ORDER BY row_index ASC
        """, (job_id,))
        return [dict(r) for r in cursor.fetchall()]

def get_job_statistics(job_id: str) -> Dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN verification_status = 'Verified' THEN 1 ELSE 0 END) as verified,
                SUM(CASE WHEN verification_status = 'Not Verified' THEN 1 ELSE 0 END) as not_verified,
                SUM(CASE WHEN verification_status = 'Invalid Details' THEN 1 ELSE 0 END) as invalid_details,
                SUM(CASE WHEN verification_status = 'Record Not Found' THEN 1 ELSE 0 END) as record_not_found,
                SUM(CASE WHEN processing_status = 'Pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN processing_status = 'Processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN processing_status = 'Completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN processing_status = 'Failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN processing_status = 'Skipped' THEN 1 ELSE 0 END) as skipped,
                SUM(CASE WHEN report_download_status = 'Downloaded' THEN 1 ELSE 0 END) as reports_downloaded
            FROM job_records
            WHERE job_id = ?
        """, (job_id,))
        row = cursor.fetchone()
        stats = dict(row) if row else {}
        for k in stats:
            if stats[k] is None:
                stats[k] = 0
        total = stats.get("total", 0)
        completed = stats.get("completed", 0) + stats.get("skipped", 0)
        stats["percentage"] = round((completed / total) * 100, 1) if total > 0 else 0.0
        return stats

# Automatically initialize database tables on import
try:
    init_db()
except Exception as e:
    logger.error(f"Error auto-initializing database: {e}")
