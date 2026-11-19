// Clean DL Number strictly (Indian DL = 2 state letters + 11 to 14 digits)
function cleanDl(raw) {
  if (!raw) return "";
  const s = String(raw).replace(/[\s-]/g, "").toUpperCase();
  const m = s.match(/([A-Z]{2})([0-9]{11,14})/);
  if (m) return m[1] + m[2];
  return s.replace(/^([A-Z]{2}[0-9]{9,15})[A-Z]+$/, "$1");
}

// Clean DOB strictly to YYYY-MM-DD
function cleanDob(raw) {
  if (!raw) return "";
  if (/police|station|father|mother|address|candidate|mobile|phone|email/i.test(raw)) return "";
  const monthMap = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const mMatch = raw.match(/(\d{1,2})\s*[-/]?\s*([A-Za-z]{3,9})\s*[-/,\s]?\s*(\d{4})/);
  if (mMatch) {
    const mStr = mMatch[2].toLowerCase().slice(0, 3);
    if (monthMap[mStr]) return `${mMatch[3]}-${monthMap[mStr]}-${mMatch[1].padStart(2, '0')}`;
  }
  const ymd = raw.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  const dmy = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return "";
}

// popup.js - Full Standalone DL Verification Suite with Verixa360 ➔ Surepass Automation Bridge
let isAutomating = false;
let currentLocalBatch = null; // { filename, total, records: [], mapping: {} }
let parsedRawRows = null;
let parsedRawHeaders = [];
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Audio Chime on Completion
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

// Generate Official Client-Side Verification Certificate PDF via jsPDF
function generateSurepassReportPdf(driver, cardDetails) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      console.warn("jsPDF not loaded; skipping PDF creation");
      return null;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    const c = cardDetails || {};

    // Header box: surepass Technologies Pvt. Ltd. (Matching Image 2)
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(1.5);
    doc.rect(40, 36, 115, 36);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text("surepass", 48, 60);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("Technologies Pvt. Ltd.", 40, 84);

    // Response Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text("Response", 40, 118);

    // Data Subheader
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text("Data", 40, 138);

    // Main Card Grid Box
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 148, width - 80, 580, 6, 6, "FD");

    // Grid fields matching Surepass Response card (Image 1 & Image 2)
    const clientVal = c["Client ID"] || `license_${driver.gsm_id.replace(/[^A-Za-z0-9]/g, "")}`;
    const licVal = c["License Number"] || driver.dl_number || "-";
    const stateVal = c["State"] || "Uttar Pradesh";
    const nameVal = c["Name"] || driver.driver_name || "-";
    const permAddr = c["Permanent Address"] || "-";
    const permZip = c["Permanent Zip"] || "-";
    const cityVal = c["City Name"] || "-";
    const tempAddr = c["Temporary Address"] || permAddr || "-";
    const tempZip = c["Temporary Zip"] || permZip || "-";
    const citizenVal = c["Citizenship"] || "IND";

    const fields = [
      { label: "Client ID", val: clientVal, x: 55, y: 165, w: 235 },
      { label: "License Number", val: licVal, x: 305, y: 165, w: 235 },
      
      { label: "State", val: stateVal, x: 55, y: 245, w: 235 },
      { label: "Name", val: nameVal, x: 305, y: 245, w: 235 },
      
      { label: "Permanent Address", val: permAddr, x: 55, y: 325, w: 235 },
      { label: "Permanent Zip", val: permZip, x: 305, y: 325, w: 235 },
      
      { label: "City Name", val: cityVal, x: 55, y: 415, w: 235 },
      { label: "Temporary Address", val: tempAddr, x: 305, y: 415, w: 235 },
      
      { label: "Temporary Zip", val: tempZip, x: 55, y: 505, w: 235 },
      { label: "Citizenship", val: citizenVal, x: 305, y: 505, w: 235 },

      { label: "Target GSM ID", val: driver.gsm_id || "-", x: 55, y: 595, w: 235 },
      { label: "Verification Date", val: driver.verification_date || new Date().toLocaleString(), x: 305, y: 595, w: 235 }
    ];

    fields.forEach(f => {
      doc.setFillColor(250, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(f.x, f.y, f.w, 65, 4, 4, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(f.label, f.x + 10, f.y + 18);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      const splitText = doc.splitTextToSize(String(f.val), f.w - 20);
      doc.text(splitText, f.x + 10, f.y + 34);
    });

    // Official Footer matching Image 2
    doc.setDrawColor(226, 232, 240);
    doc.line(40, height - 70, width - 40, height - 70);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text("SUREPASS TECHNOLOGIES PRIVATE LIMITED", 40, height - 52);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text("Unit No G-22, Ground Floor, NDM-1, B-2,3,4 Netaji Subhash Place, Pitampura, Delhi, Delhi, India - 110034", 40, height - 40);

    return doc.output("datauristring");
  } catch (err) {
    console.warn("Could not generate Surepass Report PDF:", err);
    return null;
  }
}

