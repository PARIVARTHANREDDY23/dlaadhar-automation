// content.js - Injected directly into console.surepass.app pages

console.log("[Surepass DL Assistant] Content script injected and active.");

// Helper: Sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Find element matching array of selectors
function findElement(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    } catch (e) {}
  }
  return null;
}

// Helper: Simulate genuine user typing (triggers React / Angular / Vue input events)
function setInputValue(input, value) {
  input.focus();
  try { input.select(); } catch (e) {}
  
  // React 16+ setter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
}

// Format date to DD-MM-YYYY or YYYY-MM-DD
function formatDate(dobStr) {
  if (!dobStr) return "";
  const cleaned = String(dobStr).trim().split(" ")[0];
  // If YYYY-MM-DD -> return DD-MM-YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    const parts = cleaned.split("-");
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return cleaned;
}

// Helper: Find input near label or text
function findInputByText(text) {
  const all = Array.from(document.querySelectorAll("label, span, div, p, h1, h2, h3, h4"));
  for (const el of all) {
    const txt = (el.innerText || "").trim().toLowerCase();
    if (txt === text.toLowerCase() || txt.includes(text.toLowerCase())) {
      const parent = el.closest("div, form, section") || el.parentElement;
      if (parent) {
        const inp = parent.querySelector("input");
        if (inp && inp.offsetParent !== null) return inp;
      }
    }
  }
  return null;
}

// Execute Verification on the open Surepass page
async function verifyDriverOnPage(driver) {
  console.log(`[Surepass Assistant] Automating Driver: ${driver.gsm_id} | DL: ${driver.dl_number}`);

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
    "input[type='text']"
  ];
  const dlInput = findElement(dlSelectors) || findInputByText("ID Number") || findInputByText("DL Number") || findInputByText("Driving License");
  if (!dlInput) {
    return { success: false, status: "Verification Error", remarks: "DL input field not found on current page." };
  }

  setInputValue(dlInput, driver.dl_number);
  await sleep(500);

  // 2. Locate DOB input if driver has DOB
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
    const dobInput = findElement(dobSelectors) || findInputByText("dob") || findInputByText("Date of Birth");
    if (dobInput) {
      const formatted = formatDate(driver.dob);
      setInputValue(dobInput, formatted);
      await sleep(500);
    }
  }

  // 3. Locate and click Verify / Submit button
  const submitButtons = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']")).filter(btn => {
    const txt = (btn.innerText || btn.value || "").toLowerCase().trim();
    return (txt === "submit" || txt.includes("submit") || txt.includes("verify") || txt.includes("search")) && btn.offsetParent !== null;
  });

  const submitBtn = submitButtons[0] || document.querySelector("button[type='submit']");
  if (!submitBtn) {
    return { success: false, status: "Verification Error", remarks: "Verify button not found on page." };
  }

  submitBtn.click();
  console.log("[Surepass Assistant] Clicked Submit button. Awaiting outcome...");

  // 4. Wait for verification result (up to 45 seconds)
  const startTime = Date.now();
  let finalStatus = "Verification Error";
  let remarks = "Timeout waiting for Surepass portal response";

  while (Date.now() - startTime < 45000) {
    await sleep(1000);

    const bodyText = document.body.innerText;

    // Check for Verified / Success
    if (bodyText.includes("200Success") || bodyText.includes('"status_code": 200') || bodyText.includes("Verified") || bodyText.includes("DL Details Found") || bodyText.includes("Status: Active") || bodyText.includes('"license_number"')) {
      finalStatus = "Verified";
      remarks = "Driver Licence Verified Successfully";
      break;
    }

    // Check for Invalid / Not Found
    if (bodyText.includes("404") || bodyText.includes("Invalid Details") || bodyText.includes("Invalid DL") || bodyText.includes("Record Not Found") || bodyText.includes("No Record Found") || bodyText.includes("Invalid ID Number")) {
      finalStatus = "Not Verified";
      remarks = "Record Not Found or Invalid Details";
      break;
    }

    // Check for portal credit/error message
    if (bodyText.includes("Insufficient credits") || bodyText.includes("Error processing") || bodyText.includes("401 Unauthorized") || bodyText.includes("403 Forbidden")) {
      finalStatus = "Verification Error";
      remarks = "Portal error or insufficient credits";
      break;
    }
  }

  // 5. Try to click PDF Download button if available
  let reportFilename = `${driver.gsm_id}_${driver.phone_number}_DL_Report.pdf`;
  try {
    const downloadBtns = Array.from(document.querySelectorAll("button, a")).filter(el => {
      const txt = (el.innerText || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      return (txt.includes("download") || txt.includes("pdf") || aria.includes("download")) && el.offsetParent !== null;
    });
    if (downloadBtns.length > 0) {
      downloadBtns[0].click();
      console.log("[Surepass Assistant] Triggered report download.");
    }
  } catch (e) {
    console.log("[Surepass Assistant] Could not trigger download: " + e);
  }

  return {
    success: true,
    status: finalStatus,
    remarks: remarks,
    report_filename: reportFilename
  };
}

// Message Listener from Extension Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "VERIFY_DRIVER") {
    verifyDriverOnPage(request.driver).then((result) => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ success: false, status: "Verification Error", remarks: String(err) });
    });
    return true; // Keep message channel open for async response
  }
});

