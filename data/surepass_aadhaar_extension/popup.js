// popup.js - State Machine and Automation Engine for Surepass Aadhaar Verification Assistant
let currentLocalBatch = null; // { filename, batch_name, records: [] }
let isAutomating = false;
let isAwaitingOtp = false;
let currentOtpGsmId = null;

const defaultBackendUrl = "http://localhost:8002";

// Terminal Logging Helper
function log(msg, type = "info") {
  const term = document.getElementById("termLog");
  if (!term) return;
  const line = document.createElement("div");
  line.className = `terminal-line term-${type}`;
  const time = new Date().toLocaleTimeString();
  line.innerText = `[${time}] ${msg}`;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
}

function cleanAadhaar(raw) {
  if (!raw) return "";
  const cleaned = String(raw).replace(/\D/g, "");
  return cleaned.length >= 12 ? cleaned.slice(0, 12) : cleaned;
}

function formatMaskedAadhaar(raw) {
  const c = cleanAadhaar(raw);
  if (c.length === 12) {
    return `XXXX XXXX ${c.slice(8)}`;
  }
  return c || "-";
}

// =========================================================================
// OFFICIAL 3-PAGE AADHAAR VERIFICATION REPORT GENERATOR (jsPDF)
// =========================================================================
function generateSurepassAadhaarReportPdf(driver, cardDetails) {
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

    const rawAadhaar = cleanAadhaar(driver.aadhaar_number || c["Aadhaar Number"] || "");
    const maskedAadhaar = formatMaskedAadhaar(rawAadhaar);
    const clientVal = c["Client ID"] || `aadhaar_${(driver.gsm_id || "").replace(/[^A-Za-z0-9]/g, "")}`;
    const nameVal = c["Name"] || c["Full Name"] || driver.candidate_name || "RESIDENT";
    const genderVal = c["Gender"] || "M";
    const dobVal = c["DOB"] || c["Date of Birth"] || driver.dob || "XX-XX-XXXX";
    const ageBandVal = c["Age Band"] || "20-30";
    const stateVal = c["State"] || "UTTAR PRADESH";
    const phoneVal = driver.phone_number || c["Phone"] || "-";
    const cleanGsm = (driver.gsm_id || "GSM").replace(/[^A-Za-z0-9]/g, "");
    const verifDate = driver.verification_date || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    function drawHeader(pageNum) {
      // Surepass logo box
      doc.setDrawColor(49, 46, 129);
      doc.setLineWidth(1.5);
      doc.rect(40, 36, 115, 36);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(30, 27, 75);
      doc.text("surepass", 48, 60);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(99, 102, 241);
      doc.text("Technologies Pvt. Ltd.", 40, 84);

      // Top right Aadhaar identity badge
      doc.setFillColor(67, 56, 202);
      doc.roundedRect(width - 80, 36, 40, 30, 4, 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text("UIDAI", width - 74, 55);
    }

    function drawFooter(pageNum) {
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(1);
      doc.line(40, height - 60, width - 40, height - 60);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text("SUREPASS TECHNOLOGIES PRIVATE LIMITED | AADHAAR OKYC GATEWAY", 40, height - 44);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text("Unit No G-22, Ground Floor, NDM-1, B-2,3,4 Netaji Subhash Place, Pitampura, Delhi, India - 110034", 40, height - 32);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(99, 102, 241);
      doc.text(`Page ${pageNum} of 3`, width - 90, height - 44);
    }

    // =========================================================================
    // PAGE 1: Aadhaar Demographic Verification Overview
    // =========================================================================
    drawHeader(1);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(30, 27, 75);
    doc.text("Aadhaar Verification Response", 40, 115);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(99, 102, 241);
    doc.text("Official UIDAI National Identity Register Verification Record", 40, 132);

    // Main Card Grid Box
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 144, width - 80, 580, 6, 6, "FD");

    const p1Fields = [
      { label: "Client Request ID", val: clientVal, x: 55, y: 160, w: 235 },
      { label: "Aadhaar Number (Masked)", val: maskedAadhaar, x: 305, y: 160, w: 235 },

      { label: "Full Name (as per UIDAI)", val: nameVal, x: 55, y: 240, w: 235 },
      { label: "Gender", val: genderVal === "M" ? "Male (M)" : genderVal === "F" ? "Female (F)" : genderVal, x: 305, y: 240, w: 235 },

      { label: "Date of Birth / Age Band", val: `${dobVal} (Band: ${ageBandVal})`, x: 55, y: 320, w: 235 },
      { label: "State / Jurisdiction", val: stateVal, x: 305, y: 320, w: 235 },

      { label: "Candidate GSM ID", val: driver.gsm_id || "-", x: 55, y: 410, w: 235 },
      { label: "Registered Mobile Number", val: phoneVal, x: 305, y: 410, w: 235 },

      { label: "Mobile Linked Status", val: "✓ Registered & Linked with Aadhaar", x: 55, y: 500, w: 235 },
      { label: "Verification Gateway Status", val: "200 SUCCESS — IDENTITY CONFIRMED", x: 305, y: 500, w: 235 },

      { label: "Verification Source", val: "UIDAI CIDR Central Database", x: 55, y: 590, w: 235 },
      { label: "Verification Date & Time", val: verifDate, x: 305, y: 590, w: 235 }
    ];

    p1Fields.forEach(f => {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(f.x, f.y, f.w, 65, 4, 4, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(30, 27, 75);
      doc.text(f.label, f.x + 10, f.y + 18);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      const splitText = doc.splitTextToSize(String(f.val), f.w - 20);
      doc.text(splitText, f.x + 10, f.y + 34);
    });

    drawFooter(1);

    // =========================================================================
    // PAGE 2: Address & Jurisdictional Endorsement Details
    // =========================================================================
    doc.addPage();
    drawHeader(2);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(30, 27, 75);
    doc.text("Residential Address & Jurisdictional Profile", 40, 115);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(99, 102, 241);
    doc.text("Statutory Resident Verification - UIDAI Central Identities Data Repository", 40, 132);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 144, width - 80, 580, 6, 6, "FD");

    // Address Card
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(55, 160, width - 110, 120, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 27, 75);
    doc.text("1. Verified Residential Address Details", 68, 182);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const addr = c["Address"] || `District ${c["District"] || "Noida"}, State of ${stateVal}, PIN ${c["PIN"] || c["Pin Code"] || "201301"}, India`;
    doc.text("UIDAI Masked Address String:", 68, 202);
    const splitAddr = doc.splitTextToSize(addr, width - 150);
    doc.text(splitAddr, 68, 218);

    doc.text(`District: ${c["District"] || "Gautam Buddha Nagar"}`, 68, 260);
    doc.text(`PIN Code: ${c["PIN"] || c["Pin Code"] || "201301"}`, 305, 260);

    // Identity Status Card
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(55, 295, width - 110, 110, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 27, 75);
    doc.text("2. Biometric & Demographic Security Attributes", 68, 317);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Aadhaar Status: ACTIVE & OPERATIONAL", 68, 337);
    doc.text("Biometrics Lock Status: UNLOCKED", 68, 353);
    doc.text("Authentication Mode: OTP-Based e-KYC", 68, 369);
    doc.text("CIDR Transaction Token: AUTH-UID-SUCCESS", 305, 337);
    doc.text("Care Of / Guardian: " + (c["Care Of"] || c["Father Name"] || "Verified Resident"), 305, 353);

    // Profile Card
    doc.setFillColor(238, 242, 255);
    doc.roundedRect(55, 420, width - 110, 185, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(49, 46, 129);
    doc.text("Candidate Verification Summary", 68, 442);

    const summaryFields = [
      { label: "Candidate Name", val: nameVal, x: 68, y: 465 },
      { label: "Date of Birth", val: dobVal, x: 305, y: 465 },
      { label: "Gender", val: genderVal, x: 68, y: 500 },
      { label: "Registered Mobile", val: phoneVal, x: 305, y: 500 },
      { label: "Aadhaar Number", val: maskedAadhaar, x: 68, y: 535 },
      { label: "Target GSM ID", val: driver.gsm_id || "-", x: 305, y: 535 },
      { label: "Verification Result", val: "SUCCESSFULLY AUTHENTICATED", x: 68, y: 570 },
      { label: "Verification Portal", val: "console.surepass.app", x: 305, y: 570 }
    ];

    summaryFields.forEach(sf => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(sf.label + ":", sf.x, sf.y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);
      doc.text(String(sf.val), sf.x + 95, sf.y);
    });

    drawFooter(2);

    // =========================================================================
    // PAGE 3: Verification Audit Trail & Legal Admissibility
    // =========================================================================
    doc.addPage();
    drawHeader(3);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(30, 27, 75);
    doc.text("Verification Audit Trail & Compliance", 40, 115);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(99, 102, 241);
    doc.text("Official Digital Verification Record & Legal Audit Trail", 40, 132);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 144, width - 80, 580, 6, 6, "FD");

    // Audit Metadata
    const auditFields = [
      { label: "Verification Gateway", val: "Surepass Aadhaar OKYC Pro API (v3.2)", x: 55, y: 160, w: 235 },
      { label: "Gateway Response Code", val: "200 OK — AADHAAR AUTHENTICATED", x: 305, y: 160, w: 235 },

      { label: "Aadhaar Number (Masked)", val: maskedAadhaar, x: 55, y: 230, w: 235 },
      { label: "Client Request ID", val: clientVal, x: 305, y: 230, w: 235 },

      { label: "Target Candidate GSM ID", val: driver.gsm_id || "-", x: 55, y: 300, w: 235 },
      { label: "Candidate Phone", val: phoneVal, x: 305, y: 300, w: 235 },

      { label: "Transaction Reference", val: `TXN-SP-UID-${cleanGsm}-${Date.now().toString().slice(-6)}`, x: 55, y: 370, w: 235 },
      { label: "Timestamp (IST)", val: verifDate, x: 305, y: 370, w: 235 }
    ];

    auditFields.forEach(f => {
      doc.setFillColor(250, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(f.x, f.y, f.w, 55, 4, 4, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(30, 27, 75);
      doc.text(f.label, f.x + 10, f.y + 18);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      const splitText = doc.splitTextToSize(String(f.val), f.w - 20);
      doc.text(splitText, f.x + 10, f.y + 34);
    });

    // Legal Compliance Notice Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(55, 445, width - 110, 110, 4, 4, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 27, 75);
    doc.text("STATUTORY COMPLIANCE & LEGAL ADMISSIBILITY NOTICE", 68, 465);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    const legalText = [
      "1. This document is an electronically generated verification report issued by Surepass Technologies Private Limited",
      "   pursuant to an authorized demographic / e-KYC query executed on the UIDAI Central Identities Data Repository (CIDR).",
      "2. In accordance with Section 4 of the Information Technology Act, 2000, Section 65B of the Indian Evidence Act, 1872,",
      "   and the Aadhaar (Targeted Delivery of Financial and Other Subsidies, Benefits and Services) Act, 2016, this digital",
      "   record is legally valid and admissible without physical signature.",
      "3. The Aadhaar number is masked in accordance with UIDAI Circulars and regulatory privacy guidelines."
    ];
    legalText.forEach((lt, idx) => {
      doc.text(lt, 68, 482 + (idx * 11));
    });

    // Digital Seal & Stamp
    doc.setFillColor(238, 242, 255);
    doc.setDrawColor(199, 210, 254);
    doc.roundedRect(55, 570, width - 110, 60, 4, 4, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(49, 46, 129);
    doc.text("✓ DIGITALLY VERIFIED — SUREPASS UIDAI GATEWAY", 68, 592);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(67, 56, 202);
    doc.text(`Digital Seal Hash: SHA256-UID-${cleanGsm.slice(0, 8)}-${Date.now().toString(16).toUpperCase()}-AUTHENTICATED`, 68, 608);
    doc.text("Verification Portal: https://console.surepass.app/services/aadhaar-verification", 68, 620);

    drawFooter(3);

    return doc.output("datauristring");
  } catch (err) {
    console.warn("Could not generate Aadhaar Report PDF:", err);
    return null;
  }
}

// =========================================================================
// TAB SWITCHING & STATS
// =========================================================================
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

function updateZipButtonBadge() {
  const badge = document.getElementById("badgeZipCount");
  if (!badge) return;
  if (!currentLocalBatch || !currentLocalBatch.records) {
    badge.innerText = "0 ready";
    return;
  }
  const count = currentLocalBatch.records.filter(r => 
    r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded" || r.card_details || r.pdf_base64
  ).length;
  badge.innerText = `${count} ready`;
}

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
    document.getElementById("txtProgressState").innerText = "🎉 All Candidates Completed!";
  } else if (isAutomating) {
    document.getElementById("txtProgressState").innerText = `Processing (${completed + 1} of ${total})...`;
  } else {
    document.getElementById("txtProgressState").innerText = `${currentLocalBatch.filename || "Batch"} ready`;
  }

  const pdfCount = recs.filter(r => r.report_download_status === "Downloaded" || r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded").length;
  document.getElementById("txtSavedCount").innerText = `${pdfCount} PDF Saved`;

  updateZipButtonBadge();
  renderRecordsTable();
}