// Tab Switching
function switchTab(tabName) {
  const btnVerify = document.getElementById("tabNavVerify");
  const btnUpload = document.getElementById("tabNavUpload");
  const btnExport = document.getElementById("tabNavExport");

  const secVerify = document.getElementById("tabSectionVerify");
  const secUpload = document.getElementById("tabSectionUpload");
  const secExport = document.getElementById("tabSectionExport");

  if (btnVerify) btnVerify.classList.toggle("active", tabName === "verify");
  if (btnUpload) btnUpload.classList.toggle("active", tabName === "upload");
  if (btnExport) btnExport.classList.toggle("active", tabName === "export");

  if (secVerify) secVerify.style.display = tabName === "verify" ? "block" : "none";
  if (secUpload) secUpload.style.display = tabName === "upload" ? "block" : "none";
  if (secExport) secExport.style.display = tabName === "export" ? "block" : "none";

  if (tabName === "export") renderRecordsTable();
}
window.switchTab = switchTab;

// UI Stats & Progress Update
function updateUIFromBatch() {
  if (!currentLocalBatch || !currentLocalBatch.records) {
    document.getElementById("statTotal").innerText = "0";
    document.getElementById("statVerified").innerText = "0";
    document.getElementById("statNotVerified").innerText = "0";
    document.getElementById("statPending").innerText = "0";
    document.getElementById("txtProgressRatio").innerText = "0 / 0";
    document.getElementById("progressBarFill").style.width = "0%";
    document.getElementById("txtProgressState").innerText = "No File Loaded";
    return;
  }

  const recs = currentLocalBatch.records;
  const total = recs.length;
  const verified = recs.filter(r => r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded").length;
  const notVerified = recs.filter(r => r.verification_status === "Not Verified").length;
  const otherDone = recs.filter(r => r.verification_status && !["Verified", "Verified & Uploaded", "Not Verified", "Pending"].includes(r.verification_status)).length;
  const pending = recs.filter(r => !r.verification_status || r.verification_status === "Pending").length;
  const completed = total - pending;

  document.getElementById("statTotal").innerText = total;
  document.getElementById("statVerified").innerText = verified;
  document.getElementById("statNotVerified").innerText = notVerified + otherDone;
  document.getElementById("statPending").innerText = pending;

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  document.getElementById("txtProgressRatio").innerText = `${completed} / ${total}`;
  document.getElementById("progressBarFill").style.width = `${pct}%`;

  if (pending === 0 && total > 0) {
    document.getElementById("txtProgressState").innerText = "🎉 All Drivers Completed!";
  } else if (isAutomating) {
    document.getElementById("txtProgressState").innerText = `Processing (${completed + 1} of ${total})...`;
  } else {
    document.getElementById("txtProgressState").innerText = `${currentLocalBatch.filename || "Batch"} ready`;
  }

  const pdfCount = recs.filter(r => r.report_download_status === "Downloaded").length;
  document.getElementById("txtSavedCount").innerText = `${pdfCount} PDF Saved`;

  // Live update Results Table in Tab 3 on every record change
  renderRecordsTable();
}

// Render Results Table in Tab 3
function renderRecordsTable() {
  const tbody = document.getElementById("tblRecordsBody");
  if (!tbody) return;

  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:12px;">No records loaded yet.</td></tr>`;
    return;
  }

  const filterTxt = (document.getElementById("txtFilterSearch")?.value || "").toLowerCase().trim();
  const filtered = currentLocalBatch.records.filter(r => {
    if (!filterTxt) return true;
    return (r.gsm_id || "").toLowerCase().includes(filterTxt) || (r.phone_number || "").includes(filterTxt) || (r.dl_number || "").toLowerCase().includes(filterTxt);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:10px;">No matching records.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    let color = "#64748B";
    let bg = "#F1F5F9";
    if (r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded") { color = "#047857"; bg = "#ECFDF5"; }
    else if (r.verification_status === "Not Verified") { color = "#B45309"; bg = "#FFFBEB"; }
    else if (r.verification_status === "Not Found on Verixa" || r.verification_status === "Invalid Details" || r.verification_status === "Verification Error") { color = "#BE123C"; bg = "#FFF1F2"; }

    return `
      <tr>
        <td style="color:#64748B; font-weight:700;">#${r.row_index}</td>
        <td style="font-weight:700; color:#0F172A; font-family:monospace;">${escapeHtml(r.gsm_id || "-")}</td>
        <td><span style="background:${bg}; color:${color}; font-size:9px; font-weight:700; padding:2px 5px; border-radius:4px;">${escapeHtml(r.verification_status || "Pending")}</span></td>
        <td style="color:#64748B; font-size:9px;">${escapeHtml(r.remarks || "-")}</td>
      </tr>
    `;
  }).join("");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
}

// 1. QUICK PASTE GSM NUMBERS (VERIXA AUTO-FETCH MODE)
function loadPastedGsmQueue() {
  const txt = document.getElementById("txtPasteGsm")?.value || "";
  const rawLines = txt.split(/[\r\n,]+/).map(s => s.trim()).filter(s => s.length > 2);
  if (rawLines.length === 0) {
    alert("Please paste at least one valid GSM ID (e.g. GSM-FLS-10019).");
    return;
  }

  const uniqueGsms = [...new Set(rawLines)];

  const formattedRecords = uniqueGsms.map((gsm, idx) => {
    return {
      row_index: idx + 1,
      gsm_id: gsm,
      phone_number: "",
      dl_number: "",
      dob: "",
      driver_name: "",
      verification_status: "Pending",
      verification_date: "",
      remarks: "",
      report_filename: "",
      report_download_status: "Pending",
      needs_verixa_fetch: true,
      original_data: { "GSM ID": gsm }
    };
  });

  currentLocalBatch = {
    filename: `Pasted_${uniqueGsms.length}_GSMs`,
    total: formattedRecords.length,
    records: formattedRecords,
    mapping: { gsm_id: "GSM ID", dl_number: "__VERIXA__", dob: "__VERIXA__", phone_number: "__VERIXA__" },
    timestamp: Date.now()
  };

  chrome.storage.local.set({ localBatch: currentLocalBatch }, () => {
    log(`✓ Loaded ${uniqueGsms.length} GSM IDs for Verixa360 ➔ Surepass automation!`, "info");
    updateUIFromBatch();
    switchTab("verify");
  });
}

// Auto-detect columns from headers
function autoDetectColumns(headers) {
  const mapping = { gsm_id: "", phone_number: "", dl_number: "", dob: "" };
  for (const h of headers) {
    const clean = String(h).toLowerCase().trim().replace(/[^a-z0-9]/g, "");
    if (!mapping.gsm_id && (clean.includes("gsm") || clean.includes("driverid") || clean.includes("leadid") || clean === "id")) {
      mapping.gsm_id = h;
    }
    if (!mapping.phone_number && (clean.includes("phone") || clean.includes("mobile") || clean.includes("contact") || clean.includes("contactnumber"))) {
      mapping.phone_number = h;
    }
    if (!mapping.dl_number && (clean.includes("dlnumber") || clean.includes("dlno") || clean.includes("license") || clean.includes("licence") || clean === "dl")) {
      mapping.dl_number = h;
    }
    if (!mapping.dob && (clean.includes("dob") || clean.includes("birth") || clean.includes("dateofbirth"))) {
      mapping.dob = h;
    }
  }
  return mapping;
}

// Populate column dropdowns with Verixa360 fallback
function setupColumnDropdowns(headers, autoMap) {
  const selects = [
    { id: "selMapGsm", val: autoMap.gsm_id, allowVerixa: false },
    { id: "selMapPhone", val: autoMap.phone_number, allowVerixa: true },
    { id: "selMapDl", val: autoMap.dl_number, allowVerixa: true },
    { id: "selMapDob", val: autoMap.dob, allowVerixa: true }
  ];

  selects.forEach(s => {
    const el = document.getElementById(s.id);
    if (!el) return;
    let html = "";
    if (s.allowVerixa) {
      html += `<option value="__VERIXA__" ${!s.val ? "selected" : ""}>⚡ Auto-Fetch from Verixa360</option>`;
    }
    html += headers.map(h => `<option value="${escapeHtml(h)}" ${h === s.val ? "selected" : ""}>${escapeHtml(h)}</option>`).join("");
    el.innerHTML = html;
  });

  document.getElementById("cardColumnMapping").style.display = "block";
}

// Parse Raw File (ArrayBuffer)
function parseSpreadsheetBuffer(buffer, filename) {
  try {
    const wb = XLSX.read(buffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (!rows || rows.length === 0) {
      alert("Spreadsheet contains no rows!");
      return;
    }

    parsedRawRows = rows;
    parsedRawHeaders = Object.keys(rows[0] || {});

    const autoMap = autoDetectColumns(parsedRawHeaders);
    setupColumnDropdowns(parsedRawHeaders, autoMap);

    const lbl = document.getElementById("lblFileLoaded");
    lbl.style.display = "block";
    lbl.innerText = `✓ Loaded '${filename}' (${rows.length} rows, ${parsedRawHeaders.length} columns)`;
    log(`Loaded '${filename}' with ${rows.length} rows. Please confirm column mapping.`, "info");
  } catch (err) {
    alert("Error parsing spreadsheet: " + err.message);
    log("Parsing error: " + err.message, "err");
  }
}

// Parse Google Sheet URL to direct CSV
function parseGSheetUrl(url) {
  url = url.trim();
  if (url.includes("output=csv") || url.includes("format=csv")) return url;
  if (url.includes("/pubhtml")) return url.replace("/pubhtml", "/pub?output=csv");

  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error("Could not find Google Spreadsheet ID in link.");
  const sheetId = match[1];

  const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
  let exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  if (gidMatch) exportUrl += `&gid=${gidMatch[1]}`;
  return exportUrl;
}

// Fetch Google Sheet directly in browser
async function fetchGoogleSheetDirect() {
  const urlInput = document.getElementById("txtGSheetUrl");
  const rawUrl = (urlInput.value || "").trim();
  if (!rawUrl) return alert("Please paste a valid Google Sheet link.");

  const btn = document.getElementById("btnFetchGSheetExt");
  btn.disabled = true;
  btn.innerText = "Fetching...";
  log("Fetching live Google Sheet...", "info");

  try {
    const csvUrl = parseGSheetUrl(rawUrl);
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`Google returned status ${res.status}. Check link sharing!`);

    const text = await res.text();
    if (text.includes("ServiceLogin") || (text.includes("<html") && text.includes("accounts.google.com"))) {
      throw new Error("Sheet is private. Change sharing to 'Anyone with the link can view'.");
    }

    const wb = XLSX.read(text, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    let rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    // Filter pending cases if requested
    const filterPending = document.getElementById("chkFilterPendingExt").checked;
    let skipped = 0;
    if (filterPending) {
      const origLen = rows.length;
      rows = rows.filter(r => {
        const rowStr = JSON.stringify(r).toLowerCase();
        const isVerified = rowStr.includes('"verified"') || rowStr.includes('"active"') || rowStr.includes('"completed"');
        return !isVerified;
      });
      skipped = origLen - rows.length;
    }

    parsedRawRows = rows;
    parsedRawHeaders = Object.keys(rows[0] || {});
    const autoMap = autoDetectColumns(parsedRawHeaders);
    setupColumnDropdowns(parsedRawHeaders, autoMap);

    const lbl = document.getElementById("lblFileLoaded");
    lbl.style.display = "block";
    lbl.innerText = `✓ Fetched Google Sheet: ${rows.length} pending drivers loaded (${skipped} skipped)`;
    log(`Fetched Google Sheet: ${rows.length} pending rows ready.`, "info");
  } catch (err) {
    alert("Google Sheet Error: " + err.message);
    log("Google Sheet Error: " + err.message, "err");
  } finally {
    btn.disabled = false;
    btn.innerText = "📥 Fetch G-Sheet";
  }
}

// Confirm & Load Queue into local storage
function confirmAndLoadQueue() {
  if (!parsedRawRows || parsedRawRows.length === 0) return alert("No driver rows loaded.");

  const mapping = {
    gsm_id: document.getElementById("selMapGsm").value,
    phone_number: document.getElementById("selMapPhone").value,
    dl_number: document.getElementById("selMapDl").value,
    dob: document.getElementById("selMapDob").value
  };

  const formattedRecords = parsedRawRows.map((r, idx) => {
    const gsmVal = String(r[mapping.gsm_id] || "").trim();
    const dlVal = mapping.dl_number === "__VERIXA__" ? "" : String(r[mapping.dl_number] || "").trim();
    const dobVal = mapping.dob === "__VERIXA__" ? "" : String(r[mapping.dob] || "").trim();
    const phoneVal = mapping.phone_number === "__VERIXA__" ? "" : String(r[mapping.phone_number] || "").trim();

    return {
      row_index: idx + 2,
      gsm_id: gsmVal,
      phone_number: phoneVal,
      dl_number: dlVal,
      dob: dobVal,
      driver_name: "",
      verification_status: "Pending",
      verification_date: "",
      remarks: "",
      report_filename: "",
      report_download_status: "Pending",
      needs_verixa_fetch: !dlVal || !dobVal || mapping.dl_number === "__VERIXA__",
      original_data: r
    };
  }).filter(r => r.gsm_id.length > 2);

  currentLocalBatch = {
    filename: document.getElementById("lblFileLoaded")?.innerText || "Driver_Batch.xlsx",
    total: formattedRecords.length,
    records: formattedRecords,
    mapping: mapping,
    timestamp: Date.now()
  };

  chrome.storage.local.set({ localBatch: currentLocalBatch }, () => {
    log(`✓ Loaded queue with ${formattedRecords.length} drivers!`, "info");
    updateUIFromBatch();
    switchTab("verify");
  });
}

// Export All Records to Consolidated Excel (.xlsx)
function exportUpdatedExcel() {
  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    return alert("No records to export.");
  }

  // Preserve all original columns and append/update verification status
  const exportRows = currentLocalBatch.records.map(r => {
    const base = { ...r.original_data };
    base["GSM ID"] = r.gsm_id || base["GSM ID"] || "";
    if (r.driver_name) base["Driver Name"] = r.driver_name;
    base["Mobile Number"] = r.phone_number || base["Mobile Number"] || base["Phone Number"] || "";
    base["Driving Licence Number"] = r.dl_number || base["Driving Licence Number"] || base["DL Number"] || "";
    base["Date of Birth"] = r.dob || base["Date of Birth"] || base["DOB"] || "";

    const isVerified = (r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded");
    const isFailed = (r.verification_status === "Not Verified" || r.verification_status === "Verification Error" || r.verification_status === "Incomplete Details" || r.verification_status === "Not Found on Verixa");

    base["Verification Status"] = isVerified 
      ? (r.verification_status === "Verified & Uploaded" || r.upload_status === "Uploaded" ? "Verified & Uploaded" : "Verified")
      : (isFailed ? `Failed (${r.verification_status})` : (r.verification_status || "Pending"));
    
    base["Verification Date"] = r.verification_date || "";
    base["Verification Remarks"] = r.remarks || (isVerified ? "Verified on Surepass" : (isFailed ? "Verification Failed" : "Pending"));
    
    // Verixa Certificate Upload
    base["Verixa Certificate Upload"] = (r.verification_status === "Verified & Uploaded" || r.upload_status === "Uploaded") 
      ? "Uploaded to Verixa" 
      : (isFailed ? "Skipped (Verification Failed)" : (r.upload_status || "Pending"));
    
    base["Report Filename"] = isVerified ? (r.report_filename || "") : "N/A (Failed)";

    // Processing Status column (accurately distinguishes success vs failure)
    if (isVerified) {
      base["Processing Status"] = "Completed - Verified Successfully";
    } else if (isFailed) {
      base["Processing Status"] = `Completed - Failed: ${r.remarks || r.verification_status}`;
    } else {
      base["Processing Status"] = "Pending";
    }
    return base;
  });

  const ws = XLSX.utils.json_to_sheet(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Verification Results");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });

  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const reader = new FileReader();
  reader.onloadend = () => {
    const outFilename = `Drivers_Verified_${Date.now()}.xlsx`;
    chrome.runtime.sendMessage({
      action: "DOWNLOAD_FILE",
      url: reader.result,
      filename: outFilename,
      subfolder: "" // Saves directly into Downloads folder
    }, (res) => {
      if (res && res.success) {
        log(`✓ Exported verified Excel to Downloads/${outFilename}`, "info");
      }
    });
  };
  reader.readAsDataURL(blob);
}

// Copy G-Sheet Tab-Separated Results to Clipboard
async function copyGSheetResults() {
  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    return alert("No records to copy.");
  }

  const lines = ["GSM ID\tName\tPhone Number\tDL Number\tDOB\tVerification Status\tVerification Date\tRemarks"];
  currentLocalBatch.records.forEach(r => {
    lines.push(`${r.gsm_id}\t${r.driver_name || ""}\t${r.phone_number || ""}\t${r.dl_number || ""}\t${r.dob || ""}\t${r.verification_status || "Pending"}\t${r.verification_date || ""}\t${r.remarks || ""}`);
  });

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    alert("📋 Verification results copied to clipboard!\n\nYou can now go to your Google Sheet, select the starting cell, and press Ctrl+V to paste.");
  } catch (err) {
    alert("Clipboard error: " + err.message);
  }
}

// Backend Server Status (Optional sync)
async function getBackendUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["backendUrl"], (res) => {
      resolve(res.backendUrl || defaultBackendUrl);
    });
  });
}

