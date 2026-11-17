// content.js - Comprehensive Automation Engine for Surepass DL Verification
console.log("[Surepass DL Assistant] Content engine active.");

// Helper: Sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Find element across document, iframes, and shadow roots
function findElementEverywhere(selectors) {
  // 1. Search main document
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    } catch (e) {}
  }

  // 2. Search inside any iframes
  try {
    const iframes = document.querySelectorAll("iframe");
    for (const f of iframes) {
      try {
        const doc = f.contentDocument || f.contentWindow?.document;
        if (doc) {
          for (const sel of selectors) {
            const el = doc.querySelector(sel);
            if (el && el.offsetParent !== null) return el;
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  return null;
}

// Helper: Find input near label or text
function findInputByText(text) {
  const all = Array.from(document.querySelectorAll("label, span, div, p, h1, h2, h3, h4"));
  for (const el of all) {
    const txt = (el.innerText || "").trim().toLowerCase();
    if (txt === text.toLowerCase() || txt.includes(text.toLowerCase())) {
      const parent = el.closest("div, form, section, .form-group") || el.parentElement;
      if (parent) {
        const inp = parent.querySelector("input");
        if (inp && inp.offsetParent !== null) return inp;
      }
    }
  }
  return null;
}

// Wait up to timeoutMs for an element to appear in DOM (handles React client-side delays)
async function waitForElement(selectorFn, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = selectorFn();
    if (el) return el;
    await sleep(300);
  }
  return null;
}

// Robust input filler for React, Angular, and Vue controlled inputs
function setInputValue(input, value) {
  if (!input) return;
  input.focus();
  try { input.select(); } catch (e) {}

  // React 16+ value tracker hook
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }
  try { input.setAttribute("value", value); } catch (e) {}

  // Dispatch full synthetic event chain
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }));
  input.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, composed: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
}

// Robust DOB formatter respecting HTML5 input types
function formatDobForInput(dobStr, inputType) {
  if (!dobStr) return "";
  const raw = String(dobStr).trim().split(" ")[0].replace(/[\/.]/g, "-");
  let yyyy = "", mm = "", dd = "";

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    [yyyy, mm, dd] = raw.split("-");
  } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(raw)) {
    [dd, mm, yyyy] = raw.split("-");
  } else {
    return raw;
  }

  mm = mm.padStart(2, "0");
  dd = dd.padStart(2, "0");

  // HTML5 date picker strictly expects YYYY-MM-DD
  if (inputType === "date") {
    return `${yyyy}-${mm}-${dd}`;
  }
  // Standard text input expects DD-MM-YYYY for Indian portals
  return `${dd}-${mm}-${yyyy}`;
}

// Main Driver Verification Executor
async function verifyDriverOnPage(driver) {
  console.log(`[Surepass Assistant] Automating Driver: ${driver.gsm_id} | DL: ${driver.dl_number}`);

  // Format clean DL (remove excessive internal spaces)
  const cleanDl = String(driver.dl_number || "").replace(/\s+/g, "").trim().toUpperCase();
  const rawDl = String(driver.dl_number || "").trim().toUpperCase();

  // 1. Locate DL input (with 8-second polling for dynamic React rendering)
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
           findInputByText("Driving License");
  }, 8000);

  if (!dlInput) {
    return { 
      success: false, 
      status: "Verification Error", 
      remarks: "DL input field not found on current page. Ensure Surepass DL service page is open." 
    };
  }

  // Type Clean DL first (e.g. DL1020180006014)
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
  }, 4000);

  if (!submitBtn) {
    return { 
      success: false, 
      status: "Verification Error", 
      remarks: "Submit / Verify button not found on Surepass page." 
    };
  }

  // Wake up disabled button if React validation was waiting for an event
  if (submitBtn.disabled || submitBtn.getAttribute("aria-disabled") === "true") {
    dlInput.dispatchEvent(new Event("change", { bubbles: true }));
    dlInput.dispatchEvent(new Event("blur", { bubbles: true }));
    await sleep(300);
  }

  // Snapshot before clicking to detect fresh response
  const preSubmitSnippet = document.body.innerText.substring(0, 1000);

  // Click Submit
  submitBtn.click();
  try { submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch (e) {}
  console.log("[Surepass Assistant] Submit clicked. Awaiting portal response...");

  // 4. Await verification result (up to 35 seconds)
  const startTime = Date.now();
  let finalStatus = "Verification Error";
  let remarks = "Timeout waiting for Surepass portal response";

  // Initial wait for network request
  await sleep(1500);

  while (Date.now() - startTime < 35000) {
    await sleep(800);

    // If loading spinner is actively visible, continue waiting
    const isSpinning = document.querySelector(".spinner, .loading, [aria-busy='true'], svg.animate-spin");
    if (isSpinning && isSpinning.offsetParent !== null) {
      continue;
    }

    const bodyText = document.body.innerText;

    // A. Check for Live Success
    // 1. Matched driver's own DL in page response (100% positive live match!)
    const matchedOwnDl = (cleanDl && bodyText.includes(cleanDl)) || (rawDl && bodyText.includes(rawDl));
    if (matchedOwnDl && (bodyText.includes('"status": "VALID"') || bodyText.includes('"status": "ACTIVE"') || bodyText.includes("Verified") || bodyText.includes("State") || bodyText.includes("holder_name") || bodyText.includes("date_of_issue"))) {
      finalStatus = "Verified";
      remarks = "Driver Licence Verified Successfully";
      break;
    }

    // 2. Check for 200Success in developer response viewer
    if (bodyText.includes("200Success") || bodyText.includes('"status_code": 200')) {
      finalStatus = "Verified";
      remarks = "Verified (HTTP 200 Success)";
      break;
    }

    // 3. Check for Visual Verification Card (UI Mode)
    if (bodyText.includes("DL Details Found") || bodyText.includes("Status: Active") || bodyText.includes("Verification Successful")) {
      finalStatus = "Verified";
      remarks = "Driver Licence Active & Verified";
      break;
    }

    // B. Check for Not Verified / Invalid Details
    if (bodyText.includes("404") || 
        bodyText.includes("Record Not Found") || 
        bodyText.includes("No record found") || 
        bodyText.includes("Invalid ID Number") || 
        bodyText.includes("Invalid DL") || 
        bodyText.includes("Invalid driving license") || 
        bodyText.includes("422")) {
      finalStatus = "Not Verified";
      remarks = "Record Not Found or Invalid DL Number";
      break;
    }

    // C. Check for Portal Credits / Authorization Issues
    if (bodyText.includes("Insufficient credits") || 
        bodyText.includes("Insufficient balance") || 
        bodyText.includes("402 Payment Required") || 
        bodyText.includes("401 Unauthorized")) {
      finalStatus = "Verification Error";
      remarks = "Insufficient Surepass credits or Unauthorized session";
      break;
    }
  }

  // 5. Attempt PDF Download if available
  let reportFilename = `${driver.gsm_id}_${driver.phone_number}_DL_Report.pdf`;
  try {
    const downloadBtns = Array.from(document.querySelectorAll("button, a")).filter(el => {
      const txt = (el.innerText || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      return (txt.includes("download") || txt.includes("pdf") || aria.includes("download")) && el.offsetParent !== null;
    });
    if (downloadBtns.length > 0) {
      downloadBtns[0].click();
      await sleep(1000);
    }
  } catch (e) {
    console.warn("[Surepass Assistant] PDF download step skipped:", e);
  }

  return {
    success: true,
    status: finalStatus,
    remarks: remarks,
    report_filename: reportFilename
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
