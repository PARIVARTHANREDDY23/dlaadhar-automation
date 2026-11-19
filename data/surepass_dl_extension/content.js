// content.js - Surepass DL Verification Content Automation
// Injected into console.surepass.app to execute Driving Licence verifications cleanly

console.log("[Surepass Assistant] Content script active on console.surepass.app");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Intercept client-side created PDF blobs for automatic forwarding to Verixa
let lastCapturedPdfBlob = null;
let lastOpenedReportUrl = null;

try {
  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(obj) {
    if (obj instanceof Blob && (obj.type.includes("pdf") || obj.size > 2000)) {
      lastCapturedPdfBlob = obj;
    }
    return origCreateObjectURL.apply(this, arguments);
  };
} catch (e) {}

try {
  const origWindowOpen = window.open;
  window.open = function(url) {
    if (url && (url.includes("pdf") || url.includes("report") || url.includes("download") || url.includes("surepass"))) {
      lastOpenedReportUrl = url;
    }
    return origWindowOpen.apply(this, arguments);
  };
} catch (e) {}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

// Helper: Format DOB for input (YYYY-MM-DD for date inputs, or DD MM YYYY for text inputs)
function formatDobForInput(dobStr, inputType) {
  if (!dobStr) return "";
  const cleaned = dobStr.trim();
  
  let day = "", month = "", year = "";

  // 1. Format: YYYY-MM-DD or YYYY/MM/DD
  const ymd = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    year = ymd[1];
    month = ymd[2].padStart(2, "0");
    day = ymd[3].padStart(2, "0");
  } else {
    // 2. Format: DD-MM-YYYY or DD/MM/YYYY or DD MM YYYY
    const dmy = cleaned.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})$/);
    if (dmy) {
      day = dmy[1].padStart(2, "0");
      month = dmy[2].padStart(2, "0");
      year = dmy[3];
    }
  }

  if (day && month && year) {
    if (inputType === "date") return `${year}-${month}-${day}`;
    // Surepass input takes DD MM YYYY (space separated)
    return `${day} ${month} ${year}`;
  }

  return cleaned;
}

// Extract verified fields from the Surepass Response Card
function extractSurepassCardDetails() {
  const details = {};
  const allEl = Array.from(document.querySelectorAll("div, span, p, td, b, th, strong"));
  const fields = [
    "Client ID", "License Number", "State", "Name", 
    "Permanent Address", "Permanent Zip", "Temporary Address", 
    "Temporary Zip", "City Name", "Citizenship",
    "Father Name", "Father/Husband Name", "DOB", "Date of Birth",
    "Gender", "Blood Group", "Badge Number", "Class of Vehicle",
    "COV", "Issue Date", "Valid Till", "Non Transport", "Transport"
  ];
  
  fields.forEach(f => {
    const el = allEl.find(e => e.children.length === 0 && (e.innerText || "").trim().toLowerCase() === f.toLowerCase());
    if (el) {
      const parent = el.parentElement;
      const sibling = el.nextElementSibling || parent?.querySelector("div:last-child, p:last-child, span:last-child");
      if (sibling && sibling !== el && sibling.innerText.trim()) {
        details[f] = sibling.innerText.trim();
      } else if (parent && parent.innerText) {
        // Fallback: extract line following label
        const lines = parent.innerText.split("\n").map(s => s.trim()).filter(Boolean);
        const idx = lines.findIndex(l => l.toLowerCase() === f.toLowerCase());
        if (idx !== -1 && lines[idx + 1]) {
          details[f] = lines[idx + 1];
        }
      }
    }
  });

  // Also check full Response block text if any field is missing
  const responseBlock = Array.from(document.querySelectorAll("div, section")).find(d => 
    (d.innerText || "").includes("Response") && (d.innerText || "").includes("License Number")
  );
  if (responseBlock) {
    const blockText = responseBlock.innerText;
    fields.forEach(f => {
      if (!details[f]) {
        const re = new RegExp(f + "\\s*\\n\\s*([^\\n]+)", "i");
        const m = blockText.match(re);
        if (m && m[1]) details[f] = m[1].trim();
      }
    });
  }

  return details;
}

