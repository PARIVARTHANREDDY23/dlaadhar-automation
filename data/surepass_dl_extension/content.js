// content.js - Surepass DL Verification Content Automation
// Injected into console.surepass.app to execute Driving Licence verifications cleanly

console.log("[Surepass Assistant] Content script active on console.surepass.app");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Intercept client-side created PDF blobs for automatic forwarding to Verixa
let lastCapturedPdfBlob = null;
let lastOpenedReportUrl = null;

try {
  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    if (obj instanceof Blob && (obj.type.includes("pdf") || obj.size > 2000)) {
      lastCapturedPdfBlob = obj;
    }
    return origCreateObjectURL.apply(this, arguments);
  };
} catch (e) { }

try {
  const origWindowOpen = window.open;
  window.open = function (url) {
    if (url && (url.includes("pdf") || url.includes("report") || url.includes("download") || url.includes("surepass"))) {
      lastOpenedReportUrl = url;
    }
    return origWindowOpen.apply(this, arguments);
  };
} catch (e) { }

// Network Interceptor: Captures verified JSON response directly from Surepass backend API
let latestInterceptedApiData = null;
window.addEventListener("SUREPASS_DATA_RECEIVED", (e) => {
  if (e.detail) {
    latestInterceptedApiData = e.detail;
    console.log("[Surepass Assistant] ⚡ Intercepted Surepass API Verification Data:", latestInterceptedApiData);
  }
});

try {
  const injectScript = document.createElement("script");
  injectScript.textContent = `
    (function() {
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const res = await origFetch.apply(this, args);
        try {
          const clone = res.clone();
          clone.json().then(json => {
            if (json && json.data && (json.data.license_number || json.data.client_id || json.data.doe || json.data.doi || json.data.name)) {
              window.dispatchEvent(new CustomEvent("SUREPASS_DATA_RECEIVED", { detail: json.data }));
            }
          }).catch(() => {});
        } catch (e) {}
        return res;
      };

      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function() {
        this.addEventListener("load", function() {
          try {
            const txt = this.responseText;
            if (txt && (txt.includes("license_number") || txt.includes('"doe"') || txt.includes('"doi"'))) {
              const json = JSON.parse(txt);
              if (json && json.data) {
                window.dispatchEvent(new CustomEvent("SUREPASS_DATA_RECEIVED", { detail: json.data }));
              }
            }
          } catch (e) {}
        });
        return origSend.apply(this, arguments);
      };
    })();
  `;
  (document.head || document.documentElement).appendChild(injectScript);
  injectScript.remove();
} catch (e) {
  console.warn("[Surepass Assistant] Interceptor injection error:", e);
}

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

// Extract clean date string (YYYY-MM-DD or DD-MM-YYYY) from text with 1800 sentinel filtering
function extractDateFromText(text) {
  if (!text || typeof text !== "string") return "";
  const clean = text.trim();
  // 1. Match YYYY-MM-DD
  const m1 = clean.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m1) {
    const yr = parseInt(m1[1], 10);
    if (yr <= 1900) return ""; // Neglect 1800-01-01 sentinel date
    return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
  }
  // 2. Match DD-MM-YYYY
  const m2 = clean.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m2) {
    const yr = parseInt(m2[3], 10);
    if (yr <= 1900) return ""; // Neglect 01-01-1800 sentinel date
    return `${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}-${m2[3]}`;
  }
  return "";
}

