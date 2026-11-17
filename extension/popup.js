// popup.js - Automation Runner & Central Sync Manager
let isAutomating = false;
let defaultBackendUrl = "http://192.168.100.193:8002";

// Helper: Append log line
function log(msg, type = "info") {
  const term = document.getElementById("termLog");
  if (!term) return;
  const d = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  if (type === "err") d.className = "log-err";
  else if (type === "warn") d.className = "log-warn";
  else d.className = "log-info";
  d.innerText = `[${time}] ${msg}`;
  term.appendChild(d);
  term.scrollTop = term.scrollHeight;
}

// Helper: Sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Audio Chime on Completion
function playCompletionChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {}
}

// Get configured backend URL
async function getBackendUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["backendUrl"], (res) => {
      resolve(res.backendUrl || defaultBackendUrl);
    });
  });
}

// Fetch Server Status
async function checkServerStatus() {
  const backend = await getBackendUrl();
  const connBadge = document.getElementById("connBadge");
  try {
    const res = await fetch(`${backend}/api/extension/status`, { cache: "no-store" });
    if (!res.ok) throw new Error("Server returned " + res.status);
    const data = await res.json();

    connBadge.className = "status-badge status-online";
    connBadge.innerText = "🟢 Connected";

    if (data.has_job) {
      document.getElementById("jobIdText").innerText = data.filename || "Active Batch";
      document.getElementById("jobFileText").innerText = "Ready to verify";
      const stats = data.statistics || {};
      const pending = (stats.pending || 0) + (stats.processing || 0);
      const total = stats.total || 0;
      document.getElementById("pendingCountBadge").innerText = `${pending} / ${total} Pending`;
    } else {
      document.getElementById("jobIdText").innerText = "No File Loaded";
      document.getElementById("jobFileText").innerText = "Upload Excel in dashboard first";
      document.getElementById("pendingCountBadge").innerText = "0 Pending";
    }
    return true;
  } catch (err) {
    connBadge.className = "status-badge status-offline";
    connBadge.innerText = "🔴 Disconnected";
    return false;
  }
}

