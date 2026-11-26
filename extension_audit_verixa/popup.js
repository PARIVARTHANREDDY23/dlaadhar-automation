/**
 * Verixa Document Auditor Popup Controller
 * Manages the queue of GSM IDs, communicates with Verixa tab, and exports audit findings to Excel.
 */

let auditQueue = [];
let isAuditing = false;
let isPaused = false;
let currentIndex = 0;
let verixaTabId = null;

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await checkVerixaTab();
  await loadStateFromStorage();
  updateUI();
});

function setupEventListeners() {
  document.getElementById("btnParseQueue").addEventListener("click", parsePastedGsmQueue);
  document.getElementById("btnClearQueue").addEventListener("click", clearQueue);
  document.getElementById("btnStartAudit").addEventListener("click", startAudit);
  document.getElementById("btnPauseAudit").addEventListener("click", pauseAudit);
  document.getElementById("btnStopAudit").addEventListener("click", stopAudit);
  document.getElementById("btnExportExcel").addEventListener("click", exportAuditExcel);
  document.getElementById("chkFilterIssuesOnly").addEventListener("change", renderTable);

  const fileInput = document.getElementById("fileExcelUpload");
  document.getElementById("btnUploadFile").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleFileUpload);
}

async function checkVerixaTab() {
  const pill = document.getElementById("verixaStatusPill");
  try {
    const tabs = await chrome.tabs.query({});
    const vTab = tabs.find(t => t.url && (t.url.includes("verixa360.com") || t.url.includes("verixa360.in")));
    if (vTab) {
      verixaTabId = vTab.id;
      pill.className = "status-pill status-ok";
      pill.innerText = "✓ Verixa Tab Connected";
      return true;
    } else {
      pill.className = "status-pill status-warn";
      pill.innerText = "⚠️ Open Verixa360 in Chrome";
      verixaTabId = null;
      return false;
    }
  } catch (e) {
    pill.className = "status-pill status-warn";
    pill.innerText = "Tab Error";
    return false;
  }
}

async function loadStateFromStorage() {
  const data = await chrome.storage.local.get(["auditQueue", "auditCurrentIndex"]);
  if (data.auditQueue && Array.isArray(data.auditQueue)) {
    auditQueue = data.auditQueue;
    currentIndex = data.auditCurrentIndex || 0;
  }
}

async function saveStateToStorage() {
  await chrome.storage.local.set({
    auditQueue: auditQueue,
    auditCurrentIndex: currentIndex
  });
}

