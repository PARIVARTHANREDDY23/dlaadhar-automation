import re
from datetime import date, datetime
from typing import Tuple, List, Dict, Any, Optional
from utils.date_utils import parse_date

# Indian phone number: 10 digits, optionally prefixed with +91 or 0
PHONE_PATTERN = re.compile(r'^(?:\+91|91|0)?([6-9]\d{9})$')

# Indian Driving Licence: typically 2-letter State code followed by RTO code, year, and serial
# Standard: SS-RRYYYYNNNNNNN (15-16 chars total), e.g. DL-1420110012345 or KA01 20110001234
# Legacy formats may also exist, so we validate presence and sanity length (9 to 20 alphanumeric chars)
DL_RELAXED_PATTERN = re.compile(r'^[A-Z0-9][A-Z0-9\-\/\s]{6,22}$', re.IGNORECASE)

def validate_gsm_id(val: Any) -> Tuple[bool, str, str]:
    """
    Validates GSM ID.
    Returns: (is_valid, error_msg, cleaned_value)
    """
    if val is None:
        return False, "GSM ID is missing", ""
    s = str(val).strip()
    if not s or s.lower() in ["nan", "none", "null", ""]:
        return False, "GSM ID is empty", ""
    return True, "", s

def validate_phone_number(val: Any) -> Tuple[bool, str, str]:
    """
    Validates Phone Number.
    Returns: (is_valid, error_msg, cleaned_value)
    """
    if val is None:
        return False, "Phone number is missing", ""
    
    # If read as float/scientific notation, format cleanly
    if isinstance(val, (int, float)):
        val_str = str(int(val))
    else:
        val_str = str(val).strip()

    if not val_str or val_str.lower() in ["nan", "none", "null", ""]:
        return False, "Phone number is empty", ""

    # Clean non-digits
    digits_only = re.sub(r'\D', '', val_str)
    match = PHONE_PATTERN.match(digits_only)
    if not match:
        return False, f"Invalid 10-digit phone number format: {val_str}", digits_only

    clean_phone = match.group(1)
    return True, "", clean_phone

def validate_dl_number(val: Any) -> Tuple[bool, str, str]:
    """
    Validates DL Number, preserving leading zeros and characters.
    Returns: (is_valid, error_msg, cleaned_value)
    """
    if val is None:
        return False, "DL number is missing", ""
        
    s = str(val).strip()
    if not s or s.lower() in ["nan", "none", "null", ""]:
        return False, "DL number is empty", ""

    # Strip excessive internal spaces or normalize
    cleaned = re.sub(r'\s+', ' ', s).upper()

    if len(cleaned) < 8 or len(cleaned) > 22:
        return False, f"DL number length invalid ({len(cleaned)} chars)", cleaned

    if not DL_RELAXED_PATTERN.match(cleaned):
        return False, f"Invalid DL format structure: {cleaned}", cleaned

    return True, "", cleaned

def validate_dob(val: Any) -> Tuple[bool, str, Optional[date]]:
    """
    Validates Date of Birth.
    Checks parsing and realistic age (18 to 99 years).
    Returns: (is_valid, error_msg, parsed_date)
    """
    if val is None:
        return False, "DOB is missing", None

    parsed_d = parse_date(val)
    if not parsed_d:
        return False, f"Unable to parse date: {val}", None

    today = date.today()
    # Age check
    age = today.year - parsed_d.year - ((today.month, today.day) < (parsed_d.month, parsed_d.day))
    
    if parsed_d > today:
        return False, f"DOB cannot be in the future ({parsed_d})", None
    if age < 18:
        return False, f"Driver must be at least 18 years old (Age: {age})", parsed_d
    if age > 100:
        return False, f"DOB indicates improbable age (>100 years, Age: {age})", parsed_d

    return True, "", parsed_d

def validate_driver_record(row_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validates an entire driver record row.
    Returns a dictionary containing validation outcome, cleaned fields, and errors.
    """
    errors: List[str] = []
    
    gsm_ok, gsm_err, clean_gsm = validate_gsm_id(row_data.get("gsm_id"))
    if not gsm_ok:
        errors.append(gsm_err)

    phone_ok, phone_err, clean_phone = validate_phone_number(row_data.get("phone_number"))
    if not phone_ok:
        errors.append(phone_err)

    dl_ok, dl_err, clean_dl = validate_dl_number(row_data.get("dl_number"))
    if not dl_ok:
        errors.append(dl_err)

    dob_ok, dob_err, clean_dob = validate_dob(row_data.get("dob"))
    if not dob_ok:
        errors.append(dob_err)

    is_valid = (len(errors) == 0)

    return {
        "is_valid": is_valid,
        "errors": errors,
        "cleaned": {
            "gsm_id": clean_gsm,
            "phone_number": clean_phone,
            "dl_number": clean_dl,
            "dob": clean_dob,
            "dob_raw": row_data.get("dob")
        }
    }
