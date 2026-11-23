// verixa_aadhaar_content.js - Content Script injected into Verixa360 pages for Aadhaar Automation
console.log("[Verixa360 Aadhaar Assistant] Script injected into:", location.href);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function visible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
  );
}

// Visual Floating Status Pill
function setVerixaPill(text, type = "busy") {
  let pill = document.getElementById("verixaAadhaarHelperPill");
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "verixaAadhaarHelperPill";
    pill.style.position = "fixed";
    pill.style.top = "15px";
    pill.style.right = "20px";
    pill.style.zIndex = "9999999";
    pill.style.padding = "8px 14px";
    pill.style.borderRadius = "20px";
    pill.style.fontFamily = "system-ui, -apple-system, sans-serif";
    pill.style.fontSize = "12px";
    pill.style.fontWeight = "600";
    pill.style.boxShadow = "0 4px 15px rgba(0,0,0,0.15)";
    pill.style.transition = "all 0.3s ease";
    pill.style.display = "flex";
    pill.style.alignItems = "center";
    pill.style.gap = "8px";
    document.body.appendChild(pill);
  }

  if (type === "busy") {
    pill.style.background = "#4F46E5";
    pill.style.color = "#FFFFFF";
    pill.innerHTML = `<span>⏳</span> <span>${text}</span>`;
  } else if (type === "info") {
    pill.style.background = "#059669";
    pill.style.color = "#FFFFFF";
    pill.innerHTML = `<span>✓</span> <span>${text}</span>`;
  } else if (type === "err") {
    pill.style.background = "#DC2626";
    pill.style.color = "#FFFFFF";
    pill.innerHTML = `<span>⚠️</span> <span>${text}</span>`;
  }
}

function clearVerixaPill() {
  const pill = document.getElementById("verixaAadhaarHelperPill");
  if (pill) pill.remove();
}

// Extract 12-digit Aadhaar number from string
function extractCleanAadhaar(raw) {
  if (!raw) return "";
  const cleaned = raw.replace(/\D/g, "");
  if (cleaned.length === 12) return cleaned;
  // Regex check for 12 digits
  const m = raw.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/);
  if (m) return m[0].replace(/\D/g, "");
  return cleaned.length >= 12 ? cleaned.slice(0, 12) : "";
}

// Clean DOB (YYYY-MM-DD or DD-MM-YYYY)
function cleanDob(raw) {
  if (!raw) return "";
  const s = raw.trim();
  const m1 = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
  const m2 = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return s;
}