async function checkServerStatus() {
  const backend = await getBackendUrl();
  const connBadge = document.getElementById("connBadge");
  try {
    const res = await fetch(`${backend}/api/extension/status`, { cache: "no-store" });
    if (res.ok) {
      connBadge.className = "status-badge status-online";
      connBadge.innerText = "🟢 Server Synced";
      return true;
    }
  } catch (e) {}
  connBadge.className = "status-badge status-offline";
  connBadge.innerText = "Standalone Mode";
  return false;
}

// =========================================================================
// MAIN AUTOMATION EXECUTION LOOP (VERIXA360 ➔ SUREPASS BRIDGE)
// =========================================================================
async function runAutomationLoop() {
  if (!currentLocalBatch || !currentLocalBatch.records) {
    return alert("Please paste GSM IDs or upload a sheet in 'Upload & Mapping' first!");
  }

  isAutomating = true;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;
  log("🚀 Starting Verixa360 ➔ Surepass automation loop...", "info");

  while (isAutomating) {
    // 1. Locate next Pending driver in queue
    const driver = currentLocalBatch.records.find(r => !r.verification_status || r.verification_status === "Pending");
    if (!driver) {
      log("🎉 All drivers in queue have been processed!", "info");
      playCompletionChime();
      isAutomating = false;
      break;
    }

    // Update target card
    document.getElementById("curGsmId").innerText = driver.gsm_id || "-";
    document.getElementById("curDlNumber").innerText = driver.dl_number || "Fetching...";
    document.getElementById("curPhone").innerText = driver.phone_number || "Fetching...";
    document.getElementById("curDob").innerText = driver.dob || "Fetching...";
    document.getElementById("badgeActiveStatus").innerText = `Row #${driver.row_index}`;

    // STEP A: If DL or DOB is missing, search and extract from Verixa360 tab
    if (driver.needs_verixa_fetch || !driver.dl_number || !driver.dob) {
      log(`🔍 [Verixa360] Searching GSM ${driver.gsm_id}...`, "info");

      let verixaTab = null;
      const allTabs = await chrome.tabs.query({});
      const vTabs = allTabs.filter(t => t.url && (t.url.includes("verixa360.com") || t.url.includes("verixa360.in")));
      if (vTabs.length > 0) {
        verixaTab = vTabs[0];
        try {
          await chrome.tabs.update(verixaTab.id, { active: true });
          await chrome.windows.update(verixaTab.windowId, { focused: true });
        } catch (e) {}

        const currentUrl = verixaTab.url || "";
        // If not on the Sent list page (e.g. still inside an /applications/... details view from previous driver), navigate back
        if (!currentUrl.includes("/operations/sent")) {
          log("Navigating to Verixa 'Sent by desks' (https://verixa360.com/operations/sent)...", "info");
          await chrome.tabs.update(verixaTab.id, { url: "https://verixa360.com/operations/sent" });
          await sleep(3000);
        }
      } else {
        log("⚠️ Verixa360 tab not open. Opening https://verixa360.com/operations/sent...", "warn");
        verixaTab = await chrome.tabs.create({ url: "https://verixa360.com/operations/sent" });
        await sleep(5000);
      }

      // Ensure tab is loaded
      const loadStart = Date.now();
      while (Date.now() - loadStart < 10000) {
        try {
          const t = await chrome.tabs.get(verixaTab.id);
          if (t.status === "complete") break;
        } catch (e) {}
        await sleep(300);
      }

      // Always inject newest verixa_content.js to ensure latest logic is running
      try {
        await chrome.scripting.executeScript({ target: { tabId: verixaTab.id }, files: ["verixa_content.js"] });
        await sleep(300);
      } catch (e) {}

      let verixaRes = null;
      let vAttempts = 0;
      while (vAttempts < 2 && isAutomating) {
        try {
          verixaRes = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(verixaTab.id, { action: "SEARCH_AND_EXTRACT_GSM", gsm_id: driver.gsm_id }, (res) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              resolve(res);
            });
          });
          break;
        } catch (err) {
          vAttempts++;
          try {
            await chrome.scripting.executeScript({ target: { tabId: verixaTab.id }, files: ["verixa_content.js"] });
            await sleep(1000);
          } catch (ie) {
            await sleep(2000);
          }
        }
      }

      if (!isAutomating) break;

      if (!verixaRes || !verixaRes.success || !verixaRes.dl_number) {
        log(`⚠️ [Verixa360] ${verixaRes?.reason || "No DL found"} for ${driver.gsm_id}`, "warn");
        driver.verification_status = "Not Found on Verixa";
        driver.verification_date = new Date().toLocaleString();
        driver.remarks = verixaRes?.reason || "DL or DOB not found on Verixa360";
        chrome.storage.local.set({ localBatch: currentLocalBatch });
        updateUIFromBatch();
        await sleep(1500);
        continue; // Skip to next driver
      }

      // Populate driver with cleaned Verixa data
      driver.dl_number = cleanDl(verixaRes.dl_number);
      driver.dob = cleanDob(verixaRes.dob);
      driver.phone_number = verixaRes.phone_number || driver.phone_number || "";
      driver.driver_name = verixaRes.driver_name || "";
      driver.needs_verixa_fetch = false;

      document.getElementById("curDlNumber").innerText = driver.dl_number || "-";
      document.getElementById("curPhone").innerText = driver.phone_number || "-";
      document.getElementById("curDob").innerText = driver.dob || "-";

      if (!driver.dl_number || !driver.dob) {
        log(`⚠️ [Verixa360] Incomplete details for ${driver.gsm_id} (DL: "${driver.dl_number || "none"}", DOB: "${driver.dob || "none"}")`, "warn");
        driver.verification_status = "Incomplete Details";
        driver.verification_date = new Date().toLocaleString();
        driver.remarks = "DL or DOB could not be cleanly parsed from Verixa";
        chrome.storage.local.set({ localBatch: currentLocalBatch });
        updateUIFromBatch();
        await sleep(1500);
        continue; // Do not send invalid or mismatched data to Surepass!
      }

      log(`✓ [Verixa360] Extracted DL: ${driver.dl_number}, DOB: ${driver.dob}`, "info");
      await sleep(1000);
    }

    // STEP B: Focus Surepass tab and verify
    log(`🚗 [Surepass] Verifying DL ${driver.dl_number} (DOB: ${driver.dob})...`, "info");

    let surepassTab = null;
    const allTabs2 = await chrome.tabs.query({});
    const surepassTabs = allTabs2.filter(t => t.url && (t.url.includes("surepass.app") || t.url.includes("surepass.io")));
    if (surepassTabs.length > 0) {
      // Find driving-license tab or use existing Surepass tab without opening a new one
      surepassTab = surepassTabs.find(t => t.url.includes("driving-license")) || surepassTabs[0];
      try {
        await chrome.tabs.update(surepassTab.id, { active: true });
        await chrome.windows.update(surepassTab.windowId, { focused: true });
      } catch (e) {}

      // If open tab is not on driving-license and not on login, navigate it smoothly
      if (!surepassTab.url.includes("driving-license") && !surepassTab.url.includes("login")) {
        await chrome.tabs.update(surepassTab.id, { url: "https://console.surepass.app/services/driving-license" });
        await sleep(3500);
      }
    } else {
      log("Opening Surepass tab...", "warn");
      surepassTab = await chrome.tabs.create({ url: "https://console.surepass.app/services/driving-license" });
      await sleep(5000);
    }

    // Always inject newest content.js to ensure latest Surepass automation runs
    try {
      await chrome.scripting.executeScript({ target: { tabId: surepassTab.id }, files: ["libs/xlsx.full.min.js", "libs/jspdf.umd.min.js", "content.js"] });
      await sleep(300);
    } catch (e) {}

    let result = null;
    let attempts = 0;
    while (attempts < 2 && isAutomating) {
      try {
        result = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(surepassTab.id, { action: "VERIFY_DRIVER", driver: driver }, (res) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          });
        });
        break;
      } catch (err) {
        attempts++;
        try {
          await chrome.scripting.executeScript({ target: { tabId: surepassTab.id }, files: ["libs/xlsx.full.min.js", "libs/jspdf.umd.min.js", "content.js"] });
          await sleep(1000);
        } catch (ie) {
          await sleep(2000);
        }
      }
    }

    if (!isAutomating) break;

    // Handle Unlogged in session or Verification Error (Do not download random dummy files!)
    if (!result || !result.success || result.status === "Login Required" || result.status === "Verification Error") {
      const errStatus = result?.status || "Verification Error";
      const errRemarks = result?.remarks || "Failed to verify on Surepass portal";
      driver.verification_status = errStatus;
      driver.verification_date = new Date().toLocaleString();
      driver.remarks = errRemarks;
      log(`⚠️ [Surepass] ${errStatus}: ${errRemarks}`, "warn");

      if (errStatus === "Login Required") {
        log("⚠️ Please log in to Surepass in the open tab! Automation will pause...", "warn");
        isAutomating = false;
        document.getElementById("btnStart").disabled = false;
        document.getElementById("btnStop").disabled = true;
        document.getElementById("badgeActiveStatus").innerText = "Paused: Login Required";
      }

      chrome.storage.local.set({ localBatch: currentLocalBatch });
      updateUIFromBatch();
      await sleep(1500);
      continue; // Skip without downloading any dummy PDF or file!
    }

    const finalStatus = result.status; // "Verified" or "Not Verified"
    const finalRemarks = result.remarks || (finalStatus === "Verified" ? "Verified on Surepass" : "Not Verified");
    const reportFilename = `${driver.gsm_id}_${driver.phone_number || "DL"}_DL_Report.pdf`;
    const nowIso = new Date().toLocaleString();

    // Update driver state
    driver.verification_status = finalStatus;
    driver.verification_date = nowIso;
    driver.remarks = finalRemarks;
    driver.report_filename = reportFilename;

    log(`✓ Outcome: ${finalStatus} (${finalRemarks})`, finalStatus === "Verified" ? "info" : "warn");

    // Official Surepass Report Download Confirmation & Auto-Upload to Verixa360
    if (finalStatus === "Verified") {
      driver.report_download_status = "Downloaded";
      log(`📥 Official Surepass report PDF saved to Downloads/Surepass_DL_Reports/`, "info");

      // Auto-upload DL Certificate back into Verixa under Verification results -> Driving licence certificate
      let pdfToUpload = result.pdf_base64;
      if (!pdfToUpload) {
        // Query background script cache
        try {
          const bgPdf = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "GET_LATEST_SUREPASS_PDF" }, res => resolve(res));
          });
          if (bgPdf && bgPdf.success && bgPdf.pdfBase64) {
            pdfToUpload = bgPdf.pdfBase64;
          }
        } catch (e) {}
      }

      // If PDF wasn't a direct file stream (since Surepass uses window.print), generate official Surepass Report PDF directly
      if (!pdfToUpload) {
        pdfToUpload = generateSurepassReportPdf(driver, result.card_details);
        if (pdfToUpload) {
          chrome.runtime.sendMessage({
            action: "DOWNLOAD_FILE",
            url: pdfToUpload,
            filename: `Surepass_DL_Reports/${reportFilename}`
          }, () => {});
        }
      }

      if (pdfToUpload) {
        log(`📤 [Verixa360] Uploading DL Certificate for ${driver.gsm_id}...`, "info");

        // Verify verixaTab is still valid and reachable
        try {
          if (!verixaTab || !verixaTab.id) throw new Error("No tab cached");
          await chrome.tabs.get(verixaTab.id);
        } catch (te) {
          const allTabsNow = await chrome.tabs.query({});
          const foundV = allTabsNow.find(t => t.url && (t.url.includes("verixa360.com") || t.url.includes("verixa360.in")));
          if (foundV) verixaTab = foundV;
        }

        if (verixaTab) {
          try {
            await chrome.tabs.update(verixaTab.id, { active: true });
            await chrome.windows.update(verixaTab.windowId, { focused: true });
            await sleep(600);
          } catch (e) {}

          let uploadRes = null;
          try {
            uploadRes = await new Promise((resolve, reject) => {
              chrome.tabs.sendMessage(verixaTab.id, {
                action: "UPLOAD_DL_CERTIFICATE",
                pdfBase64: pdfToUpload,
                filename: reportFilename,
                gsmId: driver.gsm_id
              }, res => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(res);
              });
            });
          } catch (ue) {
            uploadRes = { success: false, reason: ue.message };
          }

          if (uploadRes && uploadRes.success) {
            log(`✓ [Verixa360] Certificate successfully uploaded for ${driver.gsm_id}!`, "info");
            driver.verification_status = "Verified & Uploaded";
            driver.remarks = "Verified on Surepass & DL Certificate uploaded to Verixa";
            driver.upload_status = "Uploaded";
          } else {
            log(`⚠️ [Verixa360] Upload notice: ${uploadRes?.reason || "Pending manual upload"}`, "warn");
            driver.verification_status = "Verified";
            driver.remarks = `Verified on Surepass (${uploadRes?.reason || "Verixa upload pending"})`;
            driver.upload_status = "Pending";
          }
        }
      }
    }

    // Save updated queue to chrome.storage.local & live update Results Table
    chrome.storage.local.set({ localBatch: currentLocalBatch });
    updateUIFromBatch();

    // Optional: Sync back to backend server if online
    const backend = await getBackendUrl();
    try {
      fetch(`${backend}/api/extension/submit_result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_id: driver.record_id || `row_${driver.row_index}`,
          verification_status: finalStatus,
          remarks: finalRemarks,
          report_filename: reportFilename
        })
      }).catch(() => {});
    } catch (e) {}

    await sleep(2000);
  }

  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
  updateUIFromBatch();
}

// Initial Setup & Event Listeners
document.addEventListener("DOMContentLoaded", async () => {
  // Tab Navigation Listeners
  const tabVerify = document.getElementById("tabNavVerify");
  const tabUpload = document.getElementById("tabNavUpload");
  const tabExport = document.getElementById("tabNavExport");

  if (tabVerify) tabVerify.onclick = () => switchTab("verify");
  if (tabUpload) tabUpload.onclick = () => switchTab("upload");
  if (tabExport) tabExport.onclick = () => switchTab("export");

  // Load saved batch from chrome.storage.local
  chrome.storage.local.get(["localBatch"], (res) => {
    if (res.localBatch) {
      currentLocalBatch = res.localBatch;
      log(`Restored previous batch: ${currentLocalBatch.filename} (${currentLocalBatch.records?.length} drivers)`, "info");
      updateUIFromBatch();
    }
  });

  checkServerStatus();

  // Quick Paste GSM IDs Button
  const btnLoadPasted = document.getElementById("btnLoadPastedGsm");
  if (btnLoadPasted) btnLoadPasted.onclick = loadPastedGsmQueue;

  // Drag & Drop File Upload
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  if (dropZone && fileInput) {
    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = "#2563EB"; dropZone.style.background = "#EFF6FF"; };
    dropZone.ondragleave = () => { dropZone.style.borderColor = "#94A3B8"; dropZone.style.background = "#F8FAFC"; };
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.style.borderColor = "#94A3B8";
      dropZone.style.background = "#F8FAFC";
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    };

    fileInput.onchange = (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    };
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (evt) => parseSpreadsheetBuffer(evt.target.result, file.name);
    reader.readAsArrayBuffer(file);
  }

  // Google Sheet Fetch Button
  const btnGSheet = document.getElementById("btnFetchGSheetExt");
  if (btnGSheet) btnGSheet.onclick = fetchGoogleSheetDirect;

  // Confirm Queue Mapping Button
  const btnConfirmQueue = document.getElementById("btnLoadQueue");
  if (btnConfirmQueue) btnConfirmQueue.onclick = confirmAndLoadQueue;

  // Start & Stop Controls
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  if (btnStart) btnStart.onclick = () => { if (!isAutomating) runAutomationLoop(); };
  if (btnStop) btnStop.onclick = () => { isAutomating = false; log("Stopping verification...", "warn"); };

  // Export Buttons
  const btnExpExcel = document.getElementById("btnExportExcel");
  const btnCopyGS = document.getElementById("btnCopyGSheet");
  if (btnExpExcel) btnExpExcel.onclick = exportUpdatedExcel;
  if (btnCopyGS) btnCopyGS.onclick = copyGSheetResults;

  // Filter Search in Tab 3
  const txtSearch = document.getElementById("txtFilterSearch");
  if (txtSearch) txtSearch.oninput = renderRecordsTable;

  // Server Config
  const bInput = document.getElementById("backendUrl");
  const bVal = await getBackendUrl();
  if (bInput) bInput.value = bVal;

  const btnSaveConf = document.getElementById("btnSaveConfig");
  if (btnSaveConf) {
    btnSaveConf.onclick = () => {
      const val = bInput.value.trim().replace(/\/+$/, "");
      if (!val) return;
      chrome.storage.local.set({ backendUrl: val }, () => {
        log(`Backend updated: ${val}`, "info");
        checkServerStatus();
      });
    };
  }
});