function parsePastedGsmQueue() {
  const txt = document.getElementById("txtGsmInput").value.trim();
  if (!txt) return alert("Please paste at least one GSM ID (e.g. GSM-FLS-10019).");

  const lines = txt.split(/[\r\n,;\t]+/).map(s => s.trim()).filter(s => s.length >= 3);
  if (lines.length === 0) return alert("No valid GSM IDs found.");

  // Deduplicate while preserving order
  const seen = new Set();
  const newQueue = [];
  lines.forEach(gsm => {
    if (!seen.has(gsm.toUpperCase())) {
      seen.add(gsm.toUpperCase());
      newQueue.push({
        gsm_id: gsm,
        candidate_name: "-",
        aadhaar_status: "Pending",
        aadhaar_filename: "-",
        is_issue: false,
        dl_status: "-",
        dl_filename: "-",
        verixa_url: "-",
        audit_date: "-"
      });
    }
  });

  auditQueue = newQueue;
  currentIndex = 0;
  saveStateToStorage();
  updateUI();
  log(`Loaded ${auditQueue.length} unique GSM IDs into queue.`);
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

      if (rows.length === 0) return alert("File contains no data rows.");

      // Find GSM ID column
      const headers = Object.keys(rows[0]);
      const gsmKey = headers.find(h => /gsm|reference|candidate\s*id|ref\s*no/i.test(h)) || headers[0];

      const loadedGsms = [];
      const seen = new Set();
      rows.forEach(r => {
        const val = String(r[gsmKey] || "").trim();
        if (val.length >= 3 && !seen.has(val.toUpperCase())) {
          seen.add(val.toUpperCase());
          loadedGsms.push({
            gsm_id: val,
            candidate_name: r["Candidate Name"] || r["Driver Name"] || r["Name"] || "-",
            aadhaar_status: "Pending",
            aadhaar_filename: "-",
            is_issue: false,
            dl_status: "-",
            dl_filename: "-",
            verixa_url: "-",
            audit_date: "-"
          });
        }
      });

      if (loadedGsms.length === 0) return alert(`No GSM IDs found under column '${gsmKey}'.`);

      auditQueue = loadedGsms;
      currentIndex = 0;
      saveStateToStorage();
      updateUI();
      log(`Loaded ${auditQueue.length} GSM IDs from '${file.name}'.`);
    } catch (err) {
      alert("Error parsing Excel file: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function clearQueue() {
  if (isAuditing) return alert("Please stop the audit before clearing.");
  if (auditQueue.length > 0 && !confirm("Clear all loaded records and audit findings?")) return;
  auditQueue = [];
  currentIndex = 0;
  document.getElementById("txtGsmInput").value = "";
  saveStateToStorage();
  updateUI();
  log("Queue cleared.");
}

async function startAudit() {
  if (auditQueue.length === 0) return alert("Please paste or load GSM IDs first.");

  const ok = await checkVerixaTab();
  if (!ok) return alert("Verixa360 tab not detected! Please open Verixa in a Chrome tab, log in, and try again.");

  isAuditing = true;
  isPaused = false;
  document.getElementById("btnStartAudit").style.display = "none";
  document.getElementById("btnPauseAudit").style.display = "inline-flex";
  document.getElementById("btnStopAudit").style.display = "inline-flex";

  log(`Starting audit from record #${currentIndex + 1}...`);

  while (currentIndex < auditQueue.length && isAuditing) {
    if (isPaused) {
      log("Audit paused.");
      break;
    }

    const item = auditQueue[currentIndex];
    log(`[${currentIndex + 1}/${auditQueue.length}] Scanning ${item.gsm_id} on Verixa...`);

    try {
      const res = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(verixaTabId, { action: "AUDIT_GSM", gsm_id: item.gsm_id }, response => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(response);
        });
      });

      if (res && res.success) {
        item.candidate_name = res.candidate_name || item.candidate_name;
        item.aadhaar_status = res.aadhaar_status;
        item.aadhaar_filename = res.aadhaar_filename;
        item.is_issue = res.is_aadhaar_misplaced;
        item.dl_status = res.dl_status;
        item.dl_filename = res.dl_filename;
        item.verixa_url = res.verixa_url || `https://verixa360.com/operations/sent?q=${encodeURIComponent(item.gsm_id)}`;
        item.audit_date = new Date().toLocaleString();

        if (item.is_issue) {
          log(`🚨 MISPLACED DL REPORT DETECTED for ${item.gsm_id}! File: ${item.aadhaar_filename}`);
        } else {
          log(`✓ Clean: ${item.gsm_id} (${item.aadhaar_status})`);
        }
      } else {
        item.aadhaar_status = res?.reason || "Not Found / Error";
        item.is_issue = false;
        log(`⚠️ ${item.gsm_id}: ${item.aadhaar_status}`);
      }
    } catch (err) {
      item.aadhaar_status = "Connection / Tab Error";
      item.is_issue = false;
      log(`Error auditing ${item.gsm_id}: ${err.message}`);
    }

    currentIndex++;
    await saveStateToStorage();
    updateUI();

    // Small delay between candidate lookups
    await new Promise(r => setTimeout(r, 600));
  }

  if (currentIndex >= auditQueue.length) {
    isAuditing = false;
    log("🎉 Audit finished for all records!");
    document.getElementById("btnStartAudit").style.display = "inline-flex";
    document.getElementById("btnStartAudit").innerText = "🔄 Re-run Audit";
    document.getElementById("btnPauseAudit").style.display = "none";
    document.getElementById("btnStopAudit").style.display = "none";
    alert("Audit complete! You can now review findings or click 'Export Audit Report (.xlsx)'.");
  }
}

function pauseAudit() {
  isPaused = true;
  document.getElementById("btnPauseAudit").style.display = "none";
  document.getElementById("btnStartAudit").style.display = "inline-flex";
  document.getElementById("btnStartAudit").innerText = "▶️ Resume Audit";
}

function stopAudit() {
  isAuditing = false;
  isPaused = false;
  document.getElementById("btnStartAudit").style.display = "inline-flex";
  document.getElementById("btnStartAudit").innerText = "▶️ Start Aadhaar Audit";
  document.getElementById("btnPauseAudit").style.display = "none";
  document.getElementById("btnStopAudit").style.display = "none";
  log("Audit stopped by user.");
}

