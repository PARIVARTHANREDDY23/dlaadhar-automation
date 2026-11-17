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

// Helper: Simulate genuine user typing (triggers Angular / React / Vue input events)
function setInputValue(input, value) {
  input.focus();
  input.value = "";
  
  // Set value and dispatch standard input/change events
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeInputValueSetter.call(input, value);

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
}

// Format date to DD-MM-YYYY or YYYY-MM-DD
function formatDate(dobStr) {
  if (!dobStr) return "";
  const cleaned = dobStr.trim();
  // If YYYY-MM-DD -> return DD-MM-YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    const parts = cleaned.split("-");
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return cleaned;
}

// Execute Verification on the open Surepass page
async function verifyDriverOnPage(driver) {
  console.log(`[Surepass Assistant] Automating Driver: ${driver.gsm_id} | DL: ${driver.dl_number}`);

  // 1. Locate DL input
  const dlSelectors = [
    "input[placeholder*='DL' i]",
    "input[name*='dl' i]",
    "input[id*='dl' i]",
    "input[placeholder*='Driving Licence' i]",
    "input[placeholder*='Driving License' i]",
    "input[placeholder*='License' i]",
    "input[type='text']"
  ];
  const dlInput = findElement(dlSelectors);
  if (!dlInput) {
    return { success: false, status: "Verification Error", remarks: "DL input field not found on current page." };
  }

  setInputValue(dlInput, driver.dl_number);
  await sleep(400);

  // 2. Locate DOB input if driver has DOB
  if (driver.dob) {
    const dobSelectors = [
      "input[placeholder*='DOB' i]",
      "input[name*='dob' i]",
      "input[id*='dob' i]",
      "input[type='date']",
      "input[placeholder*='Date of Birth' i]",
      "input[placeholder*='DD-MM-YYYY' i]"
    ];
    const dobInput = findElement(dobSelectors);
    if (dobInput) {
      const formatted = formatDate(driver.dob);
      setInputValue(dobInput, formatted);
      await sleep(400);
    }
  }

  // 3. Locate and click Verify / Submit button
  const submitButtons = Array.from(document.querySelectorAll("button")).filter(btn => {
    const txt = btn.innerText.toLowerCase();
    return (txt.includes("verify") || txt.includes("submit") || txt.includes("search")) && btn.offsetParent !== null;
  });

  const submitBtn = submitButtons[0] || document.querySelector("button[type='submit']");
  if (!submitBtn) {
    return { success: false, status: "Verification Error", remarks: "Verify button not found on page." };
  }

  submitBtn.click();
  console.log("[Surepass Assistant] Clicked Verify button. Awaiting outcome...");

  // 4. Wait for verification result (up to 45 seconds)
  const startTime = Date.now();
  let finalStatus = "Verification Error";
  let remarks = "Timeout waiting for Surepass portal response";

  while (Date.now() - startTime < 45000) {
    await sleep(1000);

    const bodyText = document.body.innerText;

    // Check for Verified / Success
    if (bodyText.includes("Verified") || bodyText.includes("DL Details Found") || bodyText.includes("Status: Active")) {
      finalStatus = "Verified";
      remarks = "Driver Licence Verified Successfully";
      break;
    }

    // Check for Invalid / Not Found
    if (bodyText.includes("Invalid Details") || bodyText.includes("Invalid DL") || bodyText.includes("Record Not Found") || bodyText.includes("No Record Found")) {
      finalStatus = "Not Verified";
      remarks = "Record Not Found or Invalid Details";
      break;
    }

    // Check for portal credit/error message
    if (bodyText.includes("Insufficient credits") || bodyText.includes("Error processing")) {
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