// Find element across document, iframes, and shadow roots
function findElementEverywhere(selectors) {
  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null) return el;
    } catch (e) {}
  }
  // Search inside iframes
  try {
    const iframes = document.querySelectorAll("iframe");
    for (const f of iframes) {
      try {
        const doc = f.contentDocument || f.contentWindow?.document;
        if (!doc) continue;
        for (const s of selectors) {
          const el = doc.querySelector(s);
          if (el) return el;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

// Find input by associated label text (with optional exclusion to prevent re-matching dlInput)
function findInputByText(searchText, excludeEl = null) {
  const norm = searchText.toLowerCase().trim();
  const allLabels = Array.from(document.querySelectorAll("label, span, div, p")).filter(el => {
    return (el.innerText || "").toLowerCase().trim() === norm && el.children.length === 0;
  });

  for (const label of allLabels) {
    if (label.htmlFor) {
      const target = document.getElementById(label.htmlFor);
      if (target && target !== excludeEl) return target;
    }

    // Direct input inside label
    const inside = label.querySelector("input");
    if (inside && inside !== excludeEl) return inside;

    // Next sibling input or input inside sibling wrapper
    let sib = label.nextElementSibling;
    while (sib) {
      if (sib.tagName === "INPUT" && sib !== excludeEl) return sib;
      const sibInp = sib.querySelector("input");
      if (sibInp && sibInp !== excludeEl) return sibInp;
      sib = sib.nextElementSibling;
    }

    // Parent wrapper input (only if parent does not contain the excluded input)
    const parent = label.parentElement;
    if (parent && (!excludeEl || !parent.contains(excludeEl))) {
      const parentInput = parent.querySelector("input");
      if (parentInput && parentInput !== excludeEl) return parentInput;
    }
  }
  return null;
}

// Strictly isolate and identify ID Number (DL) vs DOB inputs on Surepass
function getSurepassInputs() {
  const formBox = Array.from(document.querySelectorAll("div, form, section")).find(el => {
    const t = (el.innerText || "");
    return t.includes("Request Parameters") && (t.includes("ID Number") || t.includes("License Number")) && t.includes("DOB");
  }) || document.body;

  const inputs = Array.from(formBox.querySelectorAll("input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit'])"))
                      .filter(i => i.offsetParent !== null);

  let dlInput = null;
  let dobInput = null;

  // Case 1: Standard Surepass Request Parameters form with 2 inputs (ID Number & DOB)
  if (inputs.length === 2) {
    dlInput = inputs[0];
    dobInput = inputs[1];
    return { dlInput, dobInput };
  }

  // Case 2: Multi-input fallback
  dlInput = inputs.find(i => /id_number|license_number|license|dl/i.test((i.name || "") + (i.id || "") + (i.placeholder || ""))) ||
            findInputByText("ID Number") ||
            findInputByText("DL Number") ||
            findInputByText("Driving License") ||
            inputs[0];

  dobInput = inputs.find(i => i !== dlInput && (/dob|birth|date/i.test((i.name || "") + (i.id || "") + (i.placeholder || "")) || i.type === "date")) ||
             findInputByText("DOB", dlInput) ||
             findInputByText("Date of Birth", dlInput) ||
             inputs.find(i => i !== dlInput);

  return { dlInput, dobInput };
}

// Poll for element to appear
async function waitForElement(finderFn, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = finderFn();
    if (el) return el;
    await sleep(200);
  }
  return null;
}

// React-compatible input typing (clears input first so text is never appended)
function setInputValue(input, value) {
  if (!input) return;
  input.focus();

  // 1. Force value to empty string first to avoid appending to existing text
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value") ||
               Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (desc && desc.set) {
    desc.set.call(input, "");
  } else {
    input.value = "";
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));

  // 2. Set clean value
  let typed = false;
  try {
    input.select();
    typed = document.execCommand("insertText", false, value);
  } catch (e) {}

  if (!typed || input.value !== value) {
    if (desc && desc.set) {
      desc.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

// Execute Verification on console.surepass.app
async function verifyDriverOnPage(driver) {
  console.log(`[Surepass Assistant] Automating Driver: ${driver.gsm_id} | DL: ${driver.dl_number}`);

  // Check login state first
  const isLoginPage = /login|signin/i.test(location.href) || !!document.querySelector("input[type='password']");
  if (isLoginPage) {
    return {
      success: false,
      status: "Login Required",
      remarks: "Surepass is not logged in. Please sign in to console.surepass.app."
    };
  }

  const cleanDl = String(driver.dl_number || "").replace(/[\s-]/g, "").trim().toUpperCase();
  const rawDl = String(driver.dl_number || "").trim().toUpperCase();

  // 1. Locate DL and DOB inputs with strict isolation
  const inputPair = await waitForElement(() => {
    const res = getSurepassInputs();
    return res.dlInput ? res : null;
  }, 8000) || {};

  const dlInput = inputPair.dlInput;
  const dobInput = inputPair.dobInput;

  if (!dlInput) {
    return { 
      success: false, 
      status: "Verification Error", 
      remarks: "DL input field not found on current page. Ensure Surepass DL service page is open." 
    };
  }

  // Type DL number strictly into dlInput
  console.log(`[Surepass Assistant] Entering DL Number strictly into ID Number field: "${cleanDl || rawDl}"`);
  setInputValue(dlInput, cleanDl || rawDl);
  await sleep(400);

  // 2. Locate and Fill DOB strictly into dobInput (guaranteed distinct from dlInput)
  if (driver.dob && dobInput && dobInput !== dlInput) {
    const formattedDob = formatDobForInput(driver.dob, dobInput.type);
    console.log(`[Surepass Assistant] Entering DOB strictly into DOB field: "${formattedDob}"`);
    setInputValue(dobInput, formattedDob);
    await sleep(300);

    // If the field rejected spaces or cleared, fallback with hyphens
    if (!dobInput.value || dobInput.value.length < 6) {
      const hyphenDob = formattedDob.replace(/\s+/g, "-");
      setInputValue(dobInput, hyphenDob);
      await sleep(200);
    }
  }

  // 3. Locate and click Submit / Verify button
  const submitBtn = await waitForElement(() => {
    const candidates = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']")).filter(btn => {
      const txt = (btn.innerText || btn.value || "").toLowerCase().trim();
      return (txt === "submit" || txt.includes("submit") || txt.includes("verify") || txt.includes("search")) && btn.offsetParent !== null;
    });
    return candidates[0] || document.querySelector("button[type='submit']");
  }, 5000);

  if (!submitBtn) {
    return { 
      success: false, 
      status: "Verification Error", 
      remarks: "Submit / Verify button not found on Surepass page." 
    };
  }

  if (submitBtn.disabled || submitBtn.getAttribute("aria-disabled") === "true") {
    dlInput.dispatchEvent(new Event("change", { bubbles: true }));
    dlInput.dispatchEvent(new Event("blur", { bubbles: true }));
    await sleep(300);
  }

  submitBtn.click();
  try { submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch (e) {}
  console.log("[Surepass Assistant] Submit clicked. Awaiting verification response...");

  // 4. Await verification result (poll for up to 15s)
  const startTime = Date.now();
  let finalStatus = null;
  let remarks = "";

  await sleep(800);

  while (Date.now() - startTime < 15000) {
    await sleep(400);

    const isSpinning = document.querySelector(".spinner, .loading, [aria-busy='true'], svg.animate-spin");
    if (isSpinning && isSpinning.offsetParent !== null) {
      continue;
    }

    const bodyText = document.body.innerText;
    const bodyLower = bodyText.toLowerCase();

    // A. Check for Credits / Auth
    if (bodyLower.includes("insufficient credit") || 
        bodyLower.includes("insufficient balance") || 
        bodyLower.includes("402 payment required") || 
        bodyLower.includes("401 unauthorized")) {
      finalStatus = "Verification Error";
      remarks = "Insufficient Surepass credits or Unauthorized session";
      break;
    }

    // B. Check for Not Verified / Invalid DL
    if (bodyLower.includes("record not found") || 
        bodyLower.includes("no record found") || 
        bodyLower.includes("invalid id number") || 
        bodyLower.includes("invalid dl") || 
        bodyLower.includes("invalid driving license") || 
        bodyText.includes('"status_code": 404') || 
        bodyText.includes('"status_code": 422') || 
        bodyText.includes('"status_code": 400') ||
        (bodyText.includes('"success": false') && !bodyText.includes('"success": true'))) {
      finalStatus = "Not Verified";
      remarks = "Record Not Found or Invalid DL Number";
      break;
    }

    // C. Check for Live Success (Response Card or 200 Success status)
    const hasResponseCard = (bodyLower.includes("response") || bodyLower.includes("data")) && 
                            (bodyLower.includes("client id") || bodyLower.includes("license number") || bodyLower.includes("permanent address"));
    const hasSuccessBadge = (bodyLower.includes("200") && (bodyLower.includes("success") || bodyLower.includes("ok"))) || bodyText.includes('"status_code": 200');
    const hasActiveDetails = bodyLower.includes("dl details found") || bodyLower.includes("status: active") || bodyLower.includes("verification successful") || bodyLower.includes("status: valid");
    const hasDriverDl = (cleanDl && (bodyText.includes(cleanDl) || bodyLower.includes(cleanDl.toLowerCase()))) || 
                        (rawDl && (bodyText.includes(rawDl) || bodyLower.includes(rawDl.toLowerCase())));
    const hasDownloadBtn = Array.from(document.querySelectorAll("button, a, [role='button']")).some(b => 
      /download/i.test(b.innerText || "") && b.offsetParent !== null
    );

    if ((hasResponseCard && (hasDriverDl || hasDownloadBtn)) || (hasSuccessBadge && hasDriverDl) || (hasActiveDetails && hasDriverDl)) {
      finalStatus = "Verified";
      remarks = "Driver Licence Verified Successfully (Surepass Active)";
      break;
    }
  }

  if (!finalStatus) {
    finalStatus = "Verification Error";
    remarks = "Verification response timeout from Surepass portal";
  }

  // 5. If Verified, extract card details and locate download trigger
  let surepassPdfTriggered = false;
  let pdfBase64 = null;
  let cardDetails = null;

  if (finalStatus === "Verified") {
    console.log("[Surepass Assistant] Verified! Extracting Response card details and locating Download button...");
    await sleep(1200);

    // Extract all structured fields from the verified card (Image 1)
    cardDetails = extractSurepassCardDetails();
    console.log("[Surepass Assistant] Extracted Card Details:", cardDetails);

    // Suppress blocking native window.print modal (Image 2) so automation continues smoothly
    try {
      window.print = function() {
        console.log("[Surepass Assistant] window.print cleanly intercepted!");
      };
    } catch (e) {}

    const dlBtn = await waitForElement(() => {
      const allButtons = Array.from(document.querySelectorAll("button, a, [role='button']")).filter(btn => {
        const txt = (btn.innerText || btn.value || "").toLowerCase().trim();
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
        const title = (btn.getAttribute("title") || "").toLowerCase();
        const hasDownload = txt.includes("download") || txt.includes("pdf") || txt.includes("report") || aria.includes("download") || aria.includes("pdf") || title.includes("download");
        const notExcel = !txt.includes("excel") && !txt.includes("csv");
        return hasDownload && notExcel && btn.offsetParent !== null;
      });
      return allButtons[0] || null;
    }, 6000);

    if (dlBtn) {
      // Check if button is an anchor with direct download link
      const href = dlBtn.getAttribute("href") || dlBtn.href;
      if (href && (href.startsWith("http") || href.startsWith("blob:") || href.startsWith("data:"))) {
        try {
          const res = await fetch(href, { credentials: "include" });
          const b = await res.blob();
          pdfBase64 = await blobToBase64(b);
          console.log(`[Surepass Assistant] Directly fetched report PDF (${b.size} bytes)`);
        } catch (e) {
          console.warn("[Surepass Assistant] Direct fetch of report notice:", e.message);
        }
      }

      console.log(`[Surepass Assistant] Clicking official Surepass download button: "${dlBtn.innerText || 'Download'}"`);
      dlBtn.click();
      surepassPdfTriggered = true;
      await sleep(1500);

      // Check if client-side blob hook caught the report
      if (!pdfBase64 && lastCapturedPdfBlob) {
        try {
          pdfBase64 = await blobToBase64(lastCapturedPdfBlob);
          console.log(`[Surepass Assistant] Captured in-memory blob report (${lastCapturedPdfBlob.size} bytes)`);
        } catch (e) {}
      }

      // Check if window.open was triggered for the report
      if (!pdfBase64 && lastOpenedReportUrl) {
        try {
          const res = await fetch(lastOpenedReportUrl, { credentials: "include" });
          const b = await res.blob();
          pdfBase64 = await blobToBase64(b);
          console.log(`[Surepass Assistant] Fetched report from window.open URL (${b.size} bytes)`);
        } catch (e) {}
      }

      // If we have base64, also store in background script for safety
      if (pdfBase64) {
        chrome.runtime.sendMessage({
          action: "STORE_SUREPASS_PDF",
          pdfBase64: pdfBase64,
          filename: `${driver.gsm_id}_${driver.phone_number || "DL"}_DL_Report.pdf`
        }).catch(() => {});
      }
    } else {
      console.warn("[Surepass Assistant] Official Surepass download button not found on result card.");
    }
  }

  return {
    success: finalStatus === "Verified" || finalStatus === "Not Verified",
    status: finalStatus,
    remarks: remarks,
    pdf_downloaded: surepassPdfTriggered,
    pdf_base64: pdfBase64,
    card_details: cardDetails,
    report_filename: `${driver.gsm_id}_${driver.phone_number || "DL"}_DL_Report.pdf`
  };
}

// Chrome Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "VERIFY_DRIVER") {
    verifyDriverOnPage(request.driver)
      .then((result) => sendResponse(result))
      .catch((err) => {
        sendResponse({
          success: false,
          status: "Verification Error",
          remarks: `Content script exception: ${err.message}`
        });
      });
    return true; // Keep message channel open for async response
  }
});