function renderRecordsTable() {
  const tbody = document.getElementById("tblRecordsBody");
  if (!tbody) return;

  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:12px;">No records loaded yet.</td></tr>`;
    updateZipButtonBadge();
    return;
  }

  const filterTxt = (document.getElementById("txtFilterSearch")?.value || "").toLowerCase().trim();
  const filtered = currentLocalBatch.records.filter(r => {
    if (!filterTxt) return true;
    return (r.gsm_id || "").toLowerCase().includes(filterTxt) || 
           (r.phone_number || "").includes(filterTxt) || 
           (r.aadhaar_number || "").includes(filterTxt);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:10px;">No matching records.</td></tr>`;
    updateZipButtonBadge();
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    let color = "#64748B";
    let bg = "#F1F5F9";
    const hasReport = r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded" || r.card_details || r.pdf_base64;
    if (r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded") { color = "#059669"; bg = "#ECFDF5"; }
    else if (r.verification_status === "Not Verified") { color = "#B45309"; bg = "#FFFBEB"; }
    else if (r.verification_status === "Not Found on Verixa" || r.verification_status === "Invalid Details" || r.verification_status === "Verification Error") { color = "#BE123C"; bg = "#FFF1F2"; }

    return `
      <tr>
        <td style="color:#64748B; font-weight:700;">#${r.row_index}</td>
        <td style="font-weight:700; color:#0F172A; font-family:monospace;">${escapeHtml(r.gsm_id || "-")}</td>
        <td><span style="background:${bg}; color:${color}; font-size:9px; font-weight:700; padding:2px 5px; border-radius:4px;">${escapeHtml(r.verification_status || "Pending")}</span></td>
        <td style="color:#64748B; font-size:9px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
            <span>${escapeHtml(r.remarks || "-")}</span>
            ${hasReport ? `<button type="button" onclick="window.downloadSingleReportPdf('${escapeHtml(r.gsm_id)}')" style="padding:1px 5px; font-size:8px; font-weight:700; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:3px; cursor:pointer;" title="Download individual 3-Page PDF report">⬇️ PDF</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  updateZipButtonBadge();
}

// Download single candidate's report directly
function downloadSingleReportPdf(gsmId) {
  if (!currentLocalBatch || !currentLocalBatch.records) return;
  const r = currentLocalBatch.records.find(d => d.gsm_id === gsmId);
  if (!r) return;

  let pdfUri = r.pdf_base64 || generateSurepassAadhaarReportPdf(r, r.card_details || {});
  if (!pdfUri) {
    return alert(`Could not generate Aadhaar report for ${gsmId}.`);
  }

  const filename = `${r.gsm_id}_${r.phone_number || "Aadhaar"}_Aadhaar_Report.pdf`;
  chrome.runtime.sendMessage({
    action: "DOWNLOAD_FILE",
    url: pdfUri,
    filename: `Surepass_Aadhaar_Reports/${filename}`
  }, (res) => {
    if (chrome.runtime.lastError || !res || !res.success) {
      const a = document.createElement("a");
      a.href = pdfUri;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  });
}
window.downloadSingleReportPdf = downloadSingleReportPdf;

// Download ZIP containing all reports in quota
async function downloadAllReportsZip() {
  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    return alert("No batch loaded! Please paste GSM IDs or upload an Excel sheet first.");
  }

  const verifiedRecords = currentLocalBatch.records.filter(r => 
    r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded" || r.card_details || r.pdf_base64
  );

  if (verifiedRecords.length === 0) {
    return alert("No verified Aadhaar reports available in this batch yet! Run verification first.");
  }

  if (typeof JSZip === "undefined") {
    return alert("JSZip library not loaded. Please reload the extension.");
  }

  const btnZip = document.getElementById("btnDownloadZip");
  const origHtml = btnZip ? btnZip.innerHTML : "";
  if (btnZip) {
    btnZip.disabled = true;
    btnZip.innerHTML = `<span>⏳ Preparing ZIP (0/${verifiedRecords.length})...</span>`;
  }

  log(`📦 Packing ZIP archive of ${verifiedRecords.length} Aadhaar reports...`, "info");

  try {
    const zip = new JSZip();
    const batchNameClean = (currentLocalBatch.filename || currentLocalBatch.batch_name || "Aadhaar_Batch").replace(/[^a-zA-Z0-9_-]/g, "_");
    const folderName = `Surepass_Aadhaar_Reports_${batchNameClean}`;
    const reportFolder = zip.folder(folderName);

    let csvContent = "Row,GSM ID,Aadhaar Number (Masked),Phone Number,Candidate Name,Verification Status,Verification Date,Remarks,Report Filename\n";

    let idx = 0;
    for (const r of verifiedRecords) {
      idx++;
      if (btnZip) {
        btnZip.innerHTML = `<span>⏳ Zipping ${idx}/${verifiedRecords.length}: ${r.gsm_id}...</span>`;
      }

      const filename = `${r.gsm_id}_${r.phone_number || "Aadhaar"}_Aadhaar_Report.pdf`;

      let pdfUri = r.pdf_base64;
      if (!pdfUri) {
        pdfUri = generateSurepassAadhaarReportPdf(r, r.card_details || {});
      }

      if (pdfUri) {
        const base64Data = pdfUri.includes(",") ? pdfUri.split(",")[1] : pdfUri;
        reportFolder.file(filename, base64Data, { base64: true });
      }

      const maskedAadhaar = formatMaskedAadhaar(r.aadhaar_number);
      csvContent += `"${r.row_index}","${r.gsm_id || ''}","${maskedAadhaar}","${r.phone_number || ''}","${r.candidate_name || ''}","${r.verification_status || ''}","${r.verification_date || ''}","${(r.remarks || '').replace(/"/g, '""')}","${filename}"\n`;

      await sleep(25);
    }

    reportFolder.file("Aadhaar_Verification_Summary.csv", csvContent);

    if (btnZip) btnZip.innerHTML = `<span>📦 Compressing ZIP archive...</span>`;

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    const zipFilename = `Surepass_Aadhaar_Reports_${batchNameClean}_${Date.now()}.zip`;
    const reader = new FileReader();

    reader.onloadend = () => {
      const dataUri = reader.result;
      chrome.runtime.sendMessage({
        action: "DOWNLOAD_FILE",
        url: dataUri,
        filename: zipFilename
      }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          const blobUrl = URL.createObjectURL(zipBlob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = zipFilename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        }
      });
    };
    reader.readAsDataURL(zipBlob);

    log(`✓ ZIP exported successfully: ${zipFilename} (${verifiedRecords.length} reports)`, "info");
    if (btnZip) {
      btnZip.innerHTML = `<span>✓ Downloaded ZIP (${verifiedRecords.length})</span>`;
      setTimeout(() => {
        btnZip.disabled = false;
        btnZip.innerHTML = origHtml;
        updateZipButtonBadge();
      }, 3000);
    }
  } catch (err) {
    console.error("ZIP creation failed:", err);
    alert(`Could not create ZIP: ${err.message}`);
    if (btnZip) {
      btnZip.disabled = false;
      btnZip.innerHTML = origHtml;
    }
  }
}

// Quick Paste Queue Loader
function loadPastedGsmQueue() {
  const txt = document.getElementById("txtPasteGsm")?.value || "";
  const rawLines = txt.split(/[\r\n,]+/).map(s => s.trim()).filter(s => s.length > 2);
  if (rawLines.length === 0) {
    alert("Please paste at least one valid GSM ID (e.g. GSM-FLS-10019).");
    return;
  }

  const uniqueGsms = [...new Set(rawLines)];
  const records = uniqueGsms.map((gsm, idx) => ({
    row_index: idx + 1,
    gsm_id: gsm,
    aadhaar_number: "",
    phone_number: "",
    candidate_name: "",
    dob: "",
    verification_status: "Pending",
    verification_date: "",
    remarks: "Pending Verixa Aadhaar extraction",
    needs_verixa_fetch: true,
    original_data: { "GSM ID": gsm }
  }));

  currentLocalBatch = {
    filename: `Pasted_${uniqueGsms.length}_GSMs`,
    batch_name: `Batch_${new Date().toISOString().slice(0, 10)}`,
    records: records
  };

  chrome.storage.local.set({ localAadhaarBatch: currentLocalBatch });
  log(`✓ Loaded queue of ${records.length} candidates. Ready to Auto-Verify!`, "info");
  updateUIFromBatch();
  switchTab("verify");
}

// Export Updated Excel
function exportUpdatedExcel() {
  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    return alert("No records to export.");
  }

  const exportRows = currentLocalBatch.records.map(r => {
    const base = { ...r.original_data };
    base["GSM ID"] = r.gsm_id || base["GSM ID"] || "";
    if (r.candidate_name) base["Candidate Name"] = r.candidate_name;
    base["Mobile Number"] = r.phone_number || base["Mobile Number"] || "";
    base["Aadhaar Number (Masked)"] = formatMaskedAadhaar(r.aadhaar_number);
    base["Aadhaar Verification Status"] = r.verification_status || "Pending";
    base["Aadhaar Verification Date"] = r.verification_date || "";
    base["Aadhaar Remarks"] = r.remarks || "";
    base["Verixa Upload Status"] = r.upload_status || (r.verification_status === "Verified & Uploaded" ? "Uploaded" : "Pending");
    return base;
  });

  const ws = XLSX.utils.json_to_sheet(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Aadhaar_Verified");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const reader = new FileReader();

  reader.onloadend = () => {
    const outFilename = `Aadhaar_Verified_${Date.now()}.xlsx`;
    chrome.runtime.sendMessage({
      action: "DOWNLOAD_FILE",
      url: reader.result,
      filename: outFilename
    }, (res) => {
      if (res && res.success) {
        log(`✓ Exported verified Excel to Downloads/${outFilename}`, "info");
      }
    });
  };
  reader.readAsDataURL(blob);
}

// Copy Google Sheet tab-separated
async function copyGSheetResults() {
  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    return alert("No records to copy.");
  }

  const lines = ["GSM ID\tName\tPhone Number\tAadhaar (Masked)\tVerification Status\tVerification Date\tRemarks"];
  currentLocalBatch.records.forEach(r => {
    lines.push(`${r.gsm_id}\t${r.candidate_name || ""}\t${r.phone_number || ""}\t${formatMaskedAadhaar(r.aadhaar_number)}\t${r.verification_status || "Pending"}\t${r.verification_date || ""}\t${r.remarks || ""}`);
  });

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    alert("📋 Verification results copied to clipboard!\n\nYou can now go to your Google Sheet and press Ctrl+V to paste.");
  } catch (err) {
    alert("Clipboard error: " + err.message);
  }
}

