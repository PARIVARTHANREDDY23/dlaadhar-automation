// aadhaar_content.js - Content Script for Surepass Aadhaar Verification (console.surepass.app)
console.log("[Surepass Aadhaar Assistant] Injected into:", location.href);

let lastCapturedAadhaarPdfBlob = null;
let lastOpenedAadhaarReportUrl = null;

// Intercept window.open
const origWindowOpen = window.open;
window.open = function(url, ...args) {
  if (url && typeof url === "string" && (url.includes("blob:") || url.includes("pdf") || url.includes("report"))) {
    lastOpenedAadhaarReportUrl = url;
    console.log("[Surepass Aadhaar Assistant] Caught window.open URL:", url);
  }
  return origWindowOpen.apply(this, [url, ...args]);
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForElement(fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const el = fn();
      if (el) return el;
    } catch (e) {}
    await sleep(300);
  }
  return null;
}

// React-compatible input typing (directly invokes prototype setter; never uses execCommand)
function setInputValue(input, value) {
  if (!input) return;

  // Unfocus any previously active element
  if (document.activeElement && document.activeElement !== input) {
    try { document.activeElement.blur(); } catch (e) {}
  }
  input.focus();

  // Use prototype setter so React/Vue synthetic events register the change cleanly
  const prototype = Object.getPrototypeOf(input);
  const desc = Object.getOwnPropertyDescriptor(prototype, "value") ||
               Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

  if (desc && desc.set) {
    desc.set.call(input, value);
  } else {
    input.value = value;
  }

  // Dispatch events directly to target element
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

// Locate Aadhaar Input on Surepass
function getSurepassAadhaarInput() {
  const allInputs = Array.from(document.querySelectorAll("input:not([type='hidden']):not([type='password'])")).filter(i => {
    const style = window.getComputedStyle(i);
    return style.display !== "none" && style.visibility !== "hidden" && i.offsetWidth > 0;
  });

  if (allInputs.length === 0) return null;

  // Search by placeholder, name, id, or associated label
  for (const inp of allInputs) {
    const ph = (inp.placeholder || "").toLowerCase();
    const name = (inp.name || "").toLowerCase();
    const id = (inp.id || "").toLowerCase();
    if (ph.includes("aadhaar") || ph.includes("aadhar") || ph.includes("uid") || 
        name.includes("aadhaar") || name.includes("aadhar") || name.includes("id_number") ||
        id.includes("aadhaar") || id.includes("aadhar") || id.includes("id_number")) {
      return inp;
    }
  }

  // Label search
  const allLabels = Array.from(document.querySelectorAll("label, span, div, p")).filter(l => {
    const t = (l.innerText || "").trim().toLowerCase();
    return /^(?:aadhaar|aadhar|id\s*number|uid|aadhaar\s*number)\b/i.test(t) && l.children.length === 0;
  });

  for (const lbl of allLabels) {
    if (lbl.htmlFor) {
      const el = document.getElementById(lbl.htmlFor);
      if (el) return el;
    }
    const inside = lbl.querySelector("input");
    if (inside) return inside;
    const parent = lbl.parentElement;
    if (parent) {
      const pinp = parent.querySelector("input");
      if (pinp) return pinp;
    }
  }

  return allInputs[0] || null;
}

// Locate OTP Input field (if OTP is requested)
function getSurepassOtpInput() {
  const allInputs = Array.from(document.querySelectorAll("input:not([type='hidden'])")).filter(i => {
    const style = window.getComputedStyle(i);
    return style.display !== "none" && style.visibility !== "hidden" && i.offsetWidth > 0;
  });

  for (const inp of allInputs) {
    const ph = (inp.placeholder || "").toLowerCase();
    const name = (inp.name || "").toLowerCase();
    const id = (inp.id || "").toLowerCase();
    if (ph.includes("otp") || name.includes("otp") || id.includes("otp") || ph.includes("code") || name.includes("code")) {
      return inp;
    }
  }

  // Check labels
  const otpLabel = Array.from(document.querySelectorAll("label, span, div")).find(l => {
    const t = (l.innerText || "").trim().toLowerCase();
    return /enter\s*otp|otp\s*verification|6-digit\s*otp/i.test(t);
  });
  if (otpLabel && otpLabel.parentElement) {
    const inp = otpLabel.parentElement.querySelector("input");
    if (inp) return inp;
  }

  return null;
}

// Extract verified attributes from the Surepass Aadhaar Response Card
function extractSurepassAadhaarCardDetails() {
  const details = {};
  const allEl = Array.from(document.querySelectorAll("div, span, p, td, b, strong, th"));
  const fields = [
    "Client ID", "Aadhaar Number", "Masked Aadhaar", "Name", "Full Name",
    "Gender", "DOB", "Date of Birth", "Age Band", "State",
    "Mobile Verified", "Phone", "Mobile", "Care Of", "Father Name",
    "District", "Sub District", "PIN", "Pin Code", "Address"
  ];

  fields.forEach(f => {
    const el = allEl.find(e => e.children.length === 0 && (e.innerText || "").trim().toLowerCase() === f.toLowerCase());
    if (el) {
      const parent = el.parentElement;
      const sibling = el.nextElementSibling || parent?.querySelector("div:last-child, p:last-child, span:last-child");
      if (sibling && sibling !== el && sibling.innerText.trim()) {
        details[f] = sibling.innerText.trim();
      } else if (parent && parent.innerText) {
        const lines = parent.innerText.split("\n").map(s => s.trim()).filter(Boolean);
        const idx = lines.findIndex(l => l.toLowerCase() === f.toLowerCase());
        if (idx !== -1 && lines[idx + 1]) {
          details[f] = lines[idx + 1];
        }
      }
    }
  });

  return details;
}

// Main Verification Execution
async function verifyAadhaarOnPage(driver) {
  console.log(`[Surepass Aadhaar Assistant] Automating Candidate: ${driver.gsm_id} | Aadhaar: ${driver.aadhaar_number}`);

  lastCapturedAadhaarPdfBlob = null;
  lastOpenedAadhaarReportUrl = null;

  // Check login state
  const isLoginPage = /login|signin/i.test(location.href) || !!document.querySelector("input[type='password']");
  if (isLoginPage) {
    return {
      success: false,
      status: "Login Required",
      remarks: "Surepass is not logged in. Please sign in to console.surepass.app."
    };
  }

  const rawAadhaar = String(driver.aadhaar_number || "").replace(/\D/g, "");
  if (!rawAadhaar || rawAadhaar.length !== 12) {
    return {
      success: false,
      status: "Invalid Details",
      remarks: `Invalid 12-digit Aadhaar number: "${driver.aadhaar_number || ''}"`
    };
  }

  // 1. Locate Aadhaar input field
  const aadhaarInput = await waitForElement(() => getSurepassAadhaarInput(), 8000);
  if (!aadhaarInput) {
    return {
      success: false,
      status: "Verification Error",
      remarks: "Aadhaar input field not found on current page. Ensure Surepass Aadhaar service is open."
    };
  }

  // Type 12-digit Aadhaar number
  console.log(`[Surepass Aadhaar Assistant] Entering Aadhaar: ${rawAadhaar.slice(0, 4)} XXXX ${rawAadhaar.slice(8)}`);
  setInputValue(aadhaarInput, rawAadhaar);
  await sleep(400);

  // 2. Locate and click Submit / Generate OTP / Verify button
  const submitBtn = await waitForElement(() => {
    const candidates = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']")).filter(btn => {
      const txt = (btn.innerText || btn.value || "").toLowerCase().trim();
      return (txt.includes("submit") || txt.includes("generate otp") || txt.includes("verify") || txt.includes("search") || txt.includes("get otp")) && btn.offsetParent !== null;
    });
    return candidates[0] || document.querySelector("button[type='submit']");
  }, 5000);

  if (!submitBtn) {
    return {
      success: false,
      status: "Verification Error",
      remarks: "Submit / Generate OTP button not found on Surepass page."
    };
  }

  submitBtn.click();
  try { submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch (e) {}
  console.log("[Surepass Aadhaar Assistant] Submit clicked. Checking for OTP request or direct verification...");

  // 3. Monitor for OTP input OR verification response (poll up to 20s)
  const startTime = Date.now();
  let finalStatus = null;
  let remarks = "";
  let otpRequired = false;

  await sleep(1000);

  while (Date.now() - startTime < 20000) {
    await sleep(500);

    const isSpinning = document.querySelector(".spinner, .loading, [aria-busy='true'], svg.animate-spin");
    if (isSpinning && isSpinning.offsetParent !== null) continue;

    const bodyText = document.body.innerText;
    const bodyLower = bodyText.toLowerCase();

    // Check if OTP input appeared
    const otpInput = getSurepassOtpInput();
    if (otpInput && !finalStatus) {
      console.log("[Surepass Aadhaar Assistant] OTP input detected on page!");
      otpRequired = true;
      return {
        success: false,
        status: "OTP_REQUIRED",
        remarks: "OTP sent to candidate's Aadhaar-linked mobile. Awaiting OTP entry...",
        otp_field_ready: true,
        aadhaar_number: rawAadhaar
      };
    }

    // Check for Credit / Auth errors
    if (bodyLower.includes("insufficient credit") || bodyLower.includes("insufficient balance") || bodyLower.includes("402 payment required")) {
      finalStatus = "Verification Error";
      remarks = "Insufficient Surepass credits";
      break;
    }

    // Check for Failure / Invalid Aadhaar
    const hasErrorAlert = Array.from(document.querySelectorAll(".toast-error, .ant-alert-error, .alert-danger, [role='alert'], .text-red-500, .text-danger, .error-message")).some(el => {
      const t = (el.innerText || "").trim().toLowerCase();
      return t.length > 0 && !t.includes("success");
    });

    if (hasErrorAlert ||
        bodyLower.includes("invalid aadhaar") || 
        bodyLower.includes("invalid aadhar") || 
        bodyLower.includes("aadhaar not found") || 
        bodyLower.includes("no record found") || 
        bodyLower.includes("verification failed") || 
        bodyLower.includes("could not verify") ||
        bodyText.includes('"status_code": 404') || 
        bodyText.includes('"status_code": 422') ||
        bodyText.includes('"status_code": 400') ||
        (bodyText.includes('"success": false') && !bodyText.includes('"success": true'))) {
      finalStatus = "Not Verified";
      remarks = "Invalid Aadhaar Number or Verification Failed";
      break;
    }

    // Check for Success response
    const last4 = rawAadhaar.slice(-4);
    const hasLast4 = bodyText.includes(last4);
    const hasResponseCard = (bodyLower.includes("response") || bodyLower.includes("data")) && 
                            (bodyLower.includes("client id") || bodyLower.includes("gender") || bodyLower.includes("state") || bodyLower.includes("age band"));
    const hasSuccessBadge = (bodyLower.includes("200") && (bodyLower.includes("success") || bodyLower.includes("ok"))) || bodyText.includes('"status_code": 200');
    const hasAadhaarVerified = bodyLower.includes("aadhaar verified") || bodyLower.includes("status: active") || bodyLower.includes("verification successful");

    if (hasLast4 && (hasResponseCard || hasSuccessBadge || hasAadhaarVerified)) {
      finalStatus = "Verified";
      remarks = "Aadhaar Verified Successfully (Surepass UIDAI)";
      break;
    }
  }

  if (!finalStatus) {
    finalStatus = "Verification Error";
    remarks = "Verification response timeout from Surepass portal";
  }

  let cardDetails = null;
  let surepassPdfTriggered = false;
  let pdfBase64 = null;

  if (finalStatus === "Verified") {
    console.log("[Surepass Aadhaar Assistant] Verified! Extracting Response card details...");
    await sleep(1000);

    cardDetails = extractSurepassAadhaarCardDetails();
    console.log("[Surepass Aadhaar Assistant] Extracted Card Details:", cardDetails);

    // Strictly validate: ensure card details are not empty
    const cardName = cardDetails["Name"] || cardDetails["Full Name"] || "";
    const cardClient = cardDetails["Client ID"] || "";
    if (!cardName && !cardClient) {
      console.warn("[Surepass Aadhaar Assistant] Strict check failed: Response card details empty. Marking unverified.");
      finalStatus = "Not Verified";
      remarks = "Incomplete Aadhaar verification response card";
      cardDetails = null;
    }
  }

  // Strict guard: if not verified, suppress download/print completely
  if (finalStatus !== "Verified") {
    console.log(`[Surepass Aadhaar Assistant] Outcome is "${finalStatus}". Suppressing download & print.`);
    return {
      success: false,
      status: finalStatus,
      remarks: remarks,
      pdf_downloaded: false,
      pdf_base64: null,
      card_details: null,
      report_filename: ""
    };
  }

  // Only verified drivers trigger download/print
  try {
    window.print = function() {
      console.log("[Surepass Aadhaar Assistant] window.print cleanly intercepted!");
    };
  } catch (e) {}

  const dlBtn = await waitForElement(() => {
    const allButtons = Array.from(document.querySelectorAll("button, a, [role='button']")).filter(btn => {
      const txt = (btn.innerText || btn.value || "").toLowerCase().trim();
      const hasDownload = txt.includes("download") || txt.includes("pdf") || txt.includes("report");
      const notExcel = !txt.includes("excel") && !txt.includes("csv");
      return hasDownload && notExcel && btn.offsetParent !== null;
    });
    return allButtons[0] || null;
  }, 4000);

  if (dlBtn) {
    const href = dlBtn.getAttribute("href") || dlBtn.href;
    if (href && (href.startsWith("http") || href.startsWith("blob:") || href.startsWith("data:"))) {
      try {
        const res = await fetch(href, { credentials: "include" });
        const b = await res.blob();
        pdfBase64 = await blobToBase64(b);
      } catch (e) {}
    }

    dlBtn.click();
    surepassPdfTriggered = true;
    await sleep(1200);

    if (!pdfBase64 && lastCapturedAadhaarPdfBlob) {
      try {
        pdfBase64 = await blobToBase64(lastCapturedAadhaarPdfBlob);
      } catch (e) {}
    }

    if (pdfBase64) {
      chrome.runtime.sendMessage({
        action: "STORE_SUREPASS_AADHAAR_PDF",
        pdfBase64: pdfBase64,
        aadhaarNumber: rawAadhaar,
        gsmId: driver.gsm_id,
        filename: `${driver.gsm_id}_${driver.phone_number || "Aadhaar"}_Aadhaar_Report.pdf`
      }).catch(() => {});
    }
  }

  return {
    success: true,
    status: "Verified",
    remarks: remarks,
    pdf_downloaded: surepassPdfTriggered,
    pdf_base64: pdfBase64,
    card_details: cardDetails,
    report_filename: `${driver.gsm_id}_${driver.phone_number || "Aadhaar"}_Aadhaar_Report.pdf`
  };
}

