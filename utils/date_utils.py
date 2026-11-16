from datetime import datetime, date
import re
from typing import Optional, Union, Tuple, Any
from dateutil import parser as dateutil_parser

def parse_date(val: Any) -> Optional[date]:
    """
    Parses various date representations from Excel into a standard datetime.date.
    Returns None if parsing fails.
    """
    if val is None:
        return None
        
    # Check if already date or datetime
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val

    # If numeric (Excel serial date)
    if isinstance(val, (int, float)):
        try:
            # Excel base date is 1899-12-30 due to the 1900 leap year bug
            from datetime import timedelta
            base_date = date(1899, 12, 30)
            parsed = base_date + timedelta(days=int(val))
            # sanity check: between 1900 and 2030
            if 1900 <= parsed.year <= 2030:
                return parsed
        except Exception:
            pass

    s = str(val).strip()
    if not s or s.lower() in ["nan", "none", "null", "nat", ""]:
        return None

    # Handle common Indian formats explicitly first: DD-MM-YYYY or DD/MM/YYYY
    dmy_match = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$", s)
    if dmy_match:
        day, month, year = int(dmy_match.group(1)), int(dmy_match.group(2)), int(dmy_match.group(3))
        try:
            return date(year, month, day)
        except ValueError:
            # might have been MM-DD-YYYY if day <= 12
            try:
                return date(year, day, month)
            except ValueError:
                return None

    # Handle YYYY-MM-DD or YYYY/MM/DD
    ymd_match = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", s)
    if ymd_match:
        year, month, day = int(ymd_match.group(1)), int(ymd_match.group(2)), int(ymd_match.group(3))
        try:
            return date(year, month, day)
        except ValueError:
            return None

    # Fallback to dateutil with dayfirst=True
    try:
        dt = dateutil_parser.parse(s, dayfirst=True)
        return dt.date()
    except Exception:
        return None

def format_date_for_portal(d: Optional[date], format_str: str = "DD-MM-YYYY") -> str:
    """
    Formats a datetime.date into the string format expected by the portal.
    Supported format_str: 'DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'YYYY/MM/DD'
    """
    if not d:
        return ""
        
    day_str = f"{d.day:02d}"
    month_str = f"{d.month:02d}"
    year_str = f"{d.year:04d}"

    if format_str.upper() in ["DD-MM-YYYY", "DD-MM-YY"]:
        return f"{day_str}-{month_str}-{year_str}"
    elif format_str.upper() in ["DD/MM/YYYY", "DD/MM/YY"]:
        return f"{day_str}/{month_str}/{year_str}"
    elif format_str.upper() in ["YYYY-MM-DD"]:
        return f"{year_str}-{month_str}-{day_str}"
    elif format_str.upper() in ["YYYY/MM/DD"]:
        return f"{year_str}/{month_str}/{day_str}"
    else:
        return f"{day_str}-{month_str}-{year_str}"