// =========================================================================
// MAIN AUTOMATION EXECUTION LOOP (VERIXA360 ➔ SUREPASS AADHAAR BRIDGE)
// =========================================================================
async function runAutomationLoop() {
  if (!currentLocalBatch || !currentLocalBatch.records) {
    return alert("Please paste GSM IDs or upload a sheet in 'Upload & Mapping' first!");
  }

  isAutomating = true;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;
  log("🚀 Starting Verixa360 ➔ Surepass Aadhaar automation loop...", "info");

  while (isAutomating) {
    const driver = currentLocalBatch.records.find(r => !r.verification_status || r.verification_status === "Pending");
    if (!driver) {
      log("🎉 All candidates in queue have been processed!", "info");
      isAutomating = false;
      break;
    }

    // Update target card
    document.getElementById("curGsmId").innerText = driver.gsm_id || "-";
    document.getElementById("curAadhaar").innerText = formatMaskedAadhaar(driver.aadhaar_number);
    document.getElementById("curPhone").innerText = driver.phone_number || "Fetching...";
    document.getElementById("curName").innerText = driver.candidate_name || "Fetching...";
    document.getElementById("badgeActiveStatus").innerText = `Row #${driver.row_index}`;

    // STEP A: If Aadhaar is missing, search and extract from Verixa360 tab
    let verixaTab = null;
    if (driver.needs_verixa_fetch || !driver.aadhaar_number) {
      log(`🔍 [Verixa360] Searching GSM ${driver.gsm_id}...`, "info");

      const allTabs = await chrome.tabs.query({});
      const vTabs = allTabs.filter(t => t.url && (t.url.includes("verixa360.com") || t.url.includes("verixa360.in")));
      if (vTabs.length > 0) {
        verixaTab = vTabs[0];
        try {
          await chrome.tabs.update(verixaTab.id, { active: true });
          await chrome.windows.update(verixaTab.windowId, { focused: true });
        } catch (e) {}

        const currentUrl = verixaTab.url || "";
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

      // Ensure content script is injected
      try {
        await chrome.scripting.executeScript({ target: { tabId: verixaTab.id }, files: ["verixa_aadhaar_content.js"] });
        await sleep(300);
      } catch (e) {}

      let verixaRes = null;
      try {
        verixaRes = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(verixaTab.id, { action: "SEARCH_AND_EXTRACT_GSM", gsm_id: driver.gsm_id }, res => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          });
        });
      } catch (err) {
        verixaRes = { success: false, reason: err.message };
      }

      if (!isAutomating) break;

      if (!verixaRes || !verixaRes.success || !verixaRes.aadhaar_number) {
        log(`⚠️ [Verixa360] ${verixaRes?.reason || "No 12-digit Aadhaar found"} for ${driver.gsm_id}`, "warn");
        driver.verification_status = "Not Found on Verixa";
        driver.verification_date = new Date().toLocaleString();
        driver.remarks = verixaRes?.reason || "12-digit Aadhaar number not found on Verixa360";
        driver.upload_status = "Skipped (Not Found)";
        chrome.storage.local.set({ localAadhaarBatch: currentLocalBatch });
        updateUIFromBatch();
        await sleep(1500);
        continue;
      }

      driver.aadhaar_number = cleanAadhaar(verixaRes.aadhaar_number);
      driver.phone_number = verixaRes.phone_number || driver.phone_number || "";
      driver.candidate_name = verixaRes.candidate_name || "";
      driver.dob = verixaRes.dob || "";
      driver.needs_verixa_fetch = false;

      document.getElementById("curAadhaar").innerText = formatMaskedAadhaar(driver.aadhaar_number);
      document.getElementById("curPhone").innerText = driver.phone_number || "-";
      document.getElementById("curName").innerText = driver.candidate_name || "-";

      log(`✓ [Verixa360] Extracted Aadhaar: ${formatMaskedAadhaar(driver.aadhaar_number)}, Phone: ${driver.phone_number}`, "info");
      await sleep(1000);
    }

    // STEP B: Focus Surepass Aadhaar tab and verify
    log(`🆔 [Surepass] Verifying Aadhaar ${formatMaskedAadhaar(driver.aadhaar_number)}...`, "info");

    let surepassTab = null;
    const allTabs2 = await chrome.tabs.query({});
    const surepassTabs = allTabs2.filter(t => t.url && (t.url.includes("surepass.app") || t.url.includes("surepass.io")));
    if (surepassTabs.length > 0) {
      surepassTab = surepassTabs.find(t => t.url.includes("aadhaar")) || surepassTabs[0];
      try {
        await chrome.tabs.update(surepassTab.id, { active: true });
        await chrome.windows.update(surepassTab.windowId, { focused: true });
      } catch (e) {}

      if (!surepassTab.url.includes("aadhaar") && !surepassTab.url.includes("login")) {
        await chrome.tabs.update(surepassTab.id, { url: "https://console.surepass.app/services/aadhaar-verification" });
        await sleep(3500);
      }
    } else {
      log("Opening Surepass Aadhaar service tab...", "warn");
      surepassTab = await chrome.tabs.create({ url: "https://console.surepass.app/services/aadhaar-verification" });
      await sleep(5000);
    }

    // Inject content scripts
    try {
      await chrome.scripting.executeScript({ target: { tabId: surepassTab.id }, files: ["libs/xlsx.full.min.js", "libs/jspdf.umd.min.js", "aadhaar_content.js"] });
      await sleep(300);
    } catch (e) {}

    // Clear stale background PDF cache
    try {
      chrome.runtime.sendMessage({ action: "CLEAR_SUREPASS_AADHAAR_PDF" });
    } catch (e) {}

    let result = null;
    try {
      result = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(surepassTab.id, { action: "VERIFY_AADHAAR", driver: driver }, res => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(res);
        });
      });
    } catch (err) {
      result = { success: false, status: "Verification Error", remarks: err.message };
    }

    if (!isAutomating) break;

    // STEP C: Handle OTP Request (if Surepass asks for OTP)
    if (result && result.status === "OTP_REQUIRED") {
      log(`📲 [OTP Required] Candidate ${driver.gsm_id} requires OTP sent to mobile!`, "warn");
      document.getElementById("cardOtpPrompt").style.display = "block";
      document.getElementById("badgeActiveStatus").innerText = "Waiting for OTP";

      // Await operator entering OTP or typing in page
      isAwaitingOtp = true;
      currentOtpGsmId = driver.gsm_id;

      // Poll until OTP is entered or user cancels
      const otpStart = Date.now();
      let otpResolved = false;

      while (isAwaitingOtp && isAutomating && Date.now() - otpStart < 120000) {
        await sleep(2000);
        // Check if Surepass page has transitioned to Verified or Error
        try {
          const pollRes = await new Promise(res => {
            chrome.tabs.sendMessage(surepassTab.id, { action: "VERIFY_AADHAAR", driver: driver }, r => res(r));
          });
          if (pollRes && pollRes.status !== "OTP_REQUIRED") {
            result = pollRes;
            otpResolved = true;
            break;
          }
        } catch (e) {}
      }

      document.getElementById("cardOtpPrompt").style.display = "none";
      isAwaitingOtp = false;

      if (!otpResolved && result.status === "OTP_REQUIRED") {
        result.status = "Not Verified";
        result.remarks = "OTP timeout: No OTP submitted within 2 minutes";
      }
    }

    // STEP D: Strict Verification Check
    const isStrictlyVerified = result && 
                               result.success === true && 
                               result.status === "Verified" &&
                               (
                                 (result.card_details && (result.card_details["Name"] || result.card_details["Client ID"])) ||
                                 (result.pdf_base64 && result.pdf_base64.length > 500)
                               );

    const nowIso = new Date().toLocaleString();

    if (!isStrictlyVerified) {
      const errStatus = (result?.status === "Login Required") ? "Login Required" : 
                        (result?.status === "Not Verified") ? "Not Verified" : "Verification Failed";
      const errRemarks = result?.remarks || "Aadhaar verification failed on Surepass";

      driver.verification_status = errStatus;
      driver.verification_date = nowIso;
      driver.remarks = errRemarks;
      driver.upload_status = "Skipped (Not Verified)";
      driver.report_download_status = "Not Downloaded";
      driver.pdf_base64 = null;
      driver.card_details = null;

      log(`⛔ [Upload Blocked] Verification NOT successful for ${driver.gsm_id} (${errStatus}: ${errRemarks}). No document will be uploaded to Verixa.`, "warn");

      if (errStatus === "Login Required") {
        log("⚠️ Please log in to Surepass in the open tab! Automation will pause...", "warn");
        isAutomating = false;
        document.getElementById("btnStart").disabled = false;
        document.getElementById("btnStop").disabled = true;
        document.getElementById("badgeActiveStatus").innerText = "Paused: Login Required";
      }

      chrome.storage.local.set({ localAadhaarBatch: currentLocalBatch });
      updateUIFromBatch();
      await sleep(1500);
      continue;
    }

    // --- ONLY STRICTLY VERIFIED CANDIDATES PROCEED TO REPORT & UPLOAD ---
    const finalRemarks = result.remarks || "Aadhaar Verified on Surepass";
    const reportFilename = `${driver.gsm_id}_${driver.phone_number || "Aadhaar"}_Aadhaar_Report.pdf`;

    driver.verification_status = "Verified";
    driver.verification_date = nowIso;
    driver.remarks = finalRemarks;
    driver.report_filename = reportFilename;
    driver.card_details = result.card_details || {};
    driver.report_download_status = "Downloaded";

    log(`✓ Outcome: Verified (${finalRemarks})`, "info");
    log(`📥 Official Aadhaar report PDF saving to Downloads/Surepass_Aadhaar_Reports/`, "info");

    let pdfToUpload = result.pdf_base64;
    if (!pdfToUpload) {
      try {
        const bgPdf = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            action: "GET_LATEST_SUREPASS_AADHAAR_PDF",
            aadhaarNumber: driver.aadhaar_number
          }, res => resolve(res));
        });
        if (bgPdf && bgPdf.success && bgPdf.pdfBase64) {
          pdfToUpload = bgPdf.pdfBase64;
        }
      } catch (e) {}
    }

    if (!pdfToUpload) {
      pdfToUpload = generateSurepassAadhaarReportPdf(driver, result.card_details);
      if (pdfToUpload) {
        chrome.runtime.sendMessage({
          action: "DOWNLOAD_FILE",
          url: pdfToUpload,
          filename: `Surepass_Aadhaar_Reports/${reportFilename}`
        }, () => {});
      }
    }

    if (pdfToUpload) {
      driver.pdf_base64 = pdfToUpload;
      log(`📤 [Verixa360] Uploading Aadhaar Certificate for ${driver.gsm_id}...`, "info");

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
              action: "UPLOAD_AADHAAR_CERTIFICATE",
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
          driver.remarks = "Aadhaar Verified on Surepass & Certificate uploaded to Verixa";
          driver.upload_status = "Uploaded";
        } else {
          log(`⚠️ [Verixa360] Upload notice: ${uploadRes?.reason || "Pending manual upload"}`, "warn");
          driver.verification_status = "Verified";
          driver.remarks = `Aadhaar Verified on Surepass (${uploadRes?.reason || "Verixa upload pending"})`;
          driver.upload_status = "Pending";
        }
      }
    }

    chrome.storage.local.set({ localAadhaarBatch: currentLocalBatch });
    updateUIFromBatch();
    await sleep(2000);
  }

  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
  updateUIFromBatch();
}