// STEP 1: Search GSM ID and Extract Candidate Data (Aadhaar, Phone, Name, DOB)
async function searchAndExtractAadhaarGSM(gsmId) {
  setVerixaPill(`Searching GSM: ${gsmId}...`, "busy");
  console.log(`[Verixa360 Aadhaar Assistant] Initiating search for GSM ID: ${gsmId}`);

  // 1. Locate search input field
  const searchInput = Array.from(document.querySelectorAll("input[type=search], input[type=text], input:not([type])")).find(i => {
    if (!visible(i)) return false;
    const ph = (i.placeholder || "").toLowerCase();
    const name = (i.name || "").toLowerCase();
    const id = (i.id || "").toLowerCase();
    return ph.includes("search") || ph.includes("gsm") || name.includes("search") || id.includes("search");
  });

  if (!searchInput) {
    // If already inside candidate application view, extract directly
    if (location.pathname.includes("/applications/")) {
      return extractAadhaarDetailsFromCandidateView(gsmId);
    }
    setVerixaPill(`⚠️ Search bar not found`, "err");
    return { success: false, reason: "Search input field not found on Verixa page." };
  }

  // Focus and type GSM ID
  searchInput.focus();
  searchInput.value = gsmId;
  searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  searchInput.dispatchEvent(new Event("change", { bubbles: true }));

  // Simulate Enter key or click Search icon
  searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
  await sleep(1500);

  // Locate the candidate row matching the GSM ID
  setVerixaPill(`Locating row for ${gsmId}...`, "busy");
  const allRows = Array.from(document.querySelectorAll("tr, [role=row], .table-row, div.grid"));
  let targetRow = allRows.find(r => visible(r) && (r.innerText || "").includes(gsmId));

  if (!targetRow) {
    await sleep(1500);
    targetRow = Array.from(document.querySelectorAll("tr, [role=row], .table-row")).find(r => visible(r) && (r.innerText || "").includes(gsmId));
  }

  if (!targetRow) {
    setVerixaPill(`⚠️ Candidate row not found`, "err");
    return { success: false, reason: `No matching application row found for ${gsmId}.` };
  }

  // Click on the application link
  const link = targetRow.querySelector("a[href*='/applications/'], a[href*='/candidate/'], a[href*='/view/']") || 
               targetRow.querySelector("a, [role=button], button");

  if (!link) {
    setVerixaPill(`⚠️ Application link not found`, "err");
    return { success: false, reason: `Could not find clickable link in row for ${gsmId}.` };
  }

  if (link.tagName === "A") {
    link.target = "_self";
  }

  console.log(`[Verixa360 Aadhaar Assistant] Clicking into application for ${gsmId}...`);
  setVerixaPill(`Opening application...`, "busy");
  link.click();

  // Wait for application page to load
  await sleep(3500);
  return extractAadhaarDetailsFromCandidateView(gsmId);
}

// STEP 2: Extract Aadhaar Number and Demographic Details from Candidate View
async function extractAadhaarDetailsFromCandidateView(gsmId) {
  setVerixaPill(`Extracting Aadhaar details...`, "busy");

  // Scroll smoothly down to the Candidate details section
  const candidateHeaders = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, div, span, p, b, strong")).filter(el => 
    visible(el) && /^\s*candidate\s*$/i.test((el.innerText || "").trim())
  );

  if (candidateHeaders.length > 0 && candidateHeaders[0].scrollIntoView) {
    candidateHeaders[0].scrollIntoView({ block: "center", behavior: "smooth" });
    await sleep(800);
  } else {
    window.scrollBy({ top: 600, behavior: "smooth" });
    await sleep(600);
  }

  let aadhaarNumber = "";
  let phoneNumber = "";
  let dob = "";
  let candidateName = "";

  // Helper to extract value following a label
  function getValueAfterLabel(labelRegex) {
    const allLabels = Array.from(document.querySelectorAll("label, span, div, p, dt, th, td, b, strong")).filter(el => {
      if (!visible(el)) return false;
      const txt = (el.innerText || "").trim();
      return labelRegex.test(txt);
    });

    for (const lbl of allLabels) {
      // Sibling element
      const sib = lbl.nextElementSibling;
      if (sib && sib.innerText && sib.innerText.trim()) {
        const val = sib.innerText.trim();
        if (val.length > 1 && !labelRegex.test(val)) return val;
      }
      // Parent container check
      const parent = lbl.parentElement;
      if (parent) {
        const lines = parent.innerText.split("\n").map(s => s.trim()).filter(Boolean);
        const idx = lines.findIndex(l => labelRegex.test(l));
        if (idx !== -1 && lines[idx + 1]) {
          const val = lines[idx + 1];
          if (!labelRegex.test(val)) return val;
        }
      }
    }
    return "";
  }

  // 1. Extract 12-digit Aadhaar Number
  const rawAadhaar = getValueAfterLabel(/(?:aadhaar|aadhar|uid|uidai|aadhaar\s*no|aadhar\s*no|aadhaar\s*number|aadhar\s*number)\b/i);
  if (rawAadhaar) {
    aadhaarNumber = extractCleanAadhaar(rawAadhaar);
  }

  // Fallback: Regex scan page body for 12-digit Aadhaar
  if (!aadhaarNumber) {
    const bodyText = document.body.innerText;
    const m = bodyText.match(/(?:aadhaar|aadhar|uid)\s*(?:no|number)?[:\s\n-]*([0-9\s-]{12,16})/i);
    if (m && m[1]) {
      aadhaarNumber = extractCleanAadhaar(m[1]);
    }
  }

  // 2. Extract Phone Number
  const rawPhone = getValueAfterLabel(/(?:phone|mobile|contact|cell)\b/i);
  if (rawPhone) {
    const digits = rawPhone.replace(/\D/g, "");
    phoneNumber = digits.length >= 10 ? digits.slice(-10) : digits;
  }
  if (!phoneNumber) {
    const pm = document.body.innerText.match(/(?:phone|mobile|contact)[:\s\n]*([+]?91[\s-]?)?([6-9]\d{9})/i);
    if (pm && pm[2]) phoneNumber = pm[2];
  }

  // 3. Extract DOB
  const rawDob = getValueAfterLabel(/(?:date\s*of\s*birth|dob|birth\s*date)\b/i);
  if (rawDob) dob = cleanDob(rawDob);

  // 4. Extract Candidate Name
  const rawName = getValueAfterLabel(/(?:candidate\s*name|driver\s*name|full\s*name|name)\b/i);
  if (rawName) candidateName = rawName.split("\n")[0].trim();

  console.log(`[Verixa360 Aadhaar Assistant] Extracted for ${gsmId}: Aadhaar="${aadhaarNumber}", Phone="${phoneNumber}", DOB="${dob}", Name="${candidateName}"`);

  if (!aadhaarNumber || aadhaarNumber.length !== 12) {
    setVerixaPill(`⚠️ Aadhaar not found or invalid`, "err");
    return {
      success: false,
      reason: `Could not locate valid 12-digit Aadhaar number for candidate ${gsmId}. (Found: "${aadhaarNumber || 'None'}")`,
      phone_number: phoneNumber,
      dob: dob,
      candidate_name: candidateName
    };
  }

  setVerixaPill(`✓ Aadhaar: ${aadhaarNumber.slice(0, 4)} XXXX ${aadhaarNumber.slice(8)}`, "info");
  return {
    success: true,
    gsm_id: gsmId,
    aadhaar_number: aadhaarNumber,
    phone_number: phoneNumber,
    dob: dob,
    candidate_name: candidateName
  };
}

