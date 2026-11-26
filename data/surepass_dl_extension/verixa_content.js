// verixa_content.js - Fast, React-compatible Verixa360 Movement & Scraper
// Searches GSM ID, clicks candidate row, clicks expanded row below, scrolls down to Candidate section, and extracts clean DL, DOB, Phone & Name

console.log("[Verixa360 Assistant] Content script injected on verixa360.com");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const loose = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const visible = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));

// Month lookup for converting formats like "09 Apr 2002" or "28Nov 1995" to YYYY-MM-DD
const MONTHS_MAP = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
};

// Floating Status Pill on Verixa
(function initVerixaPill() {
  if (window !== window.top) return;
  if (document.getElementById("verixa-assistant-pill")) return;

  const pill = document.createElement("div");
  pill.id = "verixa-assistant-pill";
  pill.style.cssText = `
    position: fixed;
    top: 12px;
    right: 14px;
    background: #0F172A;
    color: #6EE7B7;
    border: 1px solid #334155;
    border-radius: 20px;
    padding: 6px 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11px;
    font-weight: 700;
    box-shadow: 0 4px 12px rgba(0,0,0,0.18);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.3s ease;
  `;
  pill.innerHTML = `<span>⚡</span><span id="verixaPillText">Verixa360 Assistant Ready</span>`;
  
  const attach = () => {
    if (document.body) document.body.appendChild(pill);
    else setTimeout(attach, 200);
  };
  attach();
})();

function setVerixaPill(text, type = "info") {
  const t = document.getElementById("verixaPillText");
  const p = document.getElementById("verixa-assistant-pill");
  if (!t || !p) return;
  t.innerText = text;
  if (type === "busy") {
    p.style.color = "#FCD34D";
    p.style.borderColor = "#F59E0B";
  } else if (type === "err") {
    p.style.color = "#FDA4AF";
    p.style.borderColor = "#F43F5E";
  } else {
    p.style.color = "#6EE7B7";
    p.style.borderColor = "#10B981";
  }
}

// Convert any date format (e.g. "09 Apr 2002", "28Nov 1995", "15/08/1990", "1990-08-15") to standard "YYYY-MM-DD"
function parseDobToStandard(rawDob) {
  if (!rawDob) return "";
  const cleaned = rawDob.trim().replace(/\s+/g, " ");

  // Disqualify known non-date words immediately
  if (/(?:police|station|father|mother|address|candidate|mobile|phone|email|pan|aadhaar|licen|acknowledgement)/i.test(cleaned)) {
    return "";
  }

  // 1. Format: "09 Apr 2002", "28Nov 1995", "28-Nov-1995", "Nov 28, 1995"
  const monthNameMatch = cleaned.match(/(\d{1,2})\s*[-/]?\s*([A-Za-z]{3,9})\s*[-/,\s]?\s*(\d{4})/i) ||
                         cleaned.match(/([A-Za-z]{3,9})\s*[-/]?\s*(\d{1,2})\s*[-/,\s]?\s*(\d{4})/i);
  if (monthNameMatch) {
    let day, monthStr, year;
    if (isNaN(monthNameMatch[1])) {
      monthStr = monthNameMatch[1].toLowerCase().slice(0, 3);
      day = monthNameMatch[2].padStart(2, "0");
      year = monthNameMatch[3];
    } else {
      day = monthNameMatch[1].padStart(2, "0");
      monthStr = monthNameMatch[2].toLowerCase().slice(0, 3);
      year = monthNameMatch[3];
    }
    const month = MONTHS_MAP[monthStr];
    if (month && year && day) {
      return `${year}-${month}-${day}`;
    }
  }

  // 2. Format: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  const dmyMatch = cleaned.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // 3. Format: YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = cleaned.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return "";
}

