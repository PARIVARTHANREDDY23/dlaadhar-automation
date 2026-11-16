import pytest
from datetime import date
from core.validators import (
    validate_gsm_id,
    validate_phone_number,
    validate_dl_number,
    validate_dob,
    validate_driver_record
)

def test_validate_gsm_id():
    # Valid GSM ID
    ok, err, val = validate_gsm_id("GSM001")
    assert ok is True
    assert val == "GSM001"

    # Missing / empty
    ok, err, val = validate_gsm_id("")
    assert ok is False
    ok, err, val = validate_gsm_id(None)
    assert ok is False

def test_validate_phone_number():
    # Valid standard 10-digit
    ok, err, val = validate_phone_number("9876543210")
    assert ok is True
    assert val == "9876543210"

    # Valid with +91 prefix
    ok, err, val = validate_phone_number("+91 9876543210")
    assert ok is True
    assert val == "9876543210"

    # Valid with leading 0
    ok, err, val = validate_phone_number("09876543210")
    assert ok is True
    assert val == "9876543210"

    # Invalid length / non-mobile
    ok, err, val = validate_phone_number("12345")
    assert ok is False
    ok, err, val = validate_phone_number("")
    assert ok is False

def test_validate_dl_number():
    # Valid Indian DL number
    ok, err, val = validate_dl_number("DL-1420110012345")
    assert ok is True
    assert "DL-1420110012345" in val

    # Preserves leading zeros
    ok, err, val = validate_dl_number("KA01 20110001234")
    assert ok is True
    assert "0001234" in val

    # Missing DL
    ok, err, val = validate_dl_number("")
    assert ok is False
    ok, err, val = validate_dl_number(None)
    assert ok is False

def test_validate_dob():
    # Valid date: DD-MM-YYYY
    ok, err, val = validate_dob("15-08-1995")
    assert ok is True
    assert isinstance(val, date)
    assert val == date(1995, 8, 15)

    # Valid date: YYYY-MM-DD
    ok, err, val = validate_dob("1992-05-20")
    assert ok is True
    assert val == date(1992, 5, 20)

    # Underage driver (<18)
    ok, err, val = validate_dob("01-01-2020")
    assert ok is False
    assert "18 years old" in err

    # Invalid date string
    ok, err, val = validate_dob("invalid-date-string")
    assert ok is False

def test_validate_driver_record():
    valid_record = {
        "gsm_id": "GSM100",
        "phone_number": "9876543210",
        "dl_number": "DL14 20110012345",
        "dob": "10-10-1990"
    }
    res = validate_driver_record(valid_record)
    assert res["is_valid"] is True
    assert len(res["errors"]) == 0
    assert res["cleaned"]["phone_number"] == "9876543210"

    # Incomplete record (missing DL and invalid DOB)
    bad_record = {
        "gsm_id": "GSM101",
        "phone_number": "9876543210",
        "dl_number": "",
        "dob": "invalid"
    }
    res = validate_driver_record(bad_record)
    assert res["is_valid"] is False
    assert len(res["errors"]) >= 2