// Extract verified fields from the Surepass Response Card
function extractSurepassCardDetails() {
  const details = {};

  // 1. Layer 1: Authoritative API Cache Data (Direct from Surepass Backend Interceptor)
  if (latestInterceptedApiData) {
    const api = latestInterceptedApiData;
    if (api.client_id) details["Client ID"] = String(api.client_id).trim();
    if (api.license_number) details["License Number"] = String(api.license_number).trim();
    if (api.name) details["Name"] = String(api.name).trim();
    if (api.state) details["State"] = String(api.state).trim();
    if (api.dob) details["DOB"] = String(api.dob).trim();
    if (api.doi) details["Doi"] = String(api.doi).trim();
    if (api.doe) details["Doe"] = String(api.doe).trim();
    if (api.transport_doi) details["Transport Doi"] = String(api.transport_doi).trim();
    if (api.transport_doe) details["Transport Doe"] = String(api.transport_doe).trim();
    if (api.issue_date && !details["Doi"]) details["Doi"] = String(api.issue_date).trim();
    if (api.expiry_date && !details["Doe"]) details["Doe"] = String(api.expiry_date).trim();
    if (api.validity && !details["Doe"]) details["Doe"] = String(api.validity).trim();
    if (api.permanent_address) details["Permanent Address"] = String(api.permanent_address).trim();
    if (api.temporary_address) details["Temporary Address"] = String(api.temporary_address).trim();
    if (api.father_name || api.father_or_husband_name) details["Father Name"] = String(api.father_name || api.father_or_husband_name).trim();
    if (api.blood_group) details["Blood Group"] = String(api.blood_group).trim();
    if (api.gender) details["Gender"] = String(api.gender).trim();
  }

  const blockText = document.body ? document.body.innerText : "";

  // 2. Layer 2: Full Document Regex Matching for Dates (Handles any newlines, copy icons, colons, spaces)
  if (!details["Transport Doe"]) {
    const m = blockText.match(/\btransport\s*doe\b[\s\S]{1,50}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
    if (m) details["Transport Doe"] = m[1].trim();
  }

  if (!details["Transport Doi"]) {
    const m = blockText.match(/\btransport\s*doi\b[\s\S]{1,50}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
    if (m) details["Transport Doi"] = m[1].trim();
  }

  // DOE (Non-transport): Must NOT be preceded by "transport"
  if (!details["Doe"]) {
    const m = blockText.match(/(?<!transport[\s_-]*)\b(?:doe|date\s*of\s*expiry|valid\s*till|expiry\s*date)\b[\s\S]{1,50}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
    if (m) details["Doe"] = m[1].trim();
  }

  // DOI (Non-transport): Must NOT be preceded by "transport"
  if (!details["Doi"]) {
    const m = blockText.match(/(?<!transport[\s_-]*)\b(?:doi|date\s*of\s*issue|issue\s*date)\b[\s\S]{1,50}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
    if (m) details["Doi"] = m[1].trim();
  }

  // DOB
  if (!details["DOB"]) {
    const m = blockText.match(/\b(?:dob|date\s*of\s*birth)\b[\s\S]{1,50}?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
    if (m) details["DOB"] = m[1].trim();
  }

  // 3. Layer 3: Line-based Extraction for Name and Key Fields
  const textLines = blockText.split("\n").map(s => s.trim()).filter(Boolean);
  if (!details["Name"]) {
    const nIdx = textLines.findIndex(l => /^name\b/i.test(l) && !/father|husband/i.test(l));
    if (nIdx !== -1) {
      for (let i = nIdx + 1; i < Math.min(nIdx + 4, textLines.length); i++) {
        const line = textLines[i];
        if (/copy/i.test(line)) continue;
        if (line.length > 2 && !/address|zip|license|dob|doe|doi|citizenship|state|gender|client/i.test(line)) {
          details["Name"] = line;
          break;
        }
      }
    }
  }

  if (!details["License Number"]) {
    const lIdx = textLines.findIndex(l => /license\s*number/i.test(l));
    if (lIdx !== -1 && textLines[lIdx + 1]) {
      const cand = textLines[lIdx + 1].replace(/\bcopy\b/gi, "").trim();
      if (cand.length > 5) details["License Number"] = cand;
    }
  }

  // 4. Layer 4: Deep Card Tile & Sibling Elements Traversal
  const allCardBoxes = Array.from(document.querySelectorAll("div, section, article, td, li")).filter(c => {
    if (!c || c.children.length > 8) return false;
    const txt = (c.innerText || "").trim();
    return txt.length > 2 && txt.length < 350;
  });

  const knownFieldLabels = new Set([
    "client id", "license number", "state", "name", "permanent address", "permanent zip",
    "temporary address", "temporary zip", "city name", "citizenship", "father name",
    "father/husband name", "father or husband name", "dob", "date of birth", "gender",
    "blood group", "badge number", "class of vehicle", "cov", "doi", "doe",
    "transport doi", "transport doe", "date of issue", "date of expiry", "issue date",
    "valid till", "non transport", "transport", "ola name", "ola code", "has image", "copy"
  ]);

  allCardBoxes.forEach(box => {
    const bTxt = (box.innerText || "").trim();
    const bLower = bTxt.toLowerCase();

    // Check for Transport DOE
    if (!details["Transport Doe"] && bLower.includes("transport doe")) {
      const d = extractDateFromText(bTxt);
      if (d) details["Transport Doe"] = d;
    }
    // Check for Transport DOI
    if (!details["Transport Doi"] && bLower.includes("transport doi")) {
      const d = extractDateFromText(bTxt);
      if (d) details["Transport Doi"] = d;
    }
    // Check for DOE (Non-transport)
    if (!details["Doe"] && (bLower.startsWith("doe\n") || bLower.startsWith("doe:") || bLower === "doe" || bLower.includes("date of expiry") || bLower.includes("valid till")) && !bLower.includes("transport")) {
      const d = extractDateFromText(bTxt);
      if (d) details["Doe"] = d;
    }
    // Check for DOI (Non-transport)
    if (!details["Doi"] && (bLower.startsWith("doi\n") || bLower.startsWith("doi:") || bLower === "doi" || bLower.includes("date of issue") || bLower.includes("issue date")) && !bLower.includes("transport")) {
      const d = extractDateFromText(bTxt);
      if (d) details["Doi"] = d;
    }
    // Check for DOB
    if (!details["DOB"] && (bLower.includes("dob") || bLower.includes("date of birth"))) {
      const d = extractDateFromText(bTxt);
      if (d) details["DOB"] = d;
    }
  });

  // 5. Layer 5: Key-Value Traversal for any remaining fields
  const fields = [
    "Client ID", "License Number", "State", "Name",
    "Permanent Address", "Permanent Zip", "Temporary Address",
    "Temporary Zip", "City Name", "Citizenship",
    "Father Name", "Father/Husband Name", "Father Or Husband Name",
    "DOB", "Gender", "Blood Group", "Badge Number", "Class of Vehicle",
    "COV", "Doi", "Doe", "Transport Doi", "Transport Doe",
    "Ola Name", "Ola Code", "Has Image"
  ];

  fields.forEach(f => {
    if (details[f]) return;
    const fLower = f.toLowerCase();
    const isDateField = /doi|doe|date|valid/i.test(f);

    const box = allCardBoxes.find(b => {
      const bTxt = (b.innerText || "").trim().toLowerCase();
      return bTxt.startsWith(fLower + "\n") || bTxt.startsWith(fLower + ":") || bTxt === fLower;
    });

    if (box) {
      if (isDateField) {
        const foundDate = extractDateFromText(box.innerText);
        if (foundDate) details[f] = foundDate;
      } else {
        const lines = box.innerText.split("\n").map(s => s.trim()).filter(Boolean);
        const lIdx = lines.findIndex(l => l.toLowerCase() === fLower || l.toLowerCase().startsWith(fLower + ":"));
        if (lIdx !== -1 && lines[lIdx + 1]) {
          const candVal = lines[lIdx + 1].replace(/\bcopy\b/gi, "").trim();
          if (!knownFieldLabels.has(candVal.toLowerCase())) {
            details[f] = candVal;
          }
        }
      }
    }
  });

  return details;
}

// Evaluate if Driving Licence Date of Expiry is before today's date
// Permissive / Best-Case: If either Personal DOE or Transport DOE is valid, driver is Not Expired
// Accurately ignores 1800-01-01 sentinel date and states the evaluation basis
function evaluateDlExpiry(doeStr, transportDoeStr) {
  function parseDateSafe(str) {
    if (!str || typeof str !== "string") return null;
    const clean = str.trim();
    if (!clean || clean === "-" || clean.toLowerCase() === "null" || clean.toLowerCase() === "undefined") return null;
    let m = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
      const yr = parseInt(m[1], 10);
      if (yr <= 1900) return null; // Neglect 1800-01-01 sentinel
      return new Date(yr, parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }
    m = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) {
      const yr = parseInt(m[3], 10);
      if (yr <= 1900) return null; // Neglect 01-01-1800 sentinel
      return new Date(yr, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    }
    const d = new Date(clean);
    if (isNaN(d.getTime()) || d.getFullYear() <= 1900) return null;
    return d;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const mainDate = parseDateSafe(doeStr);
  const transDate = parseDateSafe(transportDoeStr);

  function evalDate(d) {
    if (!d) return null;
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { category: "expired", diffDays };
    if (diffDays <= 90) return { category: "expiring_soon", diffDays };
    return { category: "valid", diffDays };
  }

  const mainEval = evalDate(mainDate);
  const transEval = evalDate(transDate);

  // Both Personal DOE and Transport DOE exist and are non-sentinel
  if (mainEval && transEval) {
    if (mainEval.category === "valid" && transEval.category === "valid") {
      const useMain = mainEval.diffDays >= transEval.diffDays;
      return {
        isExpired: false,
        status: "Not Expired",
        basis: useMain ? "Personal DOE" : "Transport DOE",
        doe: useMain ? doeStr : transportDoeStr,
        remarksNote: `Considered based on ${useMain ? 'Personal DOE: ' + doeStr : 'Transport DOE: ' + transportDoeStr}`
      };
    }
    if (mainEval.category === "valid") {
      return {
        isExpired: false,
        status: "Not Expired",
        basis: "Personal DOE",
        doe: doeStr,
        remarksNote: `Considered based on Personal DOE: ${doeStr} (Note: Transport DOE ${transEval.category === 'expired' ? 'expired on ' + transportDoeStr : 'expires on ' + transportDoeStr})`
      };
    }
    if (transEval.category === "valid") {
      return {
        isExpired: false,
        status: "Not Expired",
        basis: "Transport DOE",
        doe: transportDoeStr,
        remarksNote: `Considered based on Transport DOE: ${transportDoeStr} (Note: Personal DOE ${mainEval.category === 'expired' ? 'expired on ' + doeStr : 'expires on ' + doeStr})`
      };
    }
    // Neither is valid, check if either is expiring within 3 months (90 days)
    if (mainEval.category === "expiring_soon" || transEval.category === "expiring_soon") {
      const useMain = mainEval.category === "expiring_soon" && (transEval.category !== "expiring_soon" || mainEval.diffDays >= transEval.diffDays);
      return {
        isExpired: false,
        status: "Expiring in 3 Months",
        basis: useMain ? "Personal DOE" : "Transport DOE",
        doe: useMain ? doeStr : transportDoeStr,
        remarksNote: `Expiring in 3 Months (Considered based on ${useMain ? 'Personal DOE: ' + doeStr : 'Transport DOE: ' + transportDoeStr})`
      };
    }
    // Both are expired
    return {
      isExpired: true,
      status: "DL Expired",
      basis: "Both Expired",
      doe: doeStr,
      remarksNote: `DL Expired (Both Personal DOE: ${doeStr} and Transport DOE: ${transportDoeStr} are expired)`
    };
  }

  // Only Personal DOE exists
  if (mainEval) {
    const isExp = mainEval.category === "expired";
    const isSoon = mainEval.category === "expiring_soon";
    return {
      isExpired: isExp,
      status: isExp ? "DL Expired" : (isSoon ? "Expiring in 3 Months" : "Not Expired"),
      basis: "Personal DOE",
      doe: doeStr,
      remarksNote: `Considered based on Personal DOE: ${doeStr}`
    };
  }

  // Only Transport DOE exists
  if (transEval) {
    const isExp = transEval.category === "expired";
    const isSoon = transEval.category === "expiring_soon";
    return {
      isExpired: isExp,
      status: isExp ? "DL Expired" : (isSoon ? "Expiring in 3 Months" : "Not Expired"),
      basis: "Transport DOE",
      doe: transportDoeStr,
      remarksNote: `Considered based on Transport DOE: ${transportDoeStr}`
    };
  }

  return {
    isExpired: false,
    status: "Not Expired",
    basis: "N/A",
    doe: "-",
    remarksNote: "No Expiry Date Specified"
  };
}

// Find element across document, iframes, and shadow roots
function findElementEverywhere(selectors) {
  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el && el.offsetParent !== null) return el;
    } catch (e) { }
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
      } catch (e) { }
    }
  } catch (e) { }
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

// React-compatible input typing (directly invokes prototype setter; never uses execCommand to avoid selection bleeding)
function setInputValue(input, value) {
  if (!input) return;

  // Unfocus any previously active element
  if (document.activeElement && document.activeElement !== input) {
    try { document.activeElement.blur(); } catch (e) { }
  }
  input.focus();

  // Use prototype setter so React/Vue synthetic state managers register the change cleanly
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
  const targetDl = cleanDl || rawDl;

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
  console.log(`[Surepass Assistant] Entering DL Number strictly into ID Number field: "${targetDl}"`);
  setInputValue(dlInput, targetDl);
  await sleep(350);

  // 2. Locate and Fill DOB strictly into dobInput (guaranteed distinct from dlInput)
  if (driver.dob && dobInput && dobInput !== dlInput) {
    // Explicitly blur dlInput first so no active caret remains in DL field!
    try { dlInput.blur(); } catch (e) { }

    const formattedDob = formatDobForInput(driver.dob, dobInput.type);
    console.log(`[Surepass Assistant] Entering DOB strictly into DOB field: "${formattedDob}"`);
    setInputValue(dobInput, formattedDob);
    await sleep(300);

    // If the field rejected spaces or cleared, fallback with hyphens
    if (!dobInput.value || dobInput.value.length < 6) {
      const fallbackDob = dobInput.type === "date" ? formattedDob : formattedDob.replace(/\s+/g, "-");
      setInputValue(dobInput, fallbackDob);
      await sleep(200);
    }
  }

  // 3. STRICT SANITY GUARD: Ensure dlInput contains ONLY targetDl and was NOT appended with DOB!
  if (dlInput.value !== targetDl) {
    console.warn(`[Surepass Assistant] Sanity Guard caught contaminated DL value ("${dlInput.value}"). Resetting strictly to "${targetDl}"`);
    setInputValue(dlInput, targetDl);
    await sleep(200);
  }

  // Direct prototype fallback if any framework tried to re-contaminate DL input
  if (dlInput.value !== targetDl) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (desc && desc.set) desc.set.call(dlInput, targetDl);
    else dlInput.value = targetDl;
    dlInput.dispatchEvent(new Event("input", { bubbles: true }));
    dlInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // 4. Locate and click Submit / Verify button
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

  // Reset any cached blob from previous operations
  lastCapturedPdfBlob = null;
  lastOpenedReportUrl = null;

  submitBtn.click();
  try { submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } catch (e) { }
  console.log(`[Surepass Assistant] Submit clicked for DL "${targetDl}". Awaiting verification response...`);

  // 4. Await verification result (poll for up to 45s to accommodate government Parivahan SARATHI query time)
  const startTime = Date.now();
  let finalStatus = null;
  let remarks = "";

  await sleep(1000);

  while (Date.now() - startTime < 45000) {
    await sleep(400);

    const isSpinning = document.querySelector(".spinner, .loading, [aria-busy='true'], svg.animate-spin");
    if (isSpinning && isSpinning.offsetParent !== null) {
      continue;
    }

    const bodyText = document.body.innerText;
    const bodyLower = bodyText.toLowerCase();

    // A. Check for Credits / Auth errors
    if (bodyLower.includes("insufficient credit") ||
      bodyLower.includes("insufficient balance") ||
      bodyLower.includes("402 payment required") ||
      bodyLower.includes("401 unauthorized")) {
      finalStatus = "Verification Error";
      remarks = "Insufficient Surepass credits or Unauthorized session";
      break;
    }

    // B. Check specifically for Server Error (500, 502, 503, 504, Bad Gateway, Internal Server Error)
    const errToast = document.querySelector(".toast-error, .alert-danger, .ant-notification-error, [role=alert], .error-message, .swal2-error, .v-alert--error, .toast--error");
    const errToastText = errToast && errToast.offsetParent !== null ? (errToast.innerText || "").trim() : "";

    const isServerErrorToast = /server\s*error|internal\s*server|something\s*went\s*wrong|500|502|503|504|bad\s*gateway|gateway\s*timeout|service\s*unavailable|temporarily\s*unavailable|upstream/i.test(errToastText);

    const hasServerErrorKeywords = 
      bodyLower.includes("server error") ||
      bodyLower.includes("internal server error") ||
      bodyLower.includes("500 internal server error") ||
      bodyLower.includes("502 bad gateway") ||
      bodyLower.includes("503 service unavailable") ||
      bodyLower.includes("504 gateway timeout") ||
      bodyLower.includes("bad gateway") ||
      bodyLower.includes("gateway timeout") ||
      bodyLower.includes("service unavailable") ||
      bodyLower.includes("something went wrong") ||
      bodyLower.includes("upstream server") ||
      bodyLower.includes("parivahan server down") ||
      bodyLower.includes("parivahan server error") ||
      bodyLower.includes("sarathi server error") ||
      bodyLower.includes("sarathi server down") ||
      bodyLower.includes("server is temporarily unavailable") ||
      bodyText.includes('"status_code": 500') ||
      bodyText.includes('"status_code": 502') ||
      bodyText.includes('"status_code": 503') ||
      bodyText.includes('"status_code": 504') ||
      bodyText.includes('"status": 500') ||
      bodyText.includes('"status": 502') ||
      bodyText.includes('"status": 503') ||
      bodyText.includes('"status": 504');

    if (isServerErrorToast || hasServerErrorKeywords) {
      finalStatus = "Server Error";
      remarks = errToastText || "Server Error (Surepass / SARATHI service temporarily unavailable)";
      console.log(`[Surepass Assistant] Server Error detected: "${remarks}"`);
      break;
    }

    // C. Check for Explicit Failure Messages (Invalid DL / Record Not Found)
    const hasFailureKeywords =
      bodyLower.includes("record not found") ||
      bodyLower.includes("no record found") ||
      bodyLower.includes("invalid id number") ||
      bodyLower.includes("invalid dl") ||
      bodyLower.includes("invalid driving license") ||
      bodyLower.includes("driving licence not found") ||
      bodyLower.includes("failed to verify") ||
      bodyLower.includes("verification failed") ||
      bodyLower.includes("details not found") ||
      bodyLower.includes("no details found") ||
      bodyLower.includes("unable to verify") ||
      bodyLower.includes("does not exist") ||
      bodyLower.includes("invalid date of birth") ||
      bodyText.includes('"status_code": 404') ||
      bodyText.includes('"status_code": 422') ||
      bodyText.includes('"status_code": 400') ||
      bodyText.includes('"status": "failed"') ||
      bodyText.includes('"status": "error"') ||
      (bodyText.includes('"success": false') && !bodyText.includes('"success": true'));

    if (hasFailureKeywords || errToastText) {
      finalStatus = "Not Verified";
      remarks = errToastText || "Record Not Found or Invalid DL Number";
      console.log(`[Surepass Assistant] Explicit failure detected: "${remarks}"`);
      break;
    }

    // D. Check for Success Toast / Notification / Response Headers
    const successToast = document.querySelector(".toast-success, .alert-success, .ant-notification-success, .ant-message-success, .swal2-success, .v-alert--success, .toast--success, .bg-green-500, .bg-emerald-500");
    const successToastText = successToast && successToast.offsetParent !== null ? (successToast.innerText || "").trim() : "";

    const hasSuccessKeywords = bodyLower.includes("dl verified") ||
      bodyLower.includes("verification success") ||
      bodyLower.includes("verified success") ||
      bodyLower.includes("details fetched successfully") ||
      bodyLower.includes("license verified") ||
      bodyLower.includes("request successful") ||
      bodyText.includes('"status_code": 200') ||
      bodyText.includes('"status": "success"') ||
      (bodyText.includes('"success": true') && !bodyText.includes('"success": false'));

    // D. Extract Card Details
    const currentCard = extractSurepassCardDetails();
    const currentLic = (currentCard?.["License Number"] || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

    // E. Check if Target DL appears in the Response or DOM outside input fields
    const allNonInputEl = Array.from(document.querySelectorAll("div, p, span, td, b, strong, h1, h2, h3, h4, h5"));
    const dlInResponseDom = allNonInputEl.some(el => {
      if (el.tagName === "INPUT" || el.closest("input") || el.closest(".request-form, form")) return false;
      const t = (el.innerText || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      return t === cleanDl || (t.length > 8 && t.includes(cleanDl));
    });

    const isThisDriverDl = (currentLic && (currentLic.includes(cleanDl) || cleanDl.includes(currentLic))) || dlInResponseDom;
    const hasDownloadBtn = Array.from(document.querySelectorAll("button, a, [role=button]")).some(b => {
      const bt = (b.innerText || b.value || "").toLowerCase().trim();
      return (bt.includes("download") || bt.includes("pdf")) && !bt.includes("excel") && b.offsetParent !== null;
    });

    // POSITIVE MATCH: Target DL found in response / card, or success notification fired with no failure!
    if (isThisDriverDl && (successToastText || hasSuccessKeywords || hasDownloadBtn || currentCard?.["Client ID"] || currentCard?.["Name"])) {
      finalStatus = "Verified";
      remarks = successToastText || "Driver Licence Verified Successfully (Surepass Active)";
      console.log(`[Surepass Assistant] Positive match confirmed for DL: ${cleanDl}! Card:`, currentCard);
      break;
    }

    if ((successToastText || hasSuccessKeywords) && !hasFailureKeywords) {
      await sleep(600);
      finalStatus = "Verified";
      remarks = successToastText || "Driver Licence Verified Successfully (Surepass Active)";
      console.log(`[Surepass Assistant] Positive match confirmed via Success message!`);
      break;
    }
  }

  if (!finalStatus) {
    finalStatus = "Not Verified";
    remarks = "Verification response timeout or no valid match returned from Surepass";
  }

  // 5. If Verified, extract card details, capture DOI & DOE, evaluate expiry, and locate download trigger
  let surepassPdfTriggered = false;
  let pdfBase64 = null;
  let cardDetails = null;
  let doi = "";
  let doe = "";
  let transportDoi = "";
  let transportDoe = "";
  let expiryResult = { isExpired: false, status: "Not Expired", doe: "-" };

  if (finalStatus === "Verified") {
    console.log("[Surepass Assistant] Verified! Actively polling for Response cards, DOI & DOE...");

    // Smooth scroll down to trigger rendering of response cards if virtualized
    try {
      window.scrollTo({ top: document.body.scrollHeight / 3, behavior: "smooth" });
    } catch (e) { }

    const waitStart = Date.now();
    while (Date.now() - waitStart < 15000) {
      cardDetails = extractSurepassCardDetails() || {};

      doi = extractDateFromText(cardDetails["Doi"]) || 
            extractDateFromText(cardDetails["Date of Issue"]) || 
            extractDateFromText(cardDetails["Issue Date"]) || 
            extractDateFromText(cardDetails["Transport Doi"]) || "";

      doe = extractDateFromText(cardDetails["Doe"]) || 
            extractDateFromText(cardDetails["Date of Expiry"]) || 
            extractDateFromText(cardDetails["Valid Till"]) || "";

      transportDoe = extractDateFromText(cardDetails["Transport Doe"]) || "";
      transportDoi = extractDateFromText(cardDetails["Transport Doi"]) || "";

      const hasCandidateName = cardDetails["Name"] && cardDetails["Name"] !== "Verified Candidate" && cardDetails["Name"].toLowerCase() !== "on aadhaar";
      const hasAnyDate = Boolean(doe || doi || transportDoe || cardDetails["DOB"]);
      const hasLic = Boolean(cardDetails["License Number"] || cardDetails["Client ID"]);

      if ((hasAnyDate || hasCandidateName) && hasLic) {
        console.log(`[Surepass Assistant] Response card successfully loaded and verified in ${Date.now() - waitStart}ms!`);
        break;
      }

      await sleep(350);
    }

    if (!cardDetails["License Number"]) cardDetails["License Number"] = driver.dl_number;
    if (!cardDetails["Name"]) cardDetails["Name"] = driver.driver_name || "Verified Candidate";
    console.log("[Surepass Assistant] Final Extracted Card Details:", cardDetails);

    // Sync clean validated date values back into cardDetails
    if (doi) cardDetails["Doi"] = doi;
    if (doe) cardDetails["Doe"] = doe;
    if (transportDoe) cardDetails["Transport Doe"] = transportDoe;
    if (transportDoi) cardDetails["Transport Doi"] = transportDoi;

    expiryResult = evaluateDlExpiry(doe, transportDoe);

    console.log(`[Surepass Assistant] Strictly Validated Dates ➔ DOI: "${doi}" | DOE: "${doe}" (Transport DOE: "${transportDoe}") | Expiry Status: "${expiryResult.status}"`);

    // Suppress blocking native window.print modal (Image 2) so automation continues smoothly
    try {
      window.print = function () {
        console.log("[Surepass Assistant] window.print cleanly intercepted!");
      };
    } catch (e) { }

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
        } catch (e) { }
      }

      // Check if window.open was triggered for the report
      if (!pdfBase64 && lastOpenedReportUrl) {
        try {
          const res = await fetch(lastOpenedReportUrl, { credentials: "include" });
          const b = await res.blob();
          pdfBase64 = await blobToBase64(b);
          console.log(`[Surepass Assistant] Fetched report from window.open URL (${b.size} bytes)`);
        } catch (e) { }
      }

      // If we have base64, also store in background script for safety
      if (pdfBase64) {
        chrome.runtime.sendMessage({
          action: "STORE_SUREPASS_PDF",
          pdfBase64: pdfBase64,
          filename: `${driver.gsm_id}_${driver.phone_number || "DL"}_DL_Report.pdf`
        }).catch(() => { });
      }
    } else {
      console.warn("[Surepass Assistant] Official Surepass download button not found on result card.");
    }
  }

  return {
    success: finalStatus === "Verified",
    status: finalStatus,
    remarks: remarks,
    pdf_downloaded: surepassPdfTriggered,
    pdf_base64: pdfBase64,
    card_details: cardDetails,
    doi: doi,
    doe: doe,
    transport_doi: transportDoi,
    transport_doe: transportDoe,
    dl_expiry_status: expiryResult.status,
    expiry_basis: expiryResult.basis,
    remarks_note: expiryResult.remarksNote,
    is_dl_expired: expiryResult.isExpired,
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