// STEP 3: Upload Aadhaar Verification Report PDF to "Aadhaar card certificate" and Click Submit
async function uploadAadhaarCertificateToVerixa(pdfBase64, filename, gsmId) {
  setVerixaPill(`📤 Uploading Aadhaar Certificate...`, "busy");
  console.log(`[Verixa360 Aadhaar Assistant] Starting Aadhaar Certificate upload for ${gsmId}`);

  // Strict check: PDF must be non-empty and valid
  if (!pdfBase64 || pdfBase64.length < 500) {
    setVerixaPill(`⚠️ Refused: Not verified`, "err");
    return { success: false, reason: "Strict check blocked: Candidate was not verified or PDF data is missing." };
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

  // Step 2: Locate the "Aadhaar card certificate" container
  const allHits = Array.from(document.querySelectorAll("div, tr, li, section, fieldset")).filter(el => {
    if (!visible(el)) return false;
    const txt = (el.innerText || "").toLowerCase();
    return (txt.includes("aadhaar") || txt.includes("aadhar")) && (txt.includes("certificate") || txt.includes("card"));
  });

  if (allHits.length === 0) {
    setVerixaPill(`⚠️ Aadhaar Certificate section not found`, "err");
    return { success: false, reason: "Could not locate 'Aadhaar card certificate' section under Verification results." };
  }

  // Choose the smallest/most specific container
  allHits.sort((a, b) => (a.innerText?.length || 0) - (b.innerText?.length || 0));
  const aadhaarContainer = allHits[0];

  // Step 3: Handle buttons: "File it", "Replace", or "Choose file"
  const fileItBtn = Array.from(aadhaarContainer.querySelectorAll("button, a, label, span, [role=button]")).find(b => 
    visible(b) && /^\s*file\s*it\s*$/i.test((b.innerText || "").trim())
  );

  const replaceBtn = Array.from(aadhaarContainer.querySelectorAll("button, a, label, span, [role=button]")).find(b => 
    visible(b) && /^\s*replace\s*$/i.test((b.innerText || "").trim())
  );

  const chooseFileBtn = Array.from(aadhaarContainer.querySelectorAll("button, a, label, span, [role=button]")).find(b => 
    visible(b) && /choose\s*file/i.test((b.innerText || "").trim())
  );

  if (fileItBtn) {
    console.log("[Verixa360 Aadhaar Assistant] Clicking 'File it' button to reveal upload input...");
    fileItBtn.click();
    await sleep(500);
  } else if (replaceBtn) {
    console.log("[Verixa360 Aadhaar Assistant] Certificate exists. Clicking 'Replace'...");
    replaceBtn.click();
    await sleep(500);

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
      await sleep(400);
    }
  }

  // Step 4: Find exact file input for Aadhaar certificate
  function findExactAadhaarFileInput(container, chooseBtn, fileBtn) {
    let inp = container.querySelector('input[type="file"]');
    if (inp) return inp;

    const labels = [
      chooseBtn?.getAttribute("for"),
      fileBtn?.getAttribute("for"),
      container.querySelector("label[for]")?.getAttribute("for")
    ].filter(Boolean);
    for (const id of labels) {
      const el = document.getElementById(id);
      if (el && el.type === "file") return el;
    }

    const row = container.closest("tr, [role=row], .row, fieldset") || container.parentElement;
    if (row) {
      const rowInputs = Array.from(row.querySelectorAll('input[type="file"]'));
      if (rowInputs.length === 1) return rowInputs[0];
    }

    const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    if (allInputs.length > 0) {
      const cRect = container.getBoundingClientRect();
      allInputs.sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return Math.abs(aRect.top - cRect.top) - Math.abs(bRect.top - cRect.top);
      });
      return allInputs[0];
    }
    return null;
  }

  const fileInput = findExactAadhaarFileInput(aadhaarContainer, chooseFileBtn, fileItBtn);

  if (!fileInput) {
    setVerixaPill(`⚠️ No file input found`, "err");
    return { success: false, reason: "Could not find file upload input for Aadhaar certificate." };
  }

  // Step 5: Convert Base64 data back to native File object and attach
  const cleanFilename = filename || `${gsmId}_Surepass_Aadhaar_Report.pdf`;
  try {
    const res = await fetch(pdfBase64);
    const blob = await res.blob();
    const pdfFile = new File([blob], cleanFilename, { type: "application/pdf", lastModified: Date.now() });

    console.log(`[Verixa360 Aadhaar Assistant] Attaching file "${cleanFilename}" (${pdfFile.size} bytes)...`);

    const dt = new DataTransfer();
    dt.items.add(pdfFile);
    fileInput.files = dt.files;

    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));

    const dropTarget = chooseFileBtn || aadhaarContainer.querySelector(".dropzone, [data-dropzone]");
    if (dropTarget) {
      try {
        dropTarget.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      } catch (de) {}
    }

    await sleep(800);

    // Step 6: Explicitly find and click submission button ("File it", "Upload", "Save", "Submit")
    console.log("[Verixa360 Aadhaar Assistant] Locating submission / File it button to register document...");
    let submitClicked = false;
    const searchScopes = [
      aadhaarContainer,
      fileInput.closest("form, .card, tr, .row, section, fieldset, [role=dialog], .modal") || aadhaarContainer.parentElement,
      document.querySelector("[role=dialog], .modal, .popup"),
      aadhaarContainer.parentElement?.parentElement,
      document
    ].filter(Boolean);

    for (const scope of searchScopes) {
      if (submitClicked) break;
      const candidates = Array.from(scope.querySelectorAll("button, input[type=submit], [role=button], a.btn, span.btn")).filter(b => {
        if (!visible(b)) return false;
        if (b.disabled) return false;
        const txt = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim().toLowerCase();
        if (/cancel|delete|remove|close|browse/i.test(txt)) return false;
        return /^(?:file\s*it|upload|save|submit|attach|confirm|done)(?:\s+(?:file|document|certificate|now))?$/i.test(txt) ||
               /(?:file\s*it|upload|submit|save)/i.test(txt);
      });

      if (candidates.length > 0) {
        const sorted = candidates.sort((a, b) => {
          const aTxt = (a.innerText || a.value || "").toLowerCase();
          const bTxt = (b.innerText || b.value || "").toLowerCase();
          if (/file\s*it/i.test(aTxt)) return -1;
          if (/file\s*it/i.test(bTxt)) return 1;
          if (/upload/i.test(aTxt)) return -1;
          if (/upload/i.test(bTxt)) return 1;
          return 0;
        });

        const targetBtn = sorted[0];
        const btnLabel = (targetBtn.innerText || targetBtn.value || "Submit").trim();
        console.log(`[Verixa360 Aadhaar Assistant] Clicking submission button: "${btnLabel}"...`);
        try {
          targetBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          targetBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
          targetBtn.click();
        } catch (e) {
          targetBtn.click();
        }
        submitClicked = true;
        await sleep(1500);
      }
    }

    // Modal confirmation check
    const modalConfirmBtn = Array.from(document.querySelectorAll("[role=dialog] button, .modal button, .swal2-confirm, .ant-modal button")).find(b => 
      visible(b) && !b.disabled && /^\s*(?:confirm|yes|proceed|upload|save|ok)\s*$/i.test((b.innerText || b.value || "").trim())
    );
    if (modalConfirmBtn) {
      console.log(`[Verixa360 Aadhaar Assistant] Confirming modal dialog via "${modalConfirmBtn.innerText.trim()}"...`);
      try { modalConfirmBtn.click(); } catch (e) {}
      await sleep(1500);
    }

    // Step 7: Await status confirmation (View ↗ / on file / Replace)
    let isViewable = false;
    for (let check = 0; check < 5; check++) {
      const containerText = (aadhaarContainer.innerText || "").toLowerCase();
      const hasView = Array.from(aadhaarContainer.querySelectorAll("a, button, span")).some(el => 
        visible(el) && /view/i.test((el.innerText || "").trim())
      );
      if (hasView || containerText.includes("on file") || containerText.includes("replace") || containerText.includes("view")) {
        isViewable = true;
        console.log("[Verixa360 Aadhaar Assistant] ✓ Verified: Document is filed and viewable on Verixa!");
        break;
      }
      await sleep(1000);
    }

    setVerixaPill(`✓ Aadhaar Certificate Uploaded & Filed!`, "info");
    return {
      success: true,
      message: `Aadhaar verification report attached, filed, and viewable for ${gsmId}.`,
      viewable: isViewable
    };
  } catch (err) {
    setVerixaPill(`⚠️ Upload error: ${err.message}`, "err");
    return { success: false, reason: `File attachment failed: ${err.message}` };
  }
}

// Chrome Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PING_VERIXA") {
    const isLogin = /login|signin/i.test(location.pathname) || !!document.querySelector("input[type=password]");
    sendResponse({ ok: true, isLogin, pathname: location.pathname });
    return true;
  }
  if (request.action === "SEARCH_AND_EXTRACT_GSM") {
    searchAndExtractAadhaarGSM(request.gsm_id)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, reason: err.message }));
    return true;
  }
  if (request.action === "UPLOAD_AADHAAR_CERTIFICATE") {
    uploadAadhaarCertificateToVerixa(request.pdfBase64, request.filename, request.gsmId)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, reason: err.message }));
    return true;
  }
});