// Handler for submitting OTP programmatically from the extension popup
async function submitAadhaarOtp(otpCode) {
  console.log(`[Surepass Aadhaar Assistant] Submitting OTP: ${otpCode}`);
  const otpInput = getSurepassOtpInput();
  if (!otpInput) {
    return { success: false, reason: "OTP input field not found on page." };
  }

  setInputValue(otpInput, otpCode);
  await sleep(300);

  // Click Submit OTP button
  const submitOtpBtn = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']")).find(btn => {
    const txt = (btn.innerText || btn.value || "").toLowerCase().trim();
    return (txt.includes("submit") || txt.includes("verify") || txt.includes("validate") || txt.includes("proceed")) && btn.offsetParent !== null;
  });

  if (submitOtpBtn) {
    submitOtpBtn.click();
    try { submitOtpBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch (e) {}
  }

  return { success: true };
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// Chrome Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PING_SUREPASS") {
    sendResponse({ ok: true, url: location.href });
    return true;
  }
  if (request.action === "VERIFY_AADHAAR") {
    verifyAadhaarOnPage(request.driver)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, status: "Verification Error", remarks: err.message }));
    return true;
  }
  if (request.action === "SUBMIT_AADHAAR_OTP") {
    submitAadhaarOtp(request.otp)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, reason: err.message }));
    return true;
  }
});