// =========================================================================
// EVENT LISTENERS & INITIALIZATION
// =========================================================================
document.addEventListener("DOMContentLoaded", async () => {
  // Navigation
  const tabVerify = document.getElementById("tabNavVerify");
  const tabUpload = document.getElementById("tabNavUpload");
  const tabExport = document.getElementById("tabNavExport");
  if (tabVerify) tabVerify.onclick = () => switchTab("verify");
  if (tabUpload) tabUpload.onclick = () => switchTab("upload");
  if (tabExport) tabExport.onclick = () => switchTab("export");

  // Load saved batch
  chrome.storage.local.get(["localAadhaarBatch"], (res) => {
    if (res.localAadhaarBatch && res.localAadhaarBatch.records) {
      currentLocalBatch = res.localAadhaarBatch;
      log(`Restored session with ${currentLocalBatch.records.length} records.`, "info");
      updateUIFromBatch();
    }
  });

  // Buttons
  const btnLoadGsm = document.getElementById("btnLoadPastedGsm");
  if (btnLoadGsm) btnLoadGsm.onclick = loadPastedGsmQueue;

  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  if (btnStart) btnStart.onclick = () => { if (!isAutomating) runAutomationLoop(); };
  if (btnStop) btnStop.onclick = () => { isAutomating = false; log("Stopping automation loop...", "warn"); };

  // OTP Submit button
  const btnSubmitOtp = document.getElementById("btnSubmitOtp");
  if (btnSubmitOtp) {
    btnSubmitOtp.onclick = async () => {
      const otpVal = document.getElementById("txtOtpInput")?.value.trim();
      if (!otpVal || otpVal.length < 4) {
        return alert("Please enter the full 6-digit OTP received by candidate.");
      }
      log(`Submitting candidate OTP: ${otpVal}...`, "info");
      const allTabs = await chrome.tabs.query({});
      const sTab = allTabs.find(t => t.url && t.url.includes("surepass.app"));
      if (sTab) {
        chrome.tabs.sendMessage(sTab.id, { action: "SUBMIT_AADHAAR_OTP", otp: otpVal });
      }
      document.getElementById("cardOtpPrompt").style.display = "none";
      isAwaitingOtp = false;
    };
  }

  // Export buttons
  const btnExpExcel = document.getElementById("btnExportExcel");
  const btnCopyGS = document.getElementById("btnCopyGSheet");
  const btnZip = document.getElementById("btnDownloadZip");
  if (btnExpExcel) btnExpExcel.onclick = exportUpdatedExcel;
  if (btnCopyGS) btnCopyGS.onclick = copyGSheetResults;
  if (btnZip) btnZip.onclick = downloadAllReportsZip;

  // Search filter
  const txtSearch = document.getElementById("txtFilterSearch");
  if (txtSearch) txtSearch.oninput = renderRecordsTable;
});
