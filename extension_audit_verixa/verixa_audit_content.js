/**
 * Verixa Document Auditor Content Script
 * Scans candidate's "Verification results" section on Verixa360 to detect:
 * 1. If "Aadhaar verification certificate" has a misplaced DL report attached.
 * 2. Current state of "Driving licence certificate".
 */

console.log("[Verixa Auditor] Content script loaded on Verixa360.");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function visible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
}

function getSearchBox() {
  const inputs = Array.from(document.querySelectorAll('input'));
  let b = inputs.find(i => /driver|mobile|ref|gsm|search|query/i.test((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
  if (b) return b;
  b = inputs.find(i => i.type === 'search');
  if (b) return b;
  b = inputs.find(i => (!i.type || i.type === 'text') && !/password|date|check|radio|file|submit/i.test(i.type));
  return b || null;
}

function setInputValue(input, value) {
  if (!input) return;
  input.focus();
  input.select();
  let typed = false;
  try { typed = document.execCommand('insertText', false, value); } catch (e) {}
  if (!typed || input.value !== value) {
    const prev = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (prev) prev.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function findCandidateElement(gsmId) {
  const cleanGsm = gsmId.trim();
  const lowerGsm = cleanGsm.toLowerCase();
  
  // Look for direct link or table cell containing GSM ID
  const allElements = Array.from(document.querySelectorAll("a, tr, td, div[role='row'], li")).filter(el => {
    if (!visible(el)) return false;
    const txt = (el.innerText || "").toLowerCase();
    return txt.includes(lowerGsm);
  });

  if (allElements.length === 0) return null;

  // Prefer anchor link with /applications/
  const appLink = allElements.find(el => {
    if (el.tagName === 'A' && (el.href || '').includes('/applications/')) return true;
    return !!el.querySelector("a[href*='/applications/']");
  });
  if (appLink) return appLink.tagName === 'A' ? appLink : appLink.querySelector("a[href*='/applications/']");

  // Otherwise return the smallest matching container
  allElements.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
  return allElements[0];
}

async function auditCandidateOnVerixa(gsmId) {
  console.log(`[Verixa Auditor] Auditing GSM: ${gsmId}`);

  // Step 1: Search GSM
  const box = getSearchBox();
  if (box) {
    setInputValue(box, gsmId);
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

    const searchBtn = Array.from(document.querySelectorAll('button, a, [role=button]')).find(b => 
      visible(b) && /search|find|filter|apply/i.test(b.innerText || b.getAttribute('aria-label') || '')
    );
    if (searchBtn) {
      try { searchBtn.click(); } catch (e) {}
    }
  }

  // Step 2: Poll for candidate row (up to 7s)
  let targetEl = null;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 7000) {
    targetEl = findCandidateElement(gsmId);
    if (targetEl) break;
    await sleep(350);
  }

  if (!targetEl) {
    return {
      success: false,
      gsm_id: gsmId,
      reason: "Candidate row not found in search results on Verixa360."
    };
  }

  // Step 3: Open / click candidate
  try {
    if (targetEl.tagName === 'A' && targetEl.target === '_blank') targetEl.target = '_self';
    const childLink = targetEl.querySelector('a');
    if (childLink && childLink.target === '_blank') childLink.target = '_self';
    if (targetEl.scrollIntoView) targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
    targetEl.click();
  } catch (e) {}

  await sleep(1500);

  // Look for expanded row or click again if details panel loads below
  const subTarget = findCandidateElement(gsmId);
  if (subTarget && subTarget !== targetEl) {
    try {
      if (subTarget.scrollIntoView) subTarget.scrollIntoView({ block: "center", behavior: "smooth" });
      subTarget.click();
      await sleep(1000);
    } catch (e) {}
  }

  // Step 4: Scroll to "Verification results"
  const verifHeaders = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, div, span, p, b, strong")).filter(el => 
    visible(el) && /verification\s*results/i.test((el.innerText || "").trim())
  );
  if (verifHeaders.length > 0 && verifHeaders[0].scrollIntoView) {
    verifHeaders[0].scrollIntoView({ block: "center", behavior: "smooth" });
  } else {
    window.scrollBy({ top: 400, behavior: "smooth" });
  }
  await sleep(800);

  // Step 5: Read Candidate Name from page
  let candidateName = "-";
  const nameMatch = (document.body.innerText || "").match(/(?:name\s*on\s*aadhaar|candidate\s*name)\s*[:\-]?\s*([A-Za-z\s]{2,40})/i);
  if (nameMatch) candidateName = nameMatch[1].split("\n")[0].trim();

  // Step 6: Inspect "Aadhaar verification certificate" row
  const allAadhaarHeadings = Array.from(document.querySelectorAll("div, h1, h2, h3, h4, h5, span, p, label, b, strong")).filter(el => {
    if (!visible(el)) return false;
    const txt = (el.innerText || "").toLowerCase().trim();
    return /aadhaar\s*verification\s*certificate/i.test(txt) && el.children.length === 0;
  });

  let aadhaarStatus = "Not Found";
  let aadhaarFilename = "-";
  let isAadhaarMisplaced = false;

  if (allAadhaarHeadings.length > 0) {
    const aHeading = allAadhaarHeadings[0];
    let aRow = aHeading.parentElement;
    // Ascend strictly within Aadhaar section container
    while (aRow && aRow !== document.body) {
      const parent = aRow.parentElement;
      if (!parent) break;
      const pTxt = (parent.innerText || "").toLowerCase();
      if (pTxt.includes("driving licence") || pTxt.includes("crc response") || pTxt.includes("pcc")) break;
      aRow = parent;
      if (aRow.querySelector('input[type="file"]') || /on\s*file|view|replace|not\s*yet\s*received/i.test(aRow.innerText || "")) {
        break;
      }
    }
    if (!aRow) aRow = aHeading.parentElement;

    const rowText = (aRow ? aRow.innerText : "");
    const lowerText = rowText.toLowerCase();

    // Check for filename inside aRow (e.g. GSM-FLS-... DL REPORT.pdf)
    const fileMatches = rowText.match(/([^\s\n\r]+\.(?:pdf|png|jpe?g))/gi) || [];
    const directFile = fileMatches[0] || "";

    // Check if on file
    const hasView = Array.from(aRow.querySelectorAll("a, button, span")).some(el => visible(el) && /view/i.test((el.innerText || "").trim()));
    const onFile = lowerText.includes("on file") || hasView || lowerText.includes("replace");

    // Critical Bug Check: Is the attached file a DL report?
    const mentionsDl = /dl\s*report|surepass_dl|_dl_report|driving\s*licen/i.test(lowerText) || /dl\s*report/i.test(directFile);

    if (onFile && mentionsDl) {
      aadhaarStatus = "⚠️ MISPLACED DL REPORT";
      isAadhaarMisplaced = true;
      aadhaarFilename = directFile || (rowText.match(/[\w-]+\s*[\w*]+\s*DL\s*REPORT\.pdf/i) || ["DL Report Found"])[0];
    } else if (onFile) {
      aadhaarStatus = "Clean (Aadhaar on File)";
      isAadhaarMisplaced = false;
      aadhaarFilename = directFile || "Aadhaar Document";
    } else if (lowerText.includes("not yet received")) {
      aadhaarStatus = "Clean (Not Yet Received)";
      isAadhaarMisplaced = false;
      aadhaarFilename = "-";
    } else {
      aadhaarStatus = "Pending / Empty";
      isAadhaarMisplaced = false;
      aadhaarFilename = "-";
    }
  }

  // Step 7: Inspect "Driving licence certificate" row
  const allDlHeadings = Array.from(document.querySelectorAll("div, h1, h2, h3, h4, h5, span, p, label, b, strong")).filter(el => {
    if (!visible(el)) return false;
    const txt = (el.innerText || "").toLowerCase().trim();
    return /driving\s*licen[sc]e\s*certificate/i.test(txt) && el.children.length === 0;
  });

  let dlStatus = "Not Found";
  let dlFilename = "-";

  if (allDlHeadings.length > 0) {
    const dHeading = allDlHeadings[0];
    let dRow = dHeading.parentElement;
    while (dRow && dRow !== document.body) {
      const parent = dRow.parentElement;
      if (!parent) break;
      const pTxt = (parent.innerText || "").toLowerCase();
      if (pTxt.includes("aadhaar") || pTxt.includes("crc response") || pTxt.includes("pcc")) break;
      dRow = parent;
      if (dRow.querySelector('input[type="file"]') || /on\s*file|view|replace|not\s*yet\s*received/i.test(dRow.innerText || "")) {
        break;
      }
    }
    if (!dRow) dRow = dHeading.parentElement;

    const dRowText = (dRow ? dRow.innerText : "");
    const dLower = dRowText.toLowerCase();
    const dFileMatches = dRowText.match(/([^\s\n\r]+\.(?:pdf|png|jpe?g))/gi) || [];
    dlFilename = dFileMatches[0] || "-";

    const dHasView = Array.from(dRow.querySelectorAll("a, button, span")).some(el => visible(el) && /view/i.test((el.innerText || "").trim()));
    if (dLower.includes("on file") || dHasView || dLower.includes("replace")) {
      dlStatus = "On File";
    } else if (dLower.includes("not yet received")) {
      dlStatus = "Not Yet Received";
    } else {
      dlStatus = "Pending";
    }
  }

  return {
    success: true,
    gsm_id: gsmId,
    candidate_name: candidateName,
    aadhaar_status: aadhaarStatus,
    aadhaar_filename: aadhaarFilename,
    is_aadhaar_misplaced: isAadhaarMisplaced,
    dl_status: dlStatus,
    dl_filename: dlFilename,
    verixa_url: window.location.href
  };
}

// Chrome Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PING_VERIXA") {
    sendResponse({ ok: true, url: window.location.href });
    return true;
  }
  if (request.action === "AUDIT_GSM") {
    auditCandidateOnVerixa(request.gsm_id)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, gsm_id: request.gsm_id, reason: err.message }));
    return true;
  }
});