// Check if a string is a valid date of birth representation
function isValidDob(str) {
  if (!str) return false;
  if (/police|station|father|mother|address|candidate|name|mobile|phone|email|licen|pan|aadhaar|acknowledgement/i.test(str)) return false;
  // Has month name: e.g. "09 Apr 2002", "28Nov 1995"
  if (/\b\d{1,2}\s*[-/]?[A-Za-z]{3,9}\s*[-/,\s]?\d{4}\b/i.test(str)) return true;
  if (/\b[A-Za-z]{3,9}\s*[-/]?\d{1,2}\s*[-/,\s]?\d{4}\b/i.test(str)) return true;
  // Numeric date: DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD
  if (/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/.test(str)) return true;
  if (/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(str)) return true;
  return false;
}

// Search input field finder
function getSearchBox() {
  const inputs = Array.from(document.querySelectorAll('input'));
  let b = inputs.find(i => /driver|mobile|ref|gsm|search|query/i.test((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
  if (b) return b;
  b = inputs.find(i => i.type === 'search');
  if (b) return b;
  b = inputs.find(i => (!i.type || i.type === 'text') && !/password|date|check|radio|file|submit/i.test(i.type));
  return b || null;
}

// React-compatible input typing
function setInputValue(input, value) {
  if (!input) return;
  input.focus();
  input.select();
  let typed = false;
  try { typed = document.execCommand('insertText', false, value); } catch (e) {}
  if (!typed || input.value !== value) {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (const type of ['keydown', 'keyup']) {
    input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
}

// Find candidate row, card, or application link on the page matching GSM ID
function findCandidateElement(gsmId) {
  const cleanId = gsmId.trim();
  const rawNum = cleanId.split("-").pop(); // e.g. "6529" from "GSM-FLS-6529"

  // 1. Look for anchor tags with href pointing to /applications/
  const appLinks = Array.from(document.querySelectorAll('a[href*="/applications/"]')).filter(visible);
  if (appLinks.length > 0) {
    const matchingLink = appLinks.find(a => {
      const text = (a.innerText || "") + " " + (a.closest('tr, div, li')?.innerText || "");
      return text.includes(cleanId) || (rawNum.length >= 4 && text.includes(rawNum));
    });
    if (matchingLink) return matchingLink;
  }

  // 2. Look for any visible element whose text includes cleanId
  const allHits = Array.from(document.querySelectorAll('tr, div, li, a, p, span, td')).filter(el => {
    if (!visible(el)) return false;
    const t = el.innerText || "";
    return t.includes(cleanId) || (rawNum.length >= 4 && t.includes(rawNum));
  });

  if (allHits.length > 0) {
    allHits.sort((a, b) => (a.innerText?.length || 0) - (b.innerText?.length || 0));
    const hit = allHits[0];

    const link = hit.querySelector('a[href*="/applications/"]') ||
                 hit.closest('tr')?.querySelector('a[href*="/applications/"]') ||
                 hit.parentElement?.querySelector('a[href*="/applications/"]');
    if (link) return link;

    const row = hit.closest('tr') || hit.closest('[role=row]') || hit;
    const clickTarget = row.querySelector('a, button, [role=button], td:not(:has(input[type=checkbox]))') || row;
    return clickTarget;
  }

  if (appLinks.length > 0) return appLinks[0];
  return null;
}

// Extract driver information specifically from the "Candidate" section down below
function extractDetailsFromCandidateSection(targetEl, gsmId) {
  let dlNumber = "";
  let dob = "";
  let phoneNumber = "";
  let driverName = "";

  const candidateSection = Array.from(document.querySelectorAll("div, section, article, [role=region]")).find(el => {
    const h = el.querySelector("h1, h2, h3, h4, h5, div, span, p");
    return h && /^\s*candidate\s*$/i.test((h.innerText || "").trim()) && visible(el);
  }) || document.body;

  const text = (candidateSection.innerText || document.body.innerText).replace(/\r/g, "");

  // 1. Driving Licence Number: MUST follow "Driving licence" / "DL" label directly!
  // Prevents picking up Acknowledgement / Application numbers like AR896219142537
  const dlDirectMatch = text.match(/(?:driving\s*licen[cs]e|licen[cs]e\s*no|\bdl\s*(?:no|number)?)\s*[:\-]?\s*([A-Z]{2}[0-9\s-]{11,18})/i) ||
                        text.match(/(?:driving\s*licen[cs]e|licen[cs]e\s*no|\bdl\b)[^A-Z0-9]*([A-Z]{2}[0-9\s-]{11,18})/i);
  if (dlDirectMatch) {
    const rawMatch = dlDirectMatch[1];
    const cleanedDigitsOnly = rawMatch.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const validDl = cleanedDigitsOnly.match(/^([A-Z]{2}[0-9]{11,14})/);
    if (validDl) {
      dlNumber = validDl[1];
    }
  }

  // 2. Date of Birth: MUST follow "Date of birth" / "DOB" label directly!
  const dobDirectMatch = text.match(/(?:date\s*of\s*birth|\bdob\b)\s*[:\-]?\s*([0-9]{1,2}\s*[-/]?[A-Za-z]{3,9}\s*[-/,\s]?[0-9]{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
  if (dobDirectMatch && isValidDob(dobDirectMatch[1])) {
    dob = parseDobToStandard(dobDirectMatch[1]);
  }

  // Fallback DOB: broad search in candidate section if not directly adjacent
  if (!dob) {
    const broadDobMatch = text.match(/\b([0-9]{1,2}\s*[-/]?[A-Za-z]{3,9}\s*[-/,\s]?(?:19[5-9]\d|200[0-8]))\b/i) ||
                          text.match(/\b([0-9]{1,2}[-/.]\s*[0-9]{1,2}[-/.]\s*(?:19[5-9]\d|200[0-8]))\b/);
    if (broadDobMatch && isValidDob(broadDobMatch[1])) {
      dob = parseDobToStandard(broadDobMatch[1]);
    }
  }

  // 3. Mobile Number: MUST follow "Mobile" / "Phone" label directly!
  const phoneMatch = text.match(/(?:mobile|phone|contact\s*no|mobile\s*no)\s*[:\-]?\s*([6-9]\d{9})/i);
  if (phoneMatch) {
    phoneNumber = phoneMatch[1];
  }

  // 4. Driver Name: MUST follow "Name on Aadhaar" label directly!
  const nameMatch = text.match(/(?:name\s*on\s*aadhaar|candidate\s*name)\s*[:\-]?\s*([A-Za-z\s]{2,40})/i);
  if (nameMatch) {
    driverName = nameMatch[1].split("\n")[0].trim();
  }
  if (!driverName && targetEl) {
    const linkEl = targetEl.tagName === 'A' ? targetEl : targetEl.querySelector("a[href*='/applications/'], a");
    if (linkEl && linkEl.innerText.trim()) {
      driverName = linkEl.innerText.trim();
    }
  }

  return {
    dl_number: dlNumber,
    dob: dob,
    phone_number: phoneNumber,
    driver_name: driverName
  };
}

// Search GSM on Verixa360, click candidate row, click expanded row below, scroll down to Candidate section, and extract details
async function searchAndExtractGSM(gsmId) {
  setVerixaPill(`🔍 Searching: ${gsmId}...`, "busy");
  console.log(`[Verixa360 Assistant] Starting search for ${gsmId}`);

  // Step 0: Check if Candidate section is ALREADY open on the page!
  let quickCheck = extractDetailsFromCandidateSection(null, gsmId);
  if (quickCheck.dl_number && quickCheck.dob) {
    setVerixaPill(`✓ Found DL: ${quickCheck.dl_number}`, "info");
    return { success: true, gsm_id: gsmId, ...quickCheck };
  }

  // Step 1: Type into search box if available
  const box = getSearchBox();
  if (box) {
    setInputValue(box, gsmId);
    const searchBtn = Array.from(document.querySelectorAll('button, a, [role=button]')).find(b => 
      /search|find|filter|apply/i.test(b.innerText || b.getAttribute('aria-label') || '')
    );
    if (searchBtn) {
      try { searchBtn.click(); } catch (e) {}
    }
  }

  // Step 2: Poll for candidate row, card, or application link (up to 12s)
  setVerixaPill(`⏳ Waiting for ${gsmId}...`, "busy");
  let targetEl = null;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 12000) {
    targetEl = findCandidateElement(gsmId);
    if (targetEl) break;
    await sleep(400);
  }

  if (!targetEl) {
    setVerixaPill(`⚠️ No match for ${gsmId}`, "err");
    return { success: false, gsm_id: gsmId, reason: `Driver ${gsmId} not found in search results on Verixa360.` };
  }

  // Step 3: Click the candidate row / candidate link (e.g. [SUHAL] or /applications/...)
  setVerixaPill(`🖱️ Clicking candidate row...`, "busy");
  try {
    if (targetEl.tagName === 'A' && targetEl.target === '_blank') targetEl.target = '_self';
    const childLink = targetEl.querySelector('a');
    if (childLink && childLink.target === '_blank') childLink.target = '_self';
    if (targetEl.scrollIntoView) targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
    targetEl.click();
  } catch (e) {
    console.warn("[Verixa360 Assistant] Click 1 error:", e);
  }

  // Step 4: Wait for the row down below to appear (as user described)
  await sleep(1500);

  // Look for the expanded row down below or [SUHAL] link
  const subTarget = findCandidateElement(gsmId);
  if (subTarget && subTarget !== targetEl) {
    setVerixaPill(`🖱️ Clicking details row...`, "busy");
    try {
      if (subTarget.scrollIntoView) subTarget.scrollIntoView({ block: "center", behavior: "smooth" });
      subTarget.click();
      await sleep(1200);
    } catch (e) {}
  }

  // Step 5: Scroll down to the "Candidate" section
  setVerixaPill(`📜 Scrolling to Candidate section...`, "busy");
  window.scrollBy({ top: 900, behavior: "smooth" });
  await sleep(1000);

  const candidateHeader = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, div, span, p, b, strong")).find(el => 
    visible(el) && /^\s*candidate\s*$/i.test((el.innerText || "").trim())
  );

  if (candidateHeader && candidateHeader.scrollIntoView) {
    candidateHeader.scrollIntoView({ block: "start", behavior: "smooth" });
  } else {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  // Give DOM elements a moment to populate
  await sleep(1200);

  // Step 6: Extract details from the Candidate section
  let extracted = extractDetailsFromCandidateSection(targetEl, gsmId);

  // Retry once after 2 seconds if DL or DOB is still missing
  let retries = 0;
  while ((!extracted.dl_number || !extracted.dob) && retries < 2) {
    await sleep(1500);
    extracted = extractDetailsFromCandidateSection(targetEl, gsmId);
    retries++;
  }

  if (extracted.dl_number) {
    setVerixaPill(`✓ Found DL: ${extracted.dl_number}`, "info");
    return {
      success: true,
      gsm_id: gsmId,
      dl_number: extracted.dl_number,
      dob: extracted.dob,
      phone_number: extracted.phone_number || "",
      driver_name: extracted.driver_name || ""
    };
  } else {
    setVerixaPill(`⚠️ DL not found in Candidate section`, "err");
    return {
      success: false,
      gsm_id: gsmId,
      reason: `Found driver ${gsmId} on Verixa360, but Driving Licence number was not found under Candidate section.`
    };
  }
}

// Auto-upload the official Surepass verification report PDF to Verixa under Verification results -> Driving licence certificate
async function uploadDlCertificateToVerixa(pdfBase64, filename, gsmId) {
  setVerixaPill(`📤 Uploading DL Certificate...`, "busy");
  console.log(`[Verixa360 Assistant] Starting DL Certificate upload for ${gsmId}`);

  if (!pdfBase64) {
    setVerixaPill(`⚠️ Missing PDF data`, "err");
    return { success: false, reason: "No PDF data was provided for upload." };
  }

  // Step 1: Scroll to "Verification results"
  const verifHeaders = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, div, span, p, b, strong")).filter(el => 
    visible(el) && /verification\s*results/i.test((el.innerText || "").trim())
  );

  if (verifHeaders.length > 0 && verifHeaders[0].scrollIntoView) {
    verifHeaders[0].scrollIntoView({ block: "center", behavior: "smooth" });
    await sleep(600);
  } else {
    window.scrollBy({ top: -750, behavior: "smooth" });
    await sleep(500);
  }

  // Helper to ensure an element belongs STRICTLY to the Driving Licence section and NEVER to Aadhaar or others
  function isStrictlyDlElement(el) {
    if (!el) return false;
    let cur = el;
    while (cur && cur !== document.body) {
      const txt = (cur.innerText || "").toLowerCase();
      // If container mentions Aadhaar, PAN, PCC, CRC, etc. without being the DL section, strictly reject!
      if (/aadhaar|uidai|pan\s*card|police\s*clearance|crc\s*response|pcc\s*ack|physical\s*verification/i.test(txt) && !/driving\s*licen[sc]e/i.test(txt)) {
        return false;
      }
      cur = cur.parentElement;
    }
    return true;
  }

  // Step 2: Locate the exact "Driving licence certificate" heading and row (Image 3)
  const allDlHeadings = Array.from(document.querySelectorAll("div, h1, h2, h3, h4, h5, span, p, label, b, strong")).filter(el => {
    if (!visible(el)) return false;
    const txt = (el.innerText || "").toLowerCase().trim();
    return /driving\s*licen[sc]e\s*certificate/i.test(txt) && el.children.length === 0;
  });

  const dlHeading = allDlHeadings[0];
  if (!dlHeading) {
    setVerixaPill(`⚠️ DL Certificate section not found`, "err");
    return { success: false, reason: "Could not locate 'Driving licence certificate' section under Verification results." };
  }

  // Locate the specific row/card container for Driving licence certificate STRICTLY without escaping into Aadhaar/parent
  let dlRow = dlHeading.parentElement;
  while (dlRow && dlRow !== document.body) {
    const parent = dlRow.parentElement;
    if (!parent) break;
    const parentTxt = (parent.innerText || "").toLowerCase();
    // STOP climbing immediately if parent contains sibling document headings (Aadhaar, PAN, CRC, PCC, Police)
    if (/aadhaar|uidai|pan\s*card|police\s*clearance|crc\s*response|pcc\s*ack|physical\s*verification/i.test(parentTxt)) {
      break;
    }
    dlRow = parent;
    if (dlRow.querySelector('input[type="file"]') || 
        Array.from(dlRow.querySelectorAll("button, a, label, span, [role=button]")).some(b => /choose\s*file|file\s*it|replace/i.test(b.innerText || ""))) {
      break;
    }
  }
  if (!dlRow) dlRow = dlHeading.parentElement;

  // Step 3: Check if certificate is already on file ("✓ on file", "View ↗", or "Replace" button present)
  const dlRowText = (dlRow.innerText || "").toLowerCase();
  const alreadyOnFile = dlRowText.includes("on file") || 
                        Array.from(dlRow.querySelectorAll("a, button, span")).some(b => visible(b) && /view/i.test((b.innerText || "").trim()));

  const replaceBtn = Array.from(dlRow.querySelectorAll("button, a, label, span, [role=button]")).find(b => 
    visible(b) && /^\s*replace\s*$/i.test((b.innerText || b.value || "").trim())
  );

  let fileInput = null;

  if (alreadyOnFile && replaceBtn) {
    console.log("[Verixa360 Assistant] DL Certificate already exists on file. Attempting 'Replace' strictly in DL...");
    replaceBtn.click();
    await sleep(600);

    const otherOption = Array.from(document.querySelectorAll("button, label, input, span")).find(el => 
      visible(el) && /^\s*other\s*$/i.test((el.innerText || el.value || "").trim())
    );
    if (otherOption) {
      try { otherOption.click(); } catch (e) {}
      await sleep(300);
    }

    const confirmReplaceBtn = Array.from(document.querySelectorAll("button, [role=button]")).find(el => 
      visible(el) && /^\s*replace\s*$/i.test((el.innerText || "").trim()) && el !== replaceBtn
    );
    if (confirmReplaceBtn) {
      try { confirmReplaceBtn.click(); } catch (e) {}
      await sleep(500);
    }

    // Check if a file input opened strictly in dlRow or in active replacement modal
    fileInput = dlRow.querySelector('input[type="file"]');
    if (!fileInput) {
      const modal = document.querySelector('[role=dialog], .modal, .ant-modal, .swal2-modal');
      if (modal && modal.querySelector('input[type="file"]')) {
        fileInput = modal.querySelector('input[type="file"]');
      }
    }

    // If replacement did NOT produce a file input strictly for DL, DO NOT SEARCH THE PAGE!
    if (!fileInput) {
      console.log(`[Verixa360 Assistant] DL report is already on file for ${gsmId} (View ↗ verified). Preserving existing DL certificate safely without touching other fields.`);
      setVerixaPill(`✓ DL Certificate Already on File`, "info");
      return {
        success: true,
        alreadyOnFile: true,
        message: `DL verification report already on file and viewable on Verixa for ${gsmId}. Kept existing file safely.`
      };
    }
  } else if (alreadyOnFile && !replaceBtn) {
    // Already on file with no replace button
    console.log(`[Verixa360 Assistant] DL report is already on file for ${gsmId} (View ↗ verified). Skipping upload to avoid overwriting.`);
    setVerixaPill(`✓ DL Certificate Already on File`, "info");
    return {
      success: true,
      alreadyOnFile: true,
      message: `DL verification report already on file and viewable on Verixa for ${gsmId}.`
    };
  }

  // Step 4: Locate file input strictly within DL section (Fresh Upload)
  if (!fileInput) {
    fileInput = dlRow.querySelector('input[type="file"]');
  }

  // STRICT ASSERTION: If file input is not inside dlRow, or if it belongs to an Aadhaar/other container, ABORT IMMEDIATELY!
  if (!fileInput || !isStrictlyDlElement(fileInput)) {
    console.warn(`[Verixa360 Assistant] 🛑 Refusing to upload: No valid file input found strictly inside Driving licence certificate.`);
    setVerixaPill(`⚠️ No DL file input found`, "err");
    return { 
      success: false, 
      reason: "Could not find file upload input strictly inside 'Driving licence certificate'. Upload aborted to prevent touching Aadhaar or other document fields." 
    };
  }

  // Step 5: Convert Base64 data back to native File object and attach
  const cleanFilename = filename || `${gsmId}_Surepass_DL_Report.pdf`;
  try {
    const res = await fetch(pdfBase64);
    const blob = await res.blob();
    const pdfFile = new File([blob], cleanFilename, { type: "application/pdf", lastModified: Date.now() });

    console.log(`[Verixa360 Assistant] Attaching 4-page report "${cleanFilename}" (${pdfFile.size} bytes)...`);

    // Inject file via DataTransfer
    const dt = new DataTransfer();
    dt.items.add(pdfFile);
    fileInput.files = dt.files;

    // Dispatch standard browser events so framework registers the change
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Drop target fallback if dropzone is present strictly inside dlRow
    const dropTarget = dlRow.querySelector("label, .dropzone, [data-dropzone]");
    if (dropTarget) {
      try {
        dropTarget.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      } catch (de) {}
    }

    await sleep(800);

    // Step 6: Click the "File it" button STRICTLY for Driving licence certificate (Image 3)
    console.log("[Verixa360 Assistant] Locating 'File it' button strictly for Driving licence certificate...");

    let fileItBtn = Array.from(dlRow.querySelectorAll("button, a, [role=button], input[type=submit], span")).find(b => 
      visible(b) && !b.disabled && /^\s*file\s*it\s*$/i.test((b.innerText || b.value || "").trim())
    );

    // If replacement was done inside a modal, check modal
    if (!fileItBtn) {
      const modal = document.querySelector('[role=dialog], .modal, .ant-modal, .swal2-modal');
      if (modal) {
        fileItBtn = Array.from(modal.querySelectorAll("button, a, [role=button], input[type=submit]")).find(b => 
          visible(b) && !b.disabled && /^\s*(?:file\s*it|upload|save|confirm|submit)\s*$/i.test((b.innerText || b.value || "").trim())
        );
      }
    }

    if (!fileItBtn) {
      // Fallback: check for Save or Upload strictly inside dlRow
      fileItBtn = Array.from(dlRow.querySelectorAll("button, a, [role=button], input[type=submit]")).find(b => 
        visible(b) && !b.disabled && /^\s*(?:upload|save|submit)\s*$/i.test((b.innerText || b.value || "").trim())
      );
    }

    // STRICT ASSERTION: If fileItBtn is not found strictly inside dlRow or modal, or if it's in Aadhaar, DO NOT CLICK!
    if (!fileItBtn || !isStrictlyDlElement(fileItBtn)) {
      console.warn(`[Verixa360 Assistant] 🛑 Refusing to click submission: 'File it' button was not strictly inside Driving licence certificate.`);
      setVerixaPill(`⚠️ No DL 'File it' button`, "err");
      return {
        success: false,
        reason: "Could not find 'File it' button strictly inside 'Driving licence certificate'. Submission aborted to protect Aadhaar and other fields."
      };
    }

    const btnLabel = (fileItBtn.innerText || fileItBtn.value || "File it").trim();
    console.log(`[Verixa360 Assistant] Clicking submission button strictly for DL: "${btnLabel}"...`);
    try {
      fileItBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      fileItBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      fileItBtn.click();
    } catch (e) {
      fileItBtn.click();
    }
    await sleep(2000);

    // Modal confirmation check (if a secondary dialog asks to confirm upload)
    const modalConfirmBtn = Array.from(document.querySelectorAll("[role=dialog] button, .modal button, .swal2-confirm, .ant-modal button")).find(b => 
      visible(b) && !b.disabled && /^\s*(?:confirm|yes|proceed|upload|save|ok)\s*$/i.test((b.innerText || b.value || "").trim())
    );
    if (modalConfirmBtn) {
      console.log(`[Verixa360 Assistant] Confirming modal dialog via "${modalConfirmBtn.innerText.trim()}"...`);
      try { modalConfirmBtn.click(); } catch (e) {}
      await sleep(1500);
    }

    // Step 7: Await status confirmation (View ↗ / on file / Replace) matching Image 3
    let isViewable = false;
    for (let check = 0; check < 6; check++) {
      const rowText = (dlRow.innerText || "").toLowerCase();
      const hasView = Array.from(dlRow.querySelectorAll("a, button, span")).some(el => 
        visible(el) && /view/i.test((el.innerText || "").trim())
      );
      if (hasView || rowText.includes("on file") || rowText.includes("replace") || rowText.includes("view")) {
        isViewable = true;
        console.log("[Verixa360 Assistant] ✓ Verified: Document is filed and [View ↗] is accessible on Verixa!");
        break;
      }
      await sleep(1000);
    }

    setVerixaPill(`✓ Certificate Uploaded & Filed!`, "info");
    return {
      success: true,
      message: `DL verification report attached, filed, and viewable for ${gsmId}.`,
      viewable: isViewable
    };
  } catch (err) {
    setVerixaPill(`⚠️ Upload error: ${err.message}`, "err");
    return { success: false, reason: `File attachment failed: ${err.message}` };
  }
}

// Chrome Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PING_VERIXA" || request.type === "vxPing") {
    const isLogin = /login|signin/i.test(location.pathname) || !!document.querySelector("input[type=password]");
    sendResponse({ ok: true, isLogin, pathname: location.pathname });
    return true;
  }
  if (request.action === "SEARCH_AND_EXTRACT_GSM") {
    searchAndExtractGSM(request.gsm_id)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, reason: err.message }));
    return true;
  }
  if (request.action === "UPLOAD_DL_CERTIFICATE") {
    uploadDlCertificateToVerixa(request.pdfBase64, request.filename, request.gsmId)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, reason: err.message }));
    return true;
  }
});
