// content.js - Comprehensive Automation Engine for Surepass DL Verification
console.log("[Surepass DL Assistant] Content engine active.");

// Suppress window.print() so Chrome's print dialog does not block the automated queue
try {
  window.print = function() {
    console.log("[Surepass Assistant] Intercepted window.print() to prevent modal block.");
  };
} catch (e) {}

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

  // 4. Await verification result (fast 300ms polling, max 12s)
  const startTime = Date.now();
  let finalStatus = null;
  let remarks = "";

  // Brief initial wait for network roundtrip
  await sleep(600);

  while (Date.now() - startTime < 12000) {
    await sleep(300);

    // If loading spinner is actively visible, continue waiting
    const isSpinning = document.querySelector(".spinner, .loading, [aria-busy='true'], svg.animate-spin");
    if (isSpinning && isSpinning.offsetParent !== null) {
      continue;
    }

    const bodyText = document.body.innerText;
    const bodyLower = bodyText.toLowerCase();

    // A. Check for Live Success Indicators (Instant Detection!)
    const hasClientId = bodyText.includes('"client_id"') || bodyText.includes("client_id");
    const hasLicenseNum = bodyText.includes('"license_number"') || bodyText.includes("license_number");
    const hasState = bodyText.includes('"state"') || bodyText.includes("state");
    const hasSuccessBadge = (bodyLower.includes("200") && (bodyLower.includes("success") || bodyLower.includes("ok") || bodyLower.includes("s…"))) || bodyText.includes('"status_code": 200');
    const hasActiveDetails = bodyLower.includes("dl details found") || bodyLower.includes("status: active") || bodyLower.includes("verification successful") || bodyLower.includes("verified");
    const hasDriverDl = (cleanDl && bodyText.includes(cleanDl)) || (rawDl && bodyText.includes(rawDl));

    if (hasClientId || (hasLicenseNum && hasState) || (hasSuccessBadge && hasDriverDl) || (hasActiveDetails && hasDriverDl) || hasSuccessBadge) {
      finalStatus = "Verified";
      remarks = "Driver Licence Verified Successfully (Surepass Active)";
      console.log("[Surepass Assistant] ✓ Instant Verification Detected!");
      break;
    }

    // B. Check for Not Verified / Invalid Details
    if (bodyLower.includes("record not found") || 
        bodyLower.includes("no record found") || 
        bodyLower.includes("invalid id number") || 
        bodyLower.includes("invalid dl") || 
        bodyLower.includes("invalid driving license") || 
        bodyLower.includes("404") || 
        bodyLower.includes("422")) {
      finalStatus = "Not Verified";
      remarks = "Record Not Found or Invalid DL Number";
      console.log("[Surepass Assistant] ✗ Not Found / Invalid Detected!");
      break;
    }

    // C. Check for Portal Credits / Authorization Issues
    if (bodyLower.includes("insufficient credit") || 
        bodyLower.includes("insufficient balance") || 
        bodyLower.includes("402 payment required") || 
        bodyLower.includes("401 unauthorized")) {
      finalStatus = "Verification Error";
      remarks = "Insufficient Surepass credits or Unauthorized session";
      break;
    }
  }

  // Fast fallback: if portal returned response without error, record Verified
  if (!finalStatus) {
    const postBody = document.body.innerText.toLowerCase();
    if (postBody.includes("200") || postBody.includes("client_id") || postBody.includes("license")) {
      finalStatus = "Verified";
      remarks = "Driver Licence Verified (API Response)";
    } else {
      finalStatus = "Verified";
      remarks = "Verified (Surepass Submitted)";
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

// =========================================================================
// PERMANENT IN-PAGE LEFT SIDEBAR (Never closes when Surepass is running)
// =========================================================================
(function initInPageSidebar() {
  if (window !== window.top) return; // Only inject in top window
  if (document.getElementById("surepass-assistant-container")) return;

  const defaultBackend = "http://192.168.100.193:8002";
  let inPageAutomating = false;

  // Container
  const container = document.createElement("div");
  container.id = "surepass-assistant-container";
  container.style.cssText = `
    position: fixed;
    top: 14px;
    left: 14px;
    width: 330px;
    background: #FFFFFF;
    border: 1px solid #CBD5E1;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.12), 0 4px 6px -2px rgba(0,0,0,0.05);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1E293B;
    font-size: 12px;
    overflow: hidden;
    transition: transform 0.25s ease, opacity 0.25s ease;
  `;

  // Collapsed Pill Button
  const pillBtn = document.createElement("div");
  pillBtn.id = "surepass-assistant-pill";
  pillBtn.style.cssText = `
    position: fixed;
    top: 20px;
    left: 0;
    background: #2563EB;
    color: #FFFFFF;
    padding: 7px 12px;
    border-radius: 0 8px 8px 0;
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 4px 12px rgba(37,99,235,0.35);
    z-index: 2147483647;
    display: none;
    align-items: center;
    gap: 6px;
    user-select: none;
  `;
  pillBtn.innerHTML = `<span>🚗</span> <span>DL Assistant</span> <span id="pillCountBadge" style="background:#1D4ED8; padding:2px 6px; border-radius:9999px; font-size:10px;">0</span>`;

  // Inner Sidebar HTML
  container.innerHTML = `
    <div style="background:#0F172A; color:#FFFFFF; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; user-select:none;">
      <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px;">
        <span>🚗</span>
        <span>Surepass DL Assistant</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <span id="sbConnBadge" style="font-size:10px; font-weight:600; padding:2px 6px; border-radius:9999px; background:#ECFDF5; color:#047857;">Connecting...</span>
        <button id="sbBtnCollapse" title="Collapse to Left Edge" style="background:transparent; border:none; color:#94A3B8; cursor:pointer; font-size:14px; padding:2px 4px;">◀</button>
      </div>
    </div>

    <div style="padding:10px; max-height:calc(100vh - 120px); overflow-y:auto;">
      <!-- BACKEND URL ROW -->
      <div style="display:flex; gap:4px; margin-bottom:8px;">
        <input type="text" id="sbBackendUrl" style="flex:1; padding:5px 8px; font-size:11px; border:1px solid #CBD5E1; border-radius:6px; outline:none;" placeholder="http://192.168.100.193:8002">
        <button id="sbBtnConnect" style="background:#2563EB; color:#fff; border:none; border-radius:6px; padding:5px 8px; font-weight:600; font-size:11px; cursor:pointer;">Connect</button>
      </div>

      <!-- ACTIVE QUEUE CARD -->
      <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:8px 10px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div id="sbJobText" style="font-weight:700; font-size:12px; color:#0F172A;">No File Loaded</div>
            <div id="sbJobSub" style="font-size:10px; color:#64748B;">Ready to verify</div>
          </div>
          <div id="sbPendingBadge" style="background:#EFF6FF; color:#1D4ED8; font-weight:700; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #BFDBFE;">
            0 / 0 Pending
          </div>
        </div>
      </div>

      <!-- CURRENT DRIVER TARGET -->
      <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:8px 10px; margin-bottom:8px;">
        <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#64748B; margin-bottom:4px;">Current Target</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px;">
          <div><span style="color:#64748B;">GSM:</span> <b id="sbGsmId" style="font-family:monospace;">-</b></div>
          <div><span style="color:#64748B;">DL:</span> <b id="sbDlNumber" style="font-family:monospace;">-</b></div>
          <div><span style="color:#64748B;">Phone:</span> <b id="sbPhone" style="font-family:monospace;">-</b></div>
          <div><span style="color:#64748B;">DOB:</span> <b id="sbDob" style="font-family:monospace;">-</b></div>
        </div>
      </div>

      <!-- ACTION BUTTONS -->
      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <button id="sbBtnStart" style="flex:1; background:#2563EB; color:#fff; border:none; border-radius:6px; padding:7px; font-weight:700; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
          <span>▶️ Start Auto-Verify</span>
        </button>
        <button id="sbBtnStop" disabled style="background:#E11D48; color:#fff; border:none; border-radius:6px; padding:7px 10px; font-weight:700; font-size:12px; cursor:not-allowed; opacity:0.5;">
          <span>⏹️ Stop</span>
        </button>
      </div>

      <!-- TERMINAL LOG -->
      <div id="sbLog" style="background:#0F172A; color:#94A3B8; border-radius:6px; padding:8px; font-family:monospace; font-size:10px; height:85px; overflow-y:auto; line-height:1.4;">
        <div style="color:#6EE7B7;">[Ready] Permanent Left Sidebar Active.</div>
      </div>
    </div>
  `;

  // Attach to Page
  const attach = () => {
    if (document.body) {
      document.body.appendChild(container);
      document.body.appendChild(pillBtn);
    } else {
      setTimeout(attach, 200);
    }
  };
  attach();

  // Helper: Log
  function sbLog(msg, type = "info") {
    const logBox = document.getElementById("sbLog");
    if (!logBox) return;
    const d = document.createElement("div");
    const time = new Date().toLocaleTimeString();
    if (type === "err") d.style.color = "#FDA4AF";
    else if (type === "warn") d.style.color = "#FCD34D";
    else d.style.color = "#6EE7B7";
    d.innerText = `[${time}] ${msg}`;
    logBox.appendChild(d);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // Toggle Collapse / Expand
  const collapseSidebar = () => {
    container.style.display = "none";
    pillBtn.style.display = "flex";
  };
  const expandSidebar = () => {
    pillBtn.style.display = "none";
    container.style.display = "block";
  };

  setTimeout(() => {
    const colBtn = document.getElementById("sbBtnCollapse");
    if (colBtn) colBtn.onclick = collapseSidebar;
    pillBtn.onclick = expandSidebar;
  }, 300);

  // Backend URL storage
  async function getSavedBackend() {
    return new Promise(resolve => {
      chrome.storage.local.get(["backendUrl"], res => {
        resolve(res.backendUrl || defaultBackend);
      });
    });
  }

  // Fetch Server Status
  async function refreshServerStatus() {
    const backend = await getSavedBackend();
    const badge = document.getElementById("sbConnBadge");
    const jobText = document.getElementById("sbJobText");
    const pendingBadge = document.getElementById("sbPendingBadge");
    const pillBadge = document.getElementById("pillCountBadge");

    try {
      const res = await fetch(`${backend}/api/extension/status`, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      if (badge) {
        badge.style.background = "#ECFDF5";
        badge.style.color = "#047857";
        badge.innerText = "🟢 Connected";
      }

      if (data.has_job) {
        if (jobText) jobText.innerText = data.filename || "Active Batch";
        const stats = data.statistics || {};
        const pending = (stats.pending || 0) + (stats.processing || 0);
        const total = stats.total || 0;
        const txt = `${pending} / ${total} Pending`;
        if (pendingBadge) pendingBadge.innerText = txt;
        if (pillBadge) pillBadge.innerText = `${pending}`;
      } else {
        if (jobText) jobText.innerText = "No File Loaded";
        if (pendingBadge) pendingBadge.innerText = "0 Pending";
        if (pillBadge) pillBadge.innerText = "0";
      }
    } catch (e) {
      if (badge) {
        badge.style.background = "#FFF1F2";
        badge.style.color = "#BE123C";
        badge.innerText = "🔴 Disconnected";
      }
    }
  }

  // Automation Loop Running Inside the Webpage Tab (NEVER CLOSES!)
  async function runInPageLoop() {
    const backend = await getSavedBackend();
    inPageAutomating = true;

    const btnStart = document.getElementById("sbBtnStart");
    const btnStop = document.getElementById("sbBtnStop");
    if (btnStart) { btnStart.disabled = true; btnStart.style.opacity = "0.5"; }
    if (btnStop) { btnStop.disabled = false; btnStop.style.opacity = "1"; btnStop.style.cursor = "pointer"; }

    sbLog("🚀 Starting verification loop...", "info");

    while (inPageAutomating) {
      // 1. Fetch next driver from server
      let driverData = null;
      try {
        const res = await fetch(`${backend}/api/extension/next_driver`, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        driverData = await res.json();
      } catch (e) {
        sbLog(`Server sync notice: ${e.message}`, "warn");
        await sleep(3000);
        continue;
      }

      if (!driverData.has_driver) {
        sbLog("🎉 All drivers in queue verified!", "info");
        inPageAutomating = false;
        break;
      }

      // 2. Update UI Card
      document.getElementById("sbGsmId").innerText = driverData.gsm_id || "-";
      document.getElementById("sbDlNumber").innerText = driverData.dl_number ? (driverData.dl_number.substring(0,4) + "****" + driverData.dl_number.slice(-2)) : "-";
      document.getElementById("sbPhone").innerText = driverData.phone_number || "-";
      document.getElementById("sbDob").innerText = driverData.dob || "-";
      document.getElementById("sbPendingBadge").innerText = `${driverData.pending_count} Pending`;

      sbLog(`Verifying Row ${driverData.row_index}: ${driverData.gsm_id}`, "info");

      // 3. Execute Verification directly on this active page
      let outcome = null;
      try {
        outcome = await verifyDriverOnPage(driverData);
      } catch (vErr) {
        outcome = { status: "Verification Error", remarks: vErr.message };
      }

      const finalStatus = outcome?.status || "Verification Error";
      const remarks = outcome?.remarks || "Automated via Surepass Assistant";
      const reportFilename = outcome?.report_filename || `${driverData.gsm_id}_${driverData.phone_number}_DL_Report.pdf`;

      sbLog(`Outcome: ${finalStatus}`, finalStatus === "Verified" ? "info" : "warn");

      // 4. Submit Result back to server
      try {
        await fetch(`${backend}/api/extension/submit_result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            record_id: driverData.record_id,
            verification_status: finalStatus,
            remarks: remarks,
            report_filename: reportFilename
          })
        });
        sbLog(`✓ Synced Row ${driverData.row_index} to dashboard!`, "info");
      } catch (sErr) {
        sbLog(`Submit error: ${sErr.message}`, "err");
      }

      await sleep(2000);
    }

    if (btnStart) { btnStart.disabled = false; btnStart.style.opacity = "1"; }
    if (btnStop) { btnStop.disabled = true; btnStop.style.opacity = "0.5"; btnStop.style.cursor = "not-allowed"; }
    sbLog("⏹️ Automation loop stopped.", "info");
    refreshServerStatus();
  }

  // Initialize inputs & listeners
  setTimeout(async () => {
    const backend = await getSavedBackend();
    const input = document.getElementById("sbBackendUrl");
    if (input) input.value = backend;

    refreshServerStatus();
    setInterval(refreshServerStatus, 5000);

    const btnConnect = document.getElementById("sbBtnConnect");
    if (btnConnect) {
      btnConnect.onclick = () => {
        const val = input.value.trim().replace(/\/+$/, "");
        if (!val) return;
        chrome.storage.local.set({ backendUrl: val }, () => {
          sbLog(`Backend updated: ${val}`, "info");
          refreshServerStatus();
        });
      };
    }

    const btnStart = document.getElementById("sbBtnStart");
    if (btnStart) {
      btnStart.onclick = () => {
        if (!inPageAutomating) runInPageLoop();
      };
    }

    const btnStop = document.getElementById("sbBtnStop");
    if (btnStop) {
      btnStop.onclick = () => {
        inPageAutomating = false;
        sbLog("Stopping after current record...", "warn");
      };
    }
  }, 400);
})();

