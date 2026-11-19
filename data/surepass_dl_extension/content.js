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

// Helper: Format DOB for input (YYYY-MM-DD for date inputs, or DD-MM-YYYY for text inputs)
function formatDobForInput(dobStr, inputType) {
  if (!dobStr) return "";
  const cleaned = dobStr.trim();
  
  // YYYY-MM-DD
  const ymd = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    if (inputType === "date") return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
    return `${ymd[3].padStart(2, "0")}-${ymd[2].padStart(2, "0")}-${ymd[1]}`;
  }

  // DD-MM-YYYY
  const dmy = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    if (inputType === "date") return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return `${dmy[1].padStart(2, "0")}-${dmy[2].padStart(2, "0")}-${dmy[3]}`;
  }

  return cleaned;
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

// Find input by associated label text
function findInputByText(searchText) {
  const norm = searchText.toLowerCase();
  const allLabels = Array.from(document.querySelectorAll("label, span, div, p")).filter(el => {
    return (el.innerText || "").toLowerCase().includes(norm) && el.children.length === 0;
  });

  for (const label of allLabels) {
    if (label.htmlFor) {
      const target = document.getElementById(label.htmlFor);
      if (target) return target;
    }
    const parentInput = label.parentElement?.querySelector("input");
    if (parentInput) return parentInput;

    const nextInput = label.nextElementSibling?.tagName === "INPUT" ? label.nextElementSibling : label.nextElementSibling?.querySelector("input");
    if (nextInput) return nextInput;
  }
  return null;
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

// React-compatible input typing
function setInputValue(input, value) {
  if (!input) return;
  input.focus();
  input.select();
  let typed = false;
  try {
    typed = document.execCommand("insertText", false, value);
  } catch (e) {}

  if (!typed || input.value !== value) {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (desc && desc.set) {
      desc.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
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

  // 1. Locate DL input
  const dlSelectors = [
    "input[placeholder*='license_number' i]",
    "input[placeholder*='ID Number' i]",
    "input[name*='id_number' i]",
    "input[id*='id_number' i]",
    "input[placeholder*='DL' i]",
    "input[name*='dl' i]",
    "input[id*='dl' i]",
    "input[placeholder*='Driving Licence' i]",
    "input[placeholder*='Driving License' i]",
    "input[placeholder*='License' i]",
    "input[placeholder*='Search' i]",
    "input[type='text']"
  ];

  const dlInput = await waitForElement(() => {
    return findElementEverywhere(dlSelectors) || 
           findInputByText("ID Number") || 
           findInputByText("DL Number") || 
           findInputByText("Driving License") ||
           findInputByText("Driving Licence");
  }, 8000);

  if (!dlInput) {
    return { 
      success: false, 
      status: "Verification Error", 
      remarks: "DL input field not found on current page. Ensure Surepass DL service page is open." 
    };
  }

  // Type DL number
  setInputValue(dlInput, cleanDl || rawDl);
  await sleep(400);

  // 2. Locate and Fill DOB input
  if (driver.dob) {
    const dobSelectors = [
      "input[placeholder*='dd-mm-yyyy' i]",
      "input[placeholder*='dob' i]",
      "input[name*='dob' i]",
      "input[id*='dob' i]",
      "input[type='date']",
      "input[placeholder*='Date of Birth' i]",
      "input[placeholder*='DD-MM-YYYY' i]"
    ];

    const dobInput = findElementEverywhere(dobSelectors) || 
                     findInputByText("dob") || 
                     findInputByText("Date of Birth");

    if (dobInput) {
      const formattedDob = formatDobForInput(driver.dob, dobInput.type);
      setInputValue(dobInput, formattedDob);
      await sleep(400);
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

    // C. Check for Live Success
    const hasClientId = bodyText.includes('"client_id"') || bodyText.includes("client_id");
    const hasLicenseNum = bodyText.includes('"license_number"') || bodyText.includes("license_number");
    const hasState = bodyText.includes('"state"') || bodyText.includes("state");
    const hasSuccessBadge = (bodyLower.includes("200") && (bodyLower.includes("success") || bodyLower.includes("ok"))) || bodyText.includes('"status_code": 200');
    const hasActiveDetails = bodyLower.includes("dl details found") || bodyLower.includes("status: active") || bodyLower.includes("verification successful") || bodyLower.includes("status: valid");
    const hasDriverDl = (cleanDl && bodyText.includes(cleanDl)) || (rawDl && bodyText.includes(rawDl));

    if (hasClientId || (hasLicenseNum && hasState) || (hasSuccessBadge && hasDriverDl) || (hasActiveDetails && hasDriverDl)) {
      finalStatus = "Verified";
      remarks = "Driver Licence Verified Successfully (Surepass Active)";
      break;
    }
  }

  if (!finalStatus) {
    finalStatus = "Verification Error";
    remarks = "Verification response timeout from Surepass portal";
  }

  // 5. If Verified, click the official Surepass "Download Report" button on the portal
  let surepassPdfTriggered = false;
  let pdfBase64 = null;

  if (finalStatus === "Verified") {
    console.log("[Surepass Assistant] Verified! Locating official Surepass Download Report button...");
    await sleep(1500);

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
      await sleep(2000);

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
