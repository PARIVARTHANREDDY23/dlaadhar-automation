// popup.js - Manages the extension loop and server synchronization

let isAutomating = false;
let defaultBackendUrl = "http://192.168.100.193:8002";

// Helper: Append log line
function log(msg, type = "info") {
  const term = document.getElementById("termLog");
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
      document.getElementById("pendingCountBadge").innerText = `${pending} Pending`;
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

// Main Automation Loop
async function runAutomationLoop() {
  const backend = await getBackendUrl();
  isAutomating = true;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;
  log("🚀 Starting batch verification loop...", "info");

  while (isAutomating) {
    // 1. Locate Surepass tab
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes("console.surepass.app")) {
      const surepassTabs = await chrome.tabs.query({ url: "*://console.surepass.app/*" });
      if (surepassTabs.length > 0) {
        tab = surepassTabs[0];
        try { chrome.tabs.update(tab.id, { active: true }); } catch (e) {}
      } else {
        log("⚠️ Please open https://console.surepass.app in a Chrome tab!", "warn");
        await sleep(3000);
        continue;
      }
    }

    // 2. Fetch next pending driver from central server
    let driverData = null;
    try {
      const res = await fetch(`${backend}/api/extension/next_driver`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not fetch next driver");
      driverData = await res.json();
    } catch (e) {
      log(`Server communication error: ${e.message}`, "err");
      await sleep(3000);
      continue;
    }

    if (!driverData.has_driver) {
      log("🎉 All drivers in queue have been verified!", "info");
      isAutomating = false;
      break;
    }

    // 3. Update UI Card
    document.getElementById("curGsmId").innerText = driverData.gsm_id;
    document.getElementById("curDlNumber").innerText = driverData.dl_number.substring(0, 4) + "****" + driverData.dl_number.slice(-2);
    document.getElementById("curPhone").innerText = driverData.phone_number;
    document.getElementById("curDob").innerText = driverData.dob || "-";
    document.getElementById("pendingCountBadge").innerText = `${driverData.pending_count} Pending`;

    log(`Processing Row ${driverData.row_index}: ${driverData.gsm_id} (DL: ${driverData.dl_number})`, "info");

    // 4. Send command to Content Script in the open Surepass tab
    let result = null;
    try {
      result = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: "VERIFY_DRIVER", driver: driverData }, (response) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(response);
        });
      });
    } catch (err) {
      log("⚡ Auto-connecting script to Surepass tab...", "info");
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        await sleep(800);
        result = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { action: "VERIFY_DRIVER", driver: driverData }, (response) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(response);
          });
        });
      } catch (retryErr) {
        log(`Notice: Please refresh your Surepass page (press F5)!`, "warn");
        await sleep(4000);
        continue;
      }
    }

    const finalStatus = (result && result.status) ? result.status : "Verification Error";
    const remarks = (result && result.remarks) ? result.remarks : "Automated via Chrome Extension";
    const reportFilename = (result && result.report_filename) ? result.report_filename : `${driverData.gsm_id}_${driverData.phone_number}_DL_Report.pdf`;

    log(`Outcome: ${finalStatus} (${remarks})`, finalStatus === "Verified" ? "info" : "warn");

    // 5. Submit result back to central server (updates SQLite DB & Excel in real time!)
    try {
      const submitRes = await fetch(`${backend}/api/extension/submit_result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_id: driverData.record_id,
          verification_status: finalStatus,
          remarks: remarks,
          report_filename: reportFilename
        })
      });
      if (submitRes.ok) {
        log(`✓ Synced Row ${driverData.row_index} to central server!`, "info");
      }
    } catch (err) {
      log(`Failed syncing result to server: ${err.message}`, "err");
    }

    // Brief delay between successive records
    await sleep(2500);
  }

  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
  log("⏹️ Automation loop ended.", "info");
  checkServerStatus();
}

// Event Listeners
document.addEventListener("DOMContentLoaded", async () => {
  const backend = await getBackendUrl();
  document.getElementById("backendUrl").value = backend;

  document.getElementById("btnSaveConfig").onclick = async () => {
    const url = document.getElementById("backendUrl").value.trim().replace(/\/$/, "");
    chrome.storage.local.set({ backendUrl: url }, () => {
      log(`Connected target updated to: ${url}`);
      checkServerStatus();
    });
  };

  document.getElementById("btnStart").onclick = () => {
    if (!isAutomating) runAutomationLoop();
  };

  document.getElementById("btnStop").onclick = () => {
    isAutomating = false;
    log("Stopping after current record...", "warn");
  };

  document.getElementById("linkDashboard").onclick = async (e) => {
    e.preventDefault();
    const backend = await getBackendUrl();
    chrome.tabs.create({ url: backend });
  };

  checkServerStatus();
  setInterval(checkServerStatus, 5000);
});