// Main Automation Loop with Full Fallback Protection
async function runAutomationLoop() {
  const backend = await getBackendUrl();
  isAutomating = true;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;
  log("🚀 Starting batch verification loop...", "info");

  while (isAutomating) {
    // 1. Locate and Focus Surepass tab across all Chrome windows
    let tab = null;
    const allTabs = await chrome.tabs.query({});
    const surepassTabs = allTabs.filter(t => t.url && t.url.includes("console.surepass.app"));

    if (surepassTabs.length > 0) {
      // Prioritize the Driving License service tab if open
      const dlTabs = surepassTabs.filter(t => t.url.includes("driving-license"));
      tab = dlTabs.length > 0 ? dlTabs[0] : surepassTabs[0];

      // Check if logged out
      if (tab.url.includes("/login") || tab.url.includes("/auth")) {
        log("⚠️ Surepass session expired. Please log in on the Surepass tab!", "warn");
        await sleep(4000);
        continue;
      }

      try {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (e) {}
    } else {
      log("⚠️ Opening Surepass Driving License tab in Chrome...", "warn");
      try {
        tab = await chrome.tabs.create({ url: "https://console.surepass.app/services/driving-license" });
        await sleep(5000);
      } catch (e) {
        await sleep(3000);
        continue;
      }
    }

    // 2. Fetch next pending driver from central server (with auto-retry)
    let driverData = null;
    let fetchAttempts = 0;
    while (fetchAttempts < 3 && isAutomating) {
      try {
        const res = await fetch(`${backend}/api/extension/next_driver`, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        driverData = await res.json();
        break;
      } catch (e) {
        fetchAttempts++;
        if (fetchAttempts >= 3) {
          log(`Server communication notice: ${e.message}. Retrying in 4s...`, "warn");
          await sleep(4000);
        } else {
          await sleep(1000);
        }
      }
    }

    if (!driverData) continue;

    if (!driverData.has_driver) {
      log("🎉 All drivers in queue have been verified!", "info");
      playCompletionChime();
      isAutomating = false;
      break;
    }

    // 3. Update UI Card
    const maskDl = (dl) => {
      if (!dl || dl.length <= 6) return dl || "-";
      return dl.substring(0, 4) + "****" + dl.slice(-2);
    };

    document.getElementById("curGsmId").innerText = driverData.gsm_id || "-";
    document.getElementById("curDlNumber").innerText = maskDl(driverData.dl_number);
    document.getElementById("curPhone").innerText = driverData.phone_number || "-";
    document.getElementById("curDob").innerText = driverData.dob || "-";
    document.getElementById("pendingCountBadge").innerText = `${driverData.pending_count} Pending`;

    log(`Processing Row ${driverData.row_index}: ${driverData.gsm_id} (DL: ${driverData.dl_number})`, "info");

    // 4. Send command to Content Script (with automatic injection fallback)
    let result = null;
    let sendAttempts = 0;

    while (sendAttempts < 2 && isAutomating) {
      try {
        result = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { action: "VERIFY_DRIVER", driver: driverData }, (response) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(response);
          });
        });
        break;
      } catch (err) {
        sendAttempts++;
        log("⚡ Auto-connecting automation engine to Surepass tab...", "info");
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
          });
          await sleep(1000);
        } catch (injectErr) {
          log("Notice: Please refresh the Surepass page (F5) once!", "warn");
          await sleep(3000);
        }
      }
    }

    if (!isAutomating) break;

    const finalStatus = (result && result.status) ? result.status : "Verification Error";
    const remarks = (result && result.remarks) ? result.remarks : "Automated via Surepass Assistant";
    const reportFilename = (result && result.report_filename) ? result.report_filename : `${driverData.gsm_id}_${driverData.phone_number}_DL_Report.pdf`;

    log(`Outcome: ${finalStatus} (${remarks})`, finalStatus === "Verified" ? "info" : "warn");

    // 5. Submit result back to central server (updates SQLite DB & Excel)
    try {
      const subRes = await fetch(`${backend}/api/extension/submit_result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_id: driverData.record_id,
          verification_status: finalStatus,
          remarks: remarks,
          report_filename: reportFilename
        })
      });
      const subJson = await subRes.json();
      log(`✓ Synced Row ${driverData.row_index} to central dashboard!`, "info");

      // Auto-download local copy for colleague into Downloads/Surepass_DL_Reports
      const downloadUrl = subJson.download_url ? `${backend}${subJson.download_url}` : `${backend}/api/reports/download/${subJson.report_filename || reportFilename}`;
      const finalPdfName = subJson.report_filename || reportFilename;

      chrome.runtime.sendMessage({
        action: "DOWNLOAD_REPORT",
        url: downloadUrl,
        filename: finalPdfName,
        subfolder: "Surepass_DL_Reports"
      }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn("Auto-download notice:", chrome.runtime.lastError.message);
        } else if (res && res.success) {
          log(`📥 Saved doc: Downloads/${res.path}`, "info");
        }
      });
    } catch (err) {
      log(`Failed syncing result to server: ${err.message}`, "err");
    }

    // Delay between successive records
    await sleep(2000);
  }

  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
  log("⏹️ Automation loop ended.", "info");
  checkServerStatus();
}

// Event Listeners
document.addEventListener("DOMContentLoaded", async () => {
  let backend = await getBackendUrl();
  const input = document.getElementById("backendUrl");

  // Auto-detect Cloudflare tunnel or active dashboard tab
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.url && (t.url.includes(".trycloudflare.com") || t.url.includes("railway.app") || t.url.includes("onrender.com"))) {
        const detectedOrigin = new URL(t.url).origin;
        backend = detectedOrigin;
        chrome.storage.local.set({ backendUrl: detectedOrigin });
        break;
      }
    }
  } catch (e) {}

  if (input) input.value = backend;

  checkServerStatus();
  setInterval(checkServerStatus, 5000);

  document.getElementById("btnSaveConfig").addEventListener("click", () => {
    const val = input.value.trim().replace(/\/+$/, "");
    if (!val) return;
    chrome.storage.local.set({ backendUrl: val }, () => {
      log(`Backend updated to: ${val}`, "info");
      checkServerStatus();
    });
  });

  document.getElementById("btnStart").addEventListener("click", () => {
    if (!isAutomating) runAutomationLoop();
  });

  document.getElementById("btnStop").addEventListener("click", () => {
    isAutomating = false;
    log("Stopping after current record...", "warn");
  });

  const linkDash = document.getElementById("linkDashboard");
  if (linkDash) {
    linkDash.addEventListener("click", async (e) => {
      e.preventDefault();
      const b = await getBackendUrl();
      chrome.tabs.create({ url: b });
    });
  }

  const linkZip = document.getElementById("linkDownloadZip");
  if (linkZip) {
    linkZip.addEventListener("click", async (e) => {
      e.preventDefault();
      const b = await getBackendUrl();
      chrome.downloads.download({
        url: `${b}/api/reports/zip`,
        filename: `Surepass_DL_Reports/All_Verification_Reports_${Date.now()}.zip`,
        saveAs: false
      });
      log("📥 Downloading all documents ZIP to Downloads/Surepass_DL_Reports/...", "info");
    });
  }
});
