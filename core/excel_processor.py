import os
import shutil
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional
import pandas as pd
import openpyxl
from openpyxl.utils import get_column_letter

from config import DEFAULT_COLUMN_MAPPING, OUTPUT_COLUMNS, OUTPUT_DIR
from utils.file_manager import create_backup
from utils.logger import get_logger
from core.validators import validate_driver_record
from core.status_manager import ProcessingStatus, VerificationStatus, ReportStatus

logger = get_logger("ExcelProcessor")

def mask_string(s: str, keep_start: int = 4, keep_end: int = 2) -> str:
    """Helper to mask sensitive values for display."""
    if not s:
        return ""
    s = str(s).strip()
    if len(s) <= (keep_start + keep_end):
        return "*" * len(s)
    return s[:keep_start] + ("*" * (len(s) - keep_start - keep_end)) + s[-keep_end:]

class ExcelProcessor:
    def __init__(self, file_path: str, column_mapping: Optional[Dict[str, str]] = None):
        self.file_path = Path(file_path)
        if not self.file_path.exists():
            raise FileNotFoundError(f"Excel file not found: {self.file_path}")

        self.column_mapping = column_mapping or DEFAULT_COLUMN_MAPPING.copy()
        self.backup_path: Optional[Path] = None
        self.output_file_path: Optional[Path] = None
        self.raw_df: Optional[pd.DataFrame] = None
        self.processed_records: List[Dict[str, Any]] = []
        self.column_indices: Dict[str, int] = {}  # output column header to 1-based col index

    def load_and_inspect(self) -> Tuple[List[str], int]:
        """
        Loads the Excel file ensuring DL and Phone columns are read as strings.
        Returns (list_of_columns, row_count).
        """
        # Read with dtype=str to preserve leading zeros in DL numbers and phone numbers
        if self.file_path.suffix.lower() == ".xls":
            # read xls via pandas
            self.raw_df = pd.read_excel(self.file_path, dtype=str)
        else:
            self.raw_df = pd.read_excel(self.file_path, dtype=str, engine="openpyxl")

        cols = list(self.raw_df.columns)
        count = len(self.raw_df)
        logger.info(f"Loaded Excel '{self.file_path.name}' with {count} rows and {len(cols)} columns.")
        return cols, count

    def auto_detect_mapping(self, available_columns: List[str]) -> Dict[str, str]:
        """Auto-detects mapping for gsm_id, phone_number, dl_number, dob."""
        mapping = {}
        col_lower = {col.strip().lower(): col for col in available_columns}

        # Match GSM ID
        for candidate in ["gsm id", "gsm_id", "gsmid", "driver id", "id", "driver_id"]:
            if candidate in col_lower:
                mapping["gsm_id"] = col_lower[candidate]
                break
        if "gsm_id" not in mapping and available_columns:
            mapping["gsm_id"] = available_columns[0]

        # Match Phone Number
        for candidate in ["phone number", "phone", "phonenumber", "mobile", "mobile number", "contact", "contact number", "mobile no", "contact no", "phone no", "mobile_no", "phone_no", "ph", "ph_no"]:
            if candidate in col_lower:
                mapping["phone_number"] = col_lower[candidate]
                break

        # Match DL Number
        for candidate in ["dl number", "dl_number", "dlnumber", "driving licence", "driving license", "dl no", "licence no", "license no", "dl", "dl_no", "license", "licence", "dl_num", "driving_licence", "driving_license", "dl #"]:
            if candidate in col_lower:
                mapping["dl_number"] = col_lower[candidate]
                break

        # Match DOB
        for candidate in ["dob", "date of birth", "date_of_birth", "birth date", "driver dob", "d.o.b", "d_o_b", "birth_date", "birthdate", "driver_dob"]:
            if candidate in col_lower:
                mapping["dob"] = col_lower[candidate]
                break

        # Apply fallback defaults if match not found
        for key, default_col in DEFAULT_COLUMN_MAPPING.items():
            if key not in mapping:
                # If exact default exists in available columns
                if default_col in available_columns:
                    mapping[key] = default_col
                else:
                    mapping[key] = available_columns[0] if available_columns else default_col

        self.column_mapping = mapping
        return mapping

    def prepare_and_validate(self) -> List[Dict[str, Any]]:
        """
        Parses all rows, validates mandatory fields, formats data,
        and marks invalid records as Skipped without silently dropping them.
        """
        if self.raw_df is None:
            self.load_and_inspect()

        records = []
        gsm_col = self.column_mapping.get("gsm_id")
        phone_col = self.column_mapping.get("phone_number")
        dl_col = self.column_mapping.get("dl_number")
        dob_col = self.column_mapping.get("dob")

        for idx, row in self.raw_df.iterrows():
            excel_row_num = idx + 2  # 1-based, assuming header is row 1
            
            raw_gsm = row.get(gsm_col, "")
            raw_phone = row.get(phone_col, "")
            raw_dl = row.get(dl_col, "")
            raw_dob = row.get(dob_col, "")

            val_res = validate_driver_record({
                "gsm_id": raw_gsm,
                "phone_number": raw_phone,
                "dl_number": raw_dl,
                "dob": raw_dob
            })

            is_valid = val_res["is_valid"]
            errors = val_res["errors"]
            cleaned = val_res["cleaned"]

            dl_masked = mask_string(cleaned["dl_number"] or str(raw_dl), keep_start=4, keep_end=4)
            dob_masked = "**/**/****" if cleaned["dob"] else "Invalid"

            rec = {
                "row_index": excel_row_num,
                "gsm_id": cleaned["gsm_id"] or str(raw_gsm),
                "phone_number": cleaned["phone_number"] or str(raw_phone),
                "dl_number": cleaned["dl_number"] or str(raw_dl),
                "dl_number_masked": dl_masked,
                "dob": cleaned["dob"],
                "dob_raw": cleaned["dob_raw"],
                "dob_masked": dob_masked,
                "is_valid": is_valid,
                "validation_errors": errors,
                "processing_status": ProcessingStatus.PENDING.value if is_valid else ProcessingStatus.SKIPPED.value,
                "verification_status": VerificationStatus.PENDING.value if is_valid else VerificationStatus.INVALID_DETAILS.value,
                "verification_remarks": "; ".join(errors) if not is_valid else "",
                "report_download_status": ReportStatus.PENDING.value if is_valid else ReportStatus.NOT_AVAILABLE.value,
                "report_filename": "",
                "report_path": "",
                "verification_date": ""
            }
            records.append(rec)

        self.processed_records = records
        return records

    def setup_output_excel(self) -> Path:
        """
        Creates a backup of the original Excel and prepares the output file
        with the necessary output columns appended.
        """
        # Create backup
        self.backup_path = create_backup(self.file_path)

        # Output path
        stem = self.file_path.stem
        out_name = f"{stem}_verified.xlsx"
        self.output_file_path = OUTPUT_DIR / out_name

        # If input is .xls, load via pandas and write to openpyxl .xlsx
        if self.file_path.suffix.lower() == ".xls":
            # Convert to xlsx
            df_to_save = pd.read_excel(self.file_path, dtype=str)
            df_to_save.to_excel(self.output_file_path, index=False, engine="openpyxl")
        else:
            shutil.copy2(self.file_path, self.output_file_path)

        # Open with openpyxl to ensure all output columns are added to the header
        wb = openpyxl.load_workbook(self.output_file_path)
        ws = wb.active

        # Read existing headers
        existing_headers = [ws.cell(row=1, column=col).value for col in range(1, ws.max_column + 1)]
        existing_headers_clean = [str(h).strip() if h is not None else "" for h in existing_headers]

        next_col = len(existing_headers) + 1
        for out_col in OUTPUT_COLUMNS:
            if out_col not in existing_headers_clean:
                ws.cell(row=1, column=next_col, value=out_col)
                self.column_indices[out_col] = next_col
                next_col += 1
            else:
                self.column_indices[out_col] = existing_headers_clean.index(out_col) + 1

        # Write initial status for invalid/skipped records so output Excel is comprehensive
        field_to_col_name = {
            "verification_status": "Verification Status",
            "verification_date": "Verification Date",
            "verification_remarks": "Verification Remarks",
            "report_filename": "Report Filename",
            "report_download_status": "Report Download Status",
            "processing_status": "Processing Status"
        }
        for rec in self.processed_records:
            if not rec.get("is_valid", True):
                r_idx = rec["row_index"]
                for field, col_name in field_to_col_name.items():
                    col_idx = self.column_indices.get(col_name)
                    if col_idx and field in rec and rec[field]:
                        ws.cell(row=r_idx, column=col_idx, value=str(rec[field]))

        wb.save(self.output_file_path)
        wb.close()
        logger.info(f"Initialized output Excel file at: {self.output_file_path}")
        return self.output_file_path

    def update_row(self, row_index: int, update_data: Dict[str, Any]):
        """
        Dynamically updates a specific row in the output Excel file with thread safety.
        row_index is the 1-based Excel row number (header is row 1).
        """
        if not self.output_file_path or not self.output_file_path.exists():
            self.setup_output_excel()

        wb = openpyxl.load_workbook(self.output_file_path)
        ws = wb.active

        # Mapping from output keys to headers
        field_to_col_name = {
            "verification_status": "Verification Status",
            "verification_date": "Verification Date",
            "verification_remarks": "Verification Remarks",
            "report_filename": "Report Filename",
            "report_download_status": "Report Download Status",
            "processing_status": "Processing Status"
        }

        for field, col_name in field_to_col_name.items():
            if field in update_data:
                col_idx = self.column_indices.get(col_name)
                if col_idx:
                    val = update_data[field]
                    ws.cell(row=row_index, column=col_idx, value=str(val) if val is not None else "")

        wb.save(self.output_file_path)
        wb.close()