function updateUI() {
  const total = auditQueue.length;
  const audited = auditQueue.filter(r => r.aadhaar_status !== "Pending").length;
  const issues = auditQueue.filter(r => r.is_issue).length;
  const clean = auditQueue.filter(r => !r.is_issue && r.aadhaar_status !== "Pending" && !r.aadhaar_status.includes("Error")).length;

  document.getElementById("lblGsmCount").innerText = `${total} GSMs Loaded`;
  document.getElementById("statTotal").innerText = total;
  document.getElementById("statAudited").innerText = audited;
  document.getElementById("statIssues").innerText = issues;
  document.getElementById("statClean").innerText = clean;

  const pct = total > 0 ? Math.round((audited / total) * 100) : 0;
  document.getElementById("progressBar").style.width = `${pct}%`;
  document.getElementById("lblProgress").innerText = total > 0 ? `${audited}/${total} (${pct}%)` : "Ready";

  renderTable();
}

function renderTable() {
  const tbody = document.getElementById("tblAuditBody");
  const filterIssuesOnly = document.getElementById("chkFilterIssuesOnly").checked;

  let displayList = auditQueue;
  if (filterIssuesOnly) {
    displayList = auditQueue.filter(r => r.is_issue);
  }

  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94A3B8; padding:12px;">${filterIssuesOnly ? "No issues found! All scanned records are clean." : "No records loaded yet."}</td></tr>`;
    return;
  }

  tbody.innerHTML = displayList.map((r, idx) => {
    let badgeClass = "badge-empty";
    if (r.is_issue) badgeClass = "badge-issue";
    else if (r.aadhaar_status.includes("Clean")) badgeClass = "badge-clean";

    return `
      <tr style="${r.is_issue ? 'background:#FEF2F2;' : ''}">
        <td style="color:#64748B; font-weight:700;">#${idx + 1}</td>
        <td style="font-weight:700; font-family:monospace;">
          <a href="${r.verixa_url || '#'}" target="_blank" style="color:#2563EB; text-decoration:none;" title="Open in Verixa">${r.gsm_id} ↗</a>
        </td>
        <td><span class="${badgeClass}">${r.aadhaar_status}</span></td>
        <td style="font-family:monospace; color:#334155; max-width:150px; overflow:hidden; text-overflow:ellipsis;" title="${r.aadhaar_filename}">${r.aadhaar_filename}</td>
        <td style="color:#64748B;">${r.dl_status}</td>
      </tr>
    `;
  }).join("");
}

function exportAuditExcel() {
  if (auditQueue.length === 0) return alert("No audit records to export.");

  const rows = auditQueue.map((r, i) => ({
    "S.No": i + 1,
    "GSM ID": r.gsm_id,
    "Candidate Name": r.candidate_name,
    "Aadhaar Section Status": r.aadhaar_status,
    "Uploaded File Under Aadhaar": r.aadhaar_filename,
    "DL Section Status": r.dl_status,
    "Uploaded File Under DL": r.dl_filename,
    "Issue Flag": r.is_issue ? "⚠️ MISPLACED DL REPORT" : "OK / Clean",
    "Action Required": r.is_issue ? "Remove DL file & upload genuine Aadhaar" : "None",
    "Verixa URL": r.verixa_url || `https://verixa360.com/operations/sent?q=${encodeURIComponent(r.gsm_id)}`,
    "Audit Timestamp": r.audit_date || new Date().toLocaleString()
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Set clean column widths
  ws['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 18 }, // GSM ID
    { wch: 22 }, // Candidate Name
    { wch: 26 }, // Aadhaar Status
    { wch: 32 }, // File Under Aadhaar
    { wch: 15 }, // DL Status
    { wch: 30 }, // File Under DL
    { wch: 26 }, // Issue Flag
    { wch: 36 }, // Action Required
    { wch: 45 }, // Verixa URL
    { wch: 22 }  // Timestamp
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Aadhaar_Upload_Audit");

  const dateStr = new Date().toISOString().slice(0, 10);
  const issuesCount = auditQueue.filter(r => r.is_issue).length;
  const filename = `Verixa_Aadhaar_Audit_${dateStr}_(${issuesCount}_Issues_Found).xlsx`;

  XLSX.writeFile(wb, filename);
  log(`📥 Audit report exported as '${filename}'!`);
}

function log(msg) {
  const el = document.getElementById("logStatus");
  if (el) el.innerText = msg;
  console.log(`[Verixa Auditor] ${msg}`);
}
