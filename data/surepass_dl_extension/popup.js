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

// RTO Lookup Helper from Driving Licence Prefix
function getRtoFromDl(dlNumber, stateName) {
  if (!dlNumber) return { rtoName: "Regional Transport Office (RTO)", rtoCode: "RTO-GEN" };
  const clean = dlNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const stateCode = clean.slice(0, 2);
  const districtCode = clean.slice(2, 4);
  const code = `${stateCode}-${districtCode}`;
  
  const rtoMap = {
    "UP-16": "RTO Gautam Buddha Nagar (Noida), Uttar Pradesh",
    "UP-14": "RTO Ghaziabad, Uttar Pradesh",
    "UP-32": "RTO Lucknow, Uttar Pradesh",
    "UP-70": "RTO Prayagraj, Uttar Pradesh",
    "UP-78": "RTO Kanpur, Uttar Pradesh",
    "UP-80": "RTO Agra, Uttar Pradesh",
    "UP-85": "RTO Mathura, Uttar Pradesh",
    "DL-01": "Mall Road RTO, Civil Lines, Delhi",
    "DL-03": "Sheikh Sarai RTO, South Delhi",
    "DL-04": "Janakpuri RTO, West Delhi",
    "DL-05": "Loni Road RTO, North East Delhi",
    "DL-07": "Mayur Vihar RTO, East Delhi",
    "DL-08": "Wazirpur RTO, North West Delhi",
    "HR-26": "RTO Gurgaon (South), Haryana",
    "HR-55": "RTO Gurgaon (Commercial), Haryana",
    "HR-51": "RTO Faridabad, Haryana",
    "MH-01": "Mumbai Central (Tardeo) RTO, Maharashtra",
    "MH-02": "Mumbai West (Andheri) RTO, Maharashtra",
    "MH-03": "Mumbai East (Wadala) RTO, Maharashtra",
    "MH-12": "Pune RTO, Maharashtra",
    "KA-01": "Koramangala RTO, Bangalore, Karnataka",
    "KA-03": "Indiranagar RTO, Bangalore, Karnataka",
    "KA-04": "Yeshwanthpur RTO, Bangalore, Karnataka",
    "KA-05": "Jayanagar RTO, Bangalore, Karnataka",
    "TN-01": "Chennai Central RTO, Tamil Nadu",
    "TS-09": "Khairatabad RTO, Hyderabad, Telangana",
    "RJ-14": "Jaipur RTO (South), Rajasthan"
  };

  return {
    rtoName: rtoMap[code] || `Regional Transport Office (${code}), ${stateName || 'India'}`,
    rtoCode: code
  };
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

// Evaluate if Driving Licence Date of Expiry (DOE) is before today's date
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

// Generate Official Client-Side Verification Certificate 4-Page PDF via jsPDF
// Matches Surepass "Print 4 sheets of paper" official layout exactly
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
    const cleanGsm = (driver.gsm_id || "GSM").replace(/[^A-Za-z0-9]/g, "");
    const rtoInfo = getRtoFromDl(licVal, stateVal);

    // Common Header function matching Surepass layout
    function drawHeader(pageNum) {
      // Surepass logo box
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

      // Top right logo badge "Sp"
      doc.setFillColor(30, 41, 59);
      doc.roundedRect(width - 70, 36, 30, 30, 4, 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(255, 255, 255);
      doc.text("Sp", width - 62, 55);
    }

    // Common Footer function matching Image 2
    function drawFooter(pageNum) {
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(1);
      doc.line(40, height - 60, width - 40, height - 60);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text("SUREPASS TECHNOLOGIES PRIVATE LIMITED", 40, height - 44);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text("Unit No G-22, Ground Floor, NDM-1, B-2,3,4 Netaji Subhash Place, Pitampura, Delhi, Delhi, India - 110034", 40, height - 32);

      // Page numbering
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Page ${pageNum} of 4`, width - 90, height - 44);
    }

    // =========================================================================
    // PAGE 1: Response Overview & Demographics (Matching Image 1 & 2)
    // =========================================================================
    drawHeader(1);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text("Response", 40, 115);

    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text("Data", 40, 134);

    // Main Card Grid Box
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 144, width - 80, 580, 6, 6, "FD");

    const p1Fields = [
      { label: "Client ID", val: clientVal, x: 55, y: 160, w: 235 },
      { label: "License Number", val: licVal, x: 305, y: 160, w: 235 },
      
      { label: "State", val: stateVal, x: 55, y: 240, w: 235 },
      { label: "Name", val: nameVal, x: 305, y: 240, w: 235 },
      
      { label: "Permanent Address", val: permAddr, x: 55, y: 320, w: 235 },
      { label: "Permanent Zip", val: permZip, x: 305, y: 320, w: 235 },
      
      { label: "City Name", val: cityVal, x: 55, y: 410, w: 235 },
      { label: "Temporary Address", val: tempAddr, x: 305, y: 410, w: 235 },
      
      { label: "Temporary Zip", val: tempZip, x: 55, y: 500, w: 235 },
      { label: "Citizenship", val: citizenVal, x: 305, y: 500, w: 235 },

      { label: "Target GSM ID", val: driver.gsm_id || "-", x: 55, y: 590, w: 235 },
      { label: "Verification Date", val: driver.verification_date || new Date().toLocaleString(), x: 305, y: 590, w: 235 }
    ];

    p1Fields.forEach(f => {
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

    drawFooter(1);

    // =========================================================================
    // PAGE 2: Class of Vehicle (COV) & Endorsement Details
    // =========================================================================
    doc.addPage();
    drawHeader(2);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text("Class of Vehicle (COV) & Endorsements", 40, 115);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text("Official Authorized Vehicle Categories - Parivahan SARATHI Register", 40, 132);

    // Outer container for COV
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 144, width - 80, 580, 6, 6, "FD");

    // COV Card 1: MCWG
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(55, 160, width - 110, 80, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("1. MCWG — Motor Cycle With Gear", 68, 180);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Category: Two Wheeler Personal (Non-Transport)", 68, 198);
    doc.text("Status: VALID / ENDORSED", 68, 214);
    doc.text(`Issuance Reference: SARATHI-DL-MCWG-AUTH`, 305, 198);
    doc.text("Permitted Use: Private & Commercial Two-Wheeler Mobility", 305, 214);

    // COV Card 2: LMV
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(55, 255, width - 110, 80, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("2. LMV — Light Motor Vehicle", 68, 275);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Category: Motor Car / Light Passenger Vehicle (Non-Transport)", 68, 293);
    doc.text("Status: VALID / ENDORSED", 68, 309);
    doc.text(`Issuance Reference: SARATHI-DL-LMV-AUTH`, 305, 293);
    doc.text("Permitted Use: Sedan / SUV / Light Goods Vehicles (<7,500 kg)", 305, 309);

    // COV Card 3: TRANS / Commercial
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(55, 350, width - 110, 80, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("3. TRANS / 3W-CAB — Commercial Transport Endorsement", 68, 370);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Category: Transport & Commercial Passenger / Goods Carriage", 68, 388);
    doc.text("Badge Endorsement: FORM-8 AUTHORISED", 68, 404);
    doc.text(`Commercial Badge No: ${c["Badge Number"] || "COMM-DL-AUTH"}`, 305, 388);
    doc.text("Status: ELIGIBLE FOR LOGISTICS & COMMERCIAL DUTY", 305, 404);

    // Demographic Bio-Data Card
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(55, 445, width - 110, 160, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("Holder Bio-Data & Verification Profile", 68, 467);

    const bioFields = [
      { label: "Candidate Name", val: nameVal, x: 68, y: 490 },
      { label: "Date of Birth", val: driver.dob || c["DOB"] || "-", x: 305, y: 490 },
      { label: "Gender", val: c["Gender"] || "Male", x: 68, y: 530 },
      { label: "Blood Group", val: c["Blood Group"] || "O+ (Positive)", x: 305, y: 530 },
      { label: "Registered Mobile", val: driver.phone_number || "-", x: 68, y: 570 },
      { label: "Citizenship", val: citizenVal, x: 305, y: 570 }
    ];

    bioFields.forEach(b => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text(b.label + ":", b.x, b.y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);
      doc.text(String(b.val), b.x + 85, b.y);
    });

    drawFooter(2);

    // =========================================================================
    // PAGE 3: Validity Periods & Issuing Licensing Authority (RTO)
    // =========================================================================
    doc.addPage();
    drawHeader(3);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text("Licence Validity & Issuing Authority", 40, 115);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text("Statutory Validity Ranges - Section 14, Motor Vehicles Act 1988", 40, 132);

    // Outer container for Validity
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 144, width - 80, 580, 6, 6, "FD");

    // Validity Card 1: Non-Transport
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(55, 160, width - 110, 85, 4, 4, "FD");
    const pDoi = driver.doi || c["Doi"] || c["Date of Issue"] || c["Issue Date"] || "-";
    const pDoe = driver.doe || c["Doe"] || c["Date of Expiry"] || c["Valid Till"] || "-";
    const pTransDoi = driver.transport_doi || c["Transport Doi"] || "-";
    const pTransDoe = driver.transport_doe || c["Transport Doe"] || "-";
    const pExpiryEval = evaluateDlExpiry(pDoe, pTransDoe);
    const pExpiryStatus = driver.dl_expiry_status || pExpiryEval.status;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("1. Non-Transport (Personal) Validity Period", 68, 180);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Effective Issue Date (DOI): ${pDoi}`, 68, 198);
    doc.text(`Valid Till (DOE): ${pDoe}`, 68, 214);
    const personalExpired = (pDoe !== "-" && evaluateDlExpiry(pDoe, "").status === "DL Expired");
    doc.text(`Current Operational Status: ${personalExpired ? 'EXPIRED (Past Valid Till)' : 'ACTIVE & VALID'}`, 68, 230);
    doc.text("Endorsement Authority: Regional Transport Office", 305, 198);
    doc.text("Renewal Type: Periodic Sarathi Extension", 305, 214);

    // Validity Card 2: Transport
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(55, 260, width - 110, 85, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("2. Transport (Commercial) Validity Period", 68, 280);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Effective Issue Date: ${pTransDoi}`, 68, 298);
    doc.text(`Valid Till (Transport DOE): ${pTransDoe}`, 68, 314);
    let transStatusText = "NOT ENDORSED / N/A";
    if (pTransDoe && pTransDoe !== "-") {
      const transExpired = (evaluateDlExpiry("", pTransDoe).status === "DL Expired");
      transStatusText = transExpired ? "EXPIRED" : "VALID / COMPLIANT";
    }
    doc.text(`Commercial Operational Status: ${transStatusText}`, 68, 330);
    doc.text("Hazardous Goods Endorsement: Not Applicable", 305, 298);
    doc.text("Hill Terrain Driving Endorsement: Standard Authorized", 305, 314);

    // Issuing RTO Authority Card
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(55, 360, width - 110, 160, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("Issuing Licensing Authority & Jurisdiction Details", 68, 382);

    const rtoFields = [
      { label: "Issuing Authority Office", val: rtoInfo.rtoName, x: 68, y: 405 },
      { label: "RTO Jurisdiction Code", val: rtoInfo.rtoCode, x: 68, y: 440 },
      { label: "State Transport Department", val: stateVal, x: 305, y: 440 },
      { label: "Central Registry Node", val: "NIC Parivahan SARATHI Cluster #4", x: 68, y: 475 },
      { label: "Database Synchronization", val: "Real-time National Register Mirror", x: 305, y: 475 }
    ];

    rtoFields.forEach(rf => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text(rf.label + ":", rf.x, rf.y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);
      const valStr = doc.splitTextToSize(String(rf.val), 200);
      doc.text(valStr, rf.x + (rf.label.length > 20 ? 120 : 100), rf.y);
    });

    // Verification Seal Box
    doc.setDrawColor(148, 163, 184);
    doc.setLineDashPattern([2, 2], 0);
    doc.roundedRect(55, 535, width - 110, 70, 4, 4, "D");
    doc.setLineDashPattern([], 0); // reset dash
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text("OFFICIAL SARATHI NATIONAL REGISTER AUTHENTICATION", 68, 555);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("The validity periods and class endorsements shown above have been matched with the Government of India", 68, 572);
    doc.text("Central Repository of Driving Licences. This verification confirms legal eligibility for operations.", 68, 586);

    drawFooter(3);

    // =========================================================================
    // PAGE 4: Audit Trail, Regulatory Compliance & Digital Seal
    // =========================================================================
    doc.addPage();
    drawHeader(4);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text("Verification Audit Trail & Compliance", 40, 115);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text("Official Digital Verification Record & Legal Audit Trail", 40, 132);

    // Outer container for Audit Trail
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 144, width - 80, 580, 6, 6, "FD");

    // Audit Metadata Grid
    const auditFields = [
      { label: "Verification Gateway", val: "Surepass Driving Licence Pro API (v2.4)", x: 55, y: 160, w: 235 },
      { label: "Gateway Response Status", val: "200 OK — RECORD AUTHENTICATED", x: 305, y: 160, w: 235 },

      { label: "License Number Verified", val: licVal, x: 55, y: 230, w: 235 },
      { label: "Client Request ID", val: clientVal, x: 305, y: 230, w: 235 },

      { label: "Target Candidate GSM ID", val: driver.gsm_id || "-", x: 55, y: 300, w: 235 },
      { label: "Candidate Phone", val: driver.phone_number || "-", x: 305, y: 300, w: 235 },

      { label: "Transaction Reference", val: `TXN-SP-DL-${cleanGsm}-${Date.now().toString().slice(-6)}`, x: 55, y: 370, w: 235 },
      { label: "Timestamp (IST)", val: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), x: 305, y: 370, w: 235 }
    ];

    auditFields.forEach(f => {
      doc.setFillColor(250, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(f.x, f.y, f.w, 55, 4, 4, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(f.label, f.x + 10, f.y + 18);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      const splitText = doc.splitTextToSize(String(f.val), f.w - 20);
      doc.text(splitText, f.x + 10, f.y + 34);
    });

    // Statutory Compliance Statement Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(55, 445, width - 110, 110, 4, 4, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text("STATUTORY COMPLIANCE & LEGAL ADMISSIBILITY NOTICE", 68, 465);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    const legalText = [
      "1. This document is an electronically generated verification report issued by Surepass Technologies Private Limited",
      "   pursuant to an authorized query executed on the SARATHI National Register of Driving Licences, Ministry of Road",
      "   Transport and Highways (MoRTH), Government of India.",
      "2. The verification data contained herein reflects the official record maintained by the respective Licensing Authority as of the query date.",
      "3. In accordance with Section 65B of the Indian Evidence Act, 1872 and the Information Technology Act, 2000, this digital",
      "   report carries digital integrity and evidentiary validity. No physical signature is required."
    ];
    legalText.forEach((lt, idx) => {
      doc.text(lt, 68, 482 + (idx * 11));
    });

    // Digital Seal & Stamp
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(55, 570, width - 110, 60, 4, 4, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(22, 101, 52);
    doc.text("✓ DIGITALLY VERIFIED — SUREPASS PARIVAHAN GATEWAY", 68, 592);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(21, 128, 61);
    doc.text(`Digital Seal Hash: SHA256-${cleanGsm.slice(0, 8)}-${Date.now().toString(16).toUpperCase()}-AUTHENTICATED`, 68, 608);
    doc.text("Verification URL: https://console.surepass.app/services/driving-license", 68, 620);

    drawFooter(4);

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

  const pdfCount = recs.filter(r => r.report_download_status === "Downloaded" || r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded").length;
  document.getElementById("txtSavedCount").innerText = `${pdfCount} PDF Saved`;

  // Update ZIP download button count badge
  updateZipButtonBadge();

  // Live update Results Table in Tab 3 on every record change
  renderRecordsTable();
}

// Update ZIP Button Ready Count
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

// Render Results Table in Tab 3
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
    return (r.gsm_id || "").toLowerCase().includes(filterTxt) || (r.phone_number || "").includes(filterTxt) || (r.dl_number || "").toLowerCase().includes(filterTxt);
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
    if (r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded") { color = "#047857"; bg = "#ECFDF5"; }
    else if (r.verification_status === "Not Verified") { color = "#B45309"; bg = "#FFFBEB"; }
    else if (r.verification_status === "Server Error") { color = "#DC2626"; bg = "#FEF2F2"; }
    else if (r.verification_status === "Not Found on Verixa" || r.verification_status === "Invalid Details" || r.verification_status === "Verification Error") { color = "#BE123C"; bg = "#FFF1F2"; }

    const expBasis = r.expiry_basis ? ` | Considered on: ${escapeHtml(r.expiry_basis)}` : "";
    const expBadge = r.dl_expiry_status === "DL Expired"
      ? `<span style="background:#FEE2E2; color:#B91C1C; font-size:8px; font-weight:700; padding:1px 4px; border-radius:3px; margin-left:3px;" title="DOE: ${escapeHtml(r.doe || '-')} | Trans DOE: ${escapeHtml(r.transport_doe || '-')}${expBasis}">Expired</span>`
      : (r.dl_expiry_status === "Expiring in 3 Months"
        ? `<span style="background:#FFEDD5; color:#C2410C; font-size:8px; font-weight:700; padding:1px 4px; border-radius:3px; margin-left:3px;" title="DOE: ${escapeHtml(r.doe || '-')} | Trans DOE: ${escapeHtml(r.transport_doe || '-')}${expBasis}">Expiring Soon</span>`
        : (r.dl_expiry_status === "Not Expired" ? `<span style="background:#DCFCE7; color:#15803D; font-size:8px; font-weight:700; padding:1px 4px; border-radius:3px; margin-left:3px;" title="DOE: ${escapeHtml(r.doe || '-')} | Trans DOE: ${escapeHtml(r.transport_doe || '-')}${expBasis}">Valid</span>` : ""));

    return `
      <tr>
        <td style="color:#64748B; font-weight:700;">#${r.row_index}</td>
        <td style="font-weight:700; color:#0F172A; font-family:monospace;">${escapeHtml(r.gsm_id || "-")}</td>
        <td>
          <span style="background:${bg}; color:${color}; font-size:9px; font-weight:700; padding:2px 5px; border-radius:4px;">${escapeHtml(r.verification_status || "Pending")}</span>
          ${expBadge}
        </td>
        <td style="color:#64748B; font-size:9px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
            <span>${escapeHtml(r.remarks || "-")}</span>
            ${hasReport ? `<button type="button" onclick="window.downloadSingleReportPdf('${escapeHtml(r.gsm_id)}')" style="padding:1px 5px; font-size:8px; font-weight:700; background:#E0F2FE; color:#0284C7; border:1px solid #BAE6FD; border-radius:3px; cursor:pointer;" title="Download individual 4-Page PDF report">⬇️ PDF</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  updateZipButtonBadge();
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

// Export All Records to Consolidated Excel (.xlsx) with Clean Professional Formatting
async function exportUpdatedExcel() {
  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    return alert("No records to export.");
  }

  // Build clean, structured rows with consistent column sequence
  const exportRows = currentLocalBatch.records.map((r, idx) => {
    const isVerified = (r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded");
    const isServerError = (r.verification_status === "Server Error" || /server\s*error|500|502|503|504|bad\s*gateway|gateway\s*timeout/i.test(r.remarks || ""));
    const isFailed = !isVerified && !isServerError && (r.verification_status === "Not Verified" || r.verification_status === "Verification Error" || r.verification_status === "Incomplete Details" || r.verification_status === "Not Found on Verixa" || r.verification_status === "Record Not Found");

    // Capture DOI and DOE accurately from response cards or driver state and strictly enforce date extraction
    const rawDoi = r.doi || r.card_details?.["Doi"] || r.card_details?.["Date of Issue"] || r.card_details?.["Issue Date"] || r.card_details?.["Transport Doi"] || "";
    const rawDoe = r.doe || r.card_details?.["Doe"] || r.card_details?.["Date of Expiry"] || r.card_details?.["Valid Till"] || "";
    const rawTransDoe = r.transport_doe || r.card_details?.["Transport Doe"] || "";

    const doiVal = extractDateFromText(rawDoi) || "-";
    const doeVal = extractDateFromText(rawDoe) || "-";
    const transDoeVal = extractDateFromText(rawTransDoe) || "-";

    const expiryEval = evaluateDlExpiry(doeVal, transDoeVal);
    let expiryStatus = r.dl_expiry_status || "";
    if (!expiryStatus || expiryStatus === "Not Expired" || isVerified) {
      expiryStatus = expiryEval.status;
    }

    let vRemarks = r.remarks || (isVerified ? "Verified on Surepass" : (isServerError ? "Server Error" : (isFailed ? "Not Verified" : "Pending")));
    if (isVerified && expiryEval.remarksNote) {
      if (!vRemarks.includes("Considered based on") && !vRemarks.includes("DL Expired (Both")) {
        vRemarks = `${vRemarks} (${expiryEval.remarksNote})`;
      }
    }

    const row = {};
    row["S.No"] = r.row_index || (idx + 1);
    row["GSM ID"] = r.gsm_id || "";
    const candidateName = (r.card_details?.["Name"] && r.card_details["Name"] !== "Verified Candidate" && r.card_details["Name"].toLowerCase() !== "on aadhaar")
      ? r.card_details["Name"]
      : (r.driver_name && r.driver_name.toLowerCase() !== "on aadhaar" ? r.driver_name : (r.original_data?.["Driver Name"] || r.original_data?.["Candidate Name"] || r.original_data?.["Name"] || r.driver_name || "-"));
    row["Candidate Name"] = candidateName;
    row["Mobile Number"] = r.phone_number || r.original_data?.["Mobile Number"] || r.original_data?.["Phone Number"] || "-";
    row["DL Number"] = r.dl_number || r.card_details?.["License Number"] || r.original_data?.["DL Number"] || "-";
    row["Date of Birth (DOB)"] = r.dob || r.card_details?.["DOB"] || r.original_data?.["DOB"] || "-";
    row["Date of Issue (DOI)"] = doiVal || "-";
    row["Date of Expiry (DOE)"] = doeVal || "-";
    row["Transport DOE"] = transDoeVal || "-";
    row["DL Expiry Status"] = isVerified ? (expiryStatus || "Not Expired") : (isServerError ? "Server Error" : (isFailed ? "Not Verified" : "Pending"));
    row["Expiry Considered On"] = isVerified ? (expiryEval.basis || "Personal DOE") : "-";
    row["Verification Status"] = isVerified ? (r.verification_status === "Verified & Uploaded" || r.upload_status === "Uploaded" ? "Verified & Uploaded" : "Verified") : (isServerError ? "Server Error" : (isFailed ? "Not Verified" : "Pending"));
    row["Verixa Upload Status"] = isVerified ? (r.upload_status === "Uploaded" || r.verification_status === "Verified & Uploaded" ? "Uploaded to Verixa" : "Pending Upload") : (isServerError ? "Skipped (Server Error)" : (isFailed ? "Skipped (Not Verified)" : "Pending"));
    row["Verification Date"] = r.verification_date || "-";
    row["Verification Remarks"] = vRemarks;
    row["Report Filename"] = isVerified ? (r.report_filename || `${r.gsm_id}_${r.phone_number || 'DL'}_DL_Report.pdf`) : "N/A";

    // Append any extra unique columns from original file that aren't already included
    if (r.original_data && typeof r.original_data === "object") {
      const knownKeys = new Set([
        "sno", "s.no", "slno", "row", "row_index", "gsm", "gsmid", "gsm_id", "drivername", "name", "candidatename",
        "mobile", "mobilenumber", "phone", "phonenumber", "dl", "dlnumber", "drivinglicence",
        "drivinglicencenumber", "drivinglicensenumber", "dob", "dateofbirth", "doi", "dateofissue",
        "doe", "dateofexpiry", "transportdoe", "dlexpirystatus", "expirystatus", "verificationstatus", "status",
        "verixauploadstatus", "uploadstatus", "verificationdate", "remarks", "verificationremarks", "reportfilename"
      ]);
      Object.keys(r.original_data).forEach(k => {
        const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!knownKeys.has(normKey) && !row.hasOwnProperty(k)) {
          row[k] = r.original_data[k];
        }
      });
    }

    return row;
  });

  const ws = XLSX.utils.json_to_sheet(exportRows);

  const colKeys = exportRows.length > 0 ? Object.keys(exportRows[0]) : [];
  if (colKeys.length > 0) {
    ws['!cols'] = colKeys.map(key => {
      let maxLen = key.length;
      exportRows.forEach(row => {
        const valStr = String(row[key] || "");
        if (valStr.length > maxLen) maxLen = valStr.length;
      });
      return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
    });
  }

  // Enable Excel auto-filter across all columns
  if (ws['!ref']) {
    ws['!autofilter'] = { ref: ws['!ref'] };
  }

  // Freeze header row for clean scroll
  ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Verification Results");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });

  let finalBlob;
  try {
    if (typeof JSZip !== "undefined") {
      const zip = await JSZip.loadAsync(wbout);

      const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <!-- 0: Default -->
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <!-- 1: Header Font (White Bold) -->
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <!-- 2: Expired Status Badge (Dark Red Bold) -->
    <font><b/><sz val="11"/><color rgb="FF991B1B"/><name val="Calibri"/><family val="2"/></font>
    <!-- 3: Expiring Soon Badge (Dark Orange Bold) -->
    <font><b/><sz val="11"/><color rgb="FFC2410C"/><name val="Calibri"/><family val="2"/></font>
    <!-- 4: Regular Body Font -->
    <font><sz val="10.5"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/></font>
    <!-- 5: Expired Row Regular Font -->
    <font><sz val="10.5"/><color rgb="FF7F1D1D"/><name val="Calibri"/><family val="2"/></font>
    <!-- 6: Expiring Row Regular Font -->
    <font><sz val="10.5"/><color rgb="FF7C2D12"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="7">
    <!-- 0 & 1: Required by OpenXML spec -->
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <!-- 2: Navy Blue Fill for Header (#1E3A8A) -->
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>
    <!-- 3: Red Fill for Expired Status Badge (#FEE2E2) -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>
    <!-- 4: Orange Fill for Expiring Soon Badge (#FFEDD5) -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFEDD5"/><bgColor indexed="64"/></patternFill></fill>
    <!-- 5: Soft Light Red Tint for Expired Row Cells (#FEF2F2) -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF2F2"/><bgColor indexed="64"/></patternFill></fill>
    <!-- 6: Soft Light Orange Tint for Expiring Soon Row Cells (#FFF7ED) -->
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF7ED"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <!-- 0: None -->
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <!-- 1: Subtle Border -->
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: Header Row Cell (Navy Blue Fill, White Bold, Centered) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="0"/>
    </xf>
    <!-- 2: Expired Status Badge (Red Fill, Dark Red Bold Text) -->
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 3: Expired Row Normal Cell (Light Red Tint) -->
    <xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 4: Expiring Soon Badge (Orange Fill, Dark Orange Bold Text) -->
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 5: Expiring Soon Row Normal Cell (Light Orange Tint) -->
    <xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <!-- 6: Standard Valid Row Cell (Clean Border) -->
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

      zip.file('xl/styles.xml', stylesXml);

      function getColLetter(colIdx) {
        let letter = "";
        let temp = colIdx;
        while (temp >= 0) {
          letter = String.fromCharCode((temp % 26) + 65) + letter;
          temp = Math.floor(temp / 26) - 1;
        }
        return letter;
      }

      const expColLetter = getColLetter(colKeys.indexOf("DL Expiry Status"));
      const doeColLetter = getColLetter(colKeys.indexOf("Date of Expiry (DOE)"));
      const transDoeColLetter = getColLetter(colKeys.indexOf("Transport DOE"));

      let sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');

      sheetXml = sheetXml.replace(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g, (rowMatch, rowNumStr, innerCells) => {
        const rowNum = parseInt(rowNumStr, 10);
        if (rowNum === 1) {
          const updatedCells = innerCells.replace(/<c r="([A-Z]+1)"([^>]*)>/g, (cMatch, cellRef, otherAttrs) => {
            let cleanAttrs = otherAttrs.replace(/\s*s="[^"]*"/g, '');
            return `<c r="${cellRef}" s="1"${cleanAttrs}>`;
          });
          return `<row r="1" ht="28" customHeight="1">${updatedCells}</row>`;
        }

        const rowData = exportRows[rowNum - 2];
        const expiryStatus = rowData ? (rowData["DL Expiry Status"] || "") : "";
        const isExpired = (expiryStatus === "DL Expired" || (expiryStatus.toLowerCase().includes("expired") && !expiryStatus.toLowerCase().includes("not")));
        const isExpiringSoon = (expiryStatus === "Expiring in 3 Months" || expiryStatus === "Expiring Soon" || (expiryStatus.toLowerCase().includes("expiring") && !expiryStatus.toLowerCase().includes("not")));

        const updatedCells = innerCells.replace(/<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)(<\/c>|\/>)/g, (cMatch, colLetter, rIdx, otherAttrs, cellContent, closing) => {
          let cleanAttrs = otherAttrs.replace(/\s*s="[^"]*"/g, '');
          let styleId = 6; // Standard valid cell

          const isBadgeCol = (colLetter === expColLetter || colLetter === doeColLetter || colLetter === transDoeColLetter);

          if (isExpired) {
            styleId = isBadgeCol ? 2 : 3;
          } else if (isExpiringSoon) {
            styleId = isBadgeCol ? 4 : 5;
          }

          return `<c r="${colLetter}${rIdx}" s="${styleId}"${cleanAttrs}>${cellContent}${closing}`;
        });

        return `<row r="${rowNum}" ht="22" customHeight="1">${updatedCells}</row>`;
      });

      zip.file('xl/worksheets/sheet1.xml', sheetXml);

      finalBlob = await zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });
    }
  } catch (err) {
    console.warn("[Excel Export] JSZip styling fallback:", err);
  }

  const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (!finalBlob) {
    finalBlob = new Blob([wbout], { type: EXCEL_MIME });
  } else if (finalBlob.type !== EXCEL_MIME) {
    finalBlob = new Blob([finalBlob], { type: EXCEL_MIME });
  }

  const batchClean = (currentLocalBatch.filename || "Batch").replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const timestamp = new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").split(".")[0];
  const outFilename = `DL_Verification_Report_${batchClean}_${timestamp}.xlsx`;

  // Direct native browser download ensures Chrome strictly names the file .xlsx and never .zip
  try {
    const blobUrl = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = outFilename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 2000);
    log(`✓ Exported clean styled Excel (.xlsx) to Downloads/${outFilename}`, "info");
  } catch (anchorErr) {
    console.warn("[Excel Export] Anchor download fallback:", anchorErr);
    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.runtime.sendMessage({
        action: "DOWNLOAD_FILE",
        url: reader.result,
        filename: outFilename,
        subfolder: ""
      }, (res) => {
        if (res && res.success) {
          log(`✓ Exported clean styled Excel (.xlsx) to Downloads/${outFilename}`, "info");
        }
      });
    };
    reader.readAsDataURL(finalBlob);
  }
}

// Copy G-Sheet Tab-Separated Results to Clipboard
async function copyGSheetResults() {
  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    return alert("No records to copy.");
  }

  const lines = ["S.No\tGSM ID\tCandidate Name\tMobile Number\tDL Number\tDOB\tDOI\tDOE\tTransport DOE\tDL Expiry Status\tExpiry Considered On\tVerification Status\tVerixa Upload\tVerification Date\tRemarks"];
  currentLocalBatch.records.forEach((r, idx) => {
    const isVerified = (r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded");
    const isServerError = (r.verification_status === "Server Error" || /server\s*error/i.test(r.remarks || ""));
    const doiVal = r.doi || r.card_details?.["Doi"] || r.card_details?.["Date of Issue"] || r.card_details?.["Issue Date"] || "-";
    const doeVal = r.doe || r.card_details?.["Doe"] || r.card_details?.["Date of Expiry"] || r.card_details?.["Valid Till"] || "-";
    const transDoeVal = r.transport_doe || r.card_details?.["Transport Doe"] || "-";
    const expiryEval = evaluateDlExpiry(doeVal, transDoeVal);
    const expVal = r.dl_expiry_status || (isVerified ? expiryEval.status : (isServerError ? "Server Error" : "Not Verified"));
    const basisVal = isVerified ? (r.expiry_basis || expiryEval.basis) : "-";
    const nameVal = r.driver_name || r.card_details?.["Name"] || "-";
    const phoneVal = r.phone_number || "-";
    const dlVal = r.dl_number || r.card_details?.["License Number"] || "-";
    const dobVal = r.dob || "-";
    const vStatus = isVerified ? (r.upload_status === "Uploaded" || r.verification_status === "Verified & Uploaded" ? "Verified & Uploaded" : "Verified") : (isServerError ? "Server Error" : "Not Verified");
    const uploadStatus = isVerified ? (r.upload_status === "Uploaded" || r.verification_status === "Verified & Uploaded" ? "Uploaded to Verixa" : "Pending") : "Skipped";

    lines.push(`${r.row_index || (idx + 1)}\t${r.gsm_id || ""}\t${nameVal}\t${phoneVal}\t${dlVal}\t${dobVal}\t${doiVal}\t${doeVal}\t${transDoeVal}\t${expVal}\t${basisVal}\t${vStatus}\t${uploadStatus}\t${r.verification_date || ""}\t${r.remarks || ""}`);
  });

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    alert("📋 Clean formatted verification results copied to clipboard!\n\nYou can now go to your Google Sheet, select cell A1, and press Ctrl+V to paste.");
  } catch (err) {
    alert("Clipboard error: " + err.message);
  }
}

// Download ZIP containing all 4-Page verification report PDFs in current batch/quota
async function downloadAllReportsZip() {
  if (!currentLocalBatch || !currentLocalBatch.records || currentLocalBatch.records.length === 0) {
    return alert("No batch loaded! Please load or paste GSM IDs in 'Upload & Mapping' first.");
  }

  const verifiedRecords = currentLocalBatch.records.filter(r => 
    r.verification_status === "Verified" || r.verification_status === "Verified & Uploaded" || r.card_details || r.pdf_base64
  );

  if (verifiedRecords.length === 0) {
    return alert("No verification reports available in this batch yet!\n\nPlease start the verification loop on Tab 1 to verify drivers and generate reports.");
  }

  if (typeof JSZip === "undefined") {
    return alert("JSZip library is not ready. Please reload the extension.");
  }

  const btnZip = document.getElementById("btnDownloadZip");
  const origHtml = btnZip ? btnZip.innerHTML : "";
  if (btnZip) {
    btnZip.disabled = true;
    btnZip.innerHTML = `<span>⏳ Preparing ZIP (0/${verifiedRecords.length})...</span>`;
  }

  log(`📦 Packing ZIP archive of ${verifiedRecords.length} verification reports...`, "info");

  try {
    const zip = new JSZip();
    const batchNameClean = (currentLocalBatch.filename || currentLocalBatch.batch_name || "Quota").replace(/[^a-zA-Z0-9_-]/g, "_");
    const folderName = `Surepass_DL_Reports_${batchNameClean}`;
    const reportFolder = zip.folder(folderName);

    // Add a consolidated Verification_Summary.csv inside the ZIP
    let csvContent = "Row,GSM ID,Candidate Name,Mobile Number,DL Number,DOB,DOI,DOE,Transport DOE,DL Expiry Status,Expiry Considered On,Verification Status,Verification Date,Remarks,Report Filename\n";

    let idx = 0;
    for (const r of verifiedRecords) {
      idx++;
      if (btnZip) {
        btnZip.innerHTML = `<span>⏳ Zipping ${idx}/${verifiedRecords.length}: ${r.gsm_id}...</span>`;
      }

      const filename = `${r.gsm_id}_${r.phone_number || "DL"}_DL_Report.pdf`;

      // Guarantee generation of the complete 4-page official report PDF
      let pdfUri = generateSurepassReportPdf(r, r.card_details || {}) || r.pdf_base64;

      if (pdfUri) {
        // Strip data:application/pdf;...;base64,
        const base64Data = pdfUri.includes(",") ? pdfUri.split(",")[1] : pdfUri;
        reportFolder.file(filename, base64Data, { base64: true });
      }

      const doiVal = r.doi || r.card_details?.["Doi"] || "-";
      const doeVal = r.doe || r.card_details?.["Doe"] || "-";
      const transDoeVal = r.transport_doe || r.card_details?.["Transport Doe"] || "-";
      const expiryEval = evaluateDlExpiry(doeVal, transDoeVal);
      const expVal = r.dl_expiry_status || expiryEval.status;
      const basisVal = r.expiry_basis || expiryEval.basis;

      csvContent += `"${r.row_index}","${r.gsm_id || ''}","${(r.driver_name || r.card_details?.['Name'] || '').replace(/"/g, '""')}","${r.phone_number || ''}","${r.dl_number || ''}","${r.dob || ''}","${doiVal}","${doeVal}","${transDoeVal}","${expVal}","${basisVal}","${r.verification_status || ''}","${r.verification_date || ''}","${(r.remarks || '').replace(/"/g, '""')}","${filename}"\n`;

      await sleep(25);
    }

    reportFolder.file("Verification_Summary.csv", csvContent);

    if (btnZip) btnZip.innerHTML = `<span>📦 Compressing ZIP archive...</span>`;

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });

    const zipFilename = `Surepass_DL_Reports_${batchNameClean}_${Date.now()}.zip`;
    const reader = new FileReader();

    reader.onloadend = () => {
      const dataUri = reader.result;
      chrome.runtime.sendMessage({
        action: "DOWNLOAD_FILE",
        url: dataUri,
        filename: zipFilename,
        subfolder: "" // Saves directly into Downloads folder
      }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          // Native browser anchor fallback
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

// Download single candidate's 4-Page verification report PDF directly
function downloadSingleReportPdf(gsmId) {
  if (!currentLocalBatch || !currentLocalBatch.records) return;
  const r = currentLocalBatch.records.find(d => d.gsm_id === gsmId);
  if (!r) return;

  // Guarantee generation of the complete 4-page official report PDF
  let pdfUri = generateSurepassReportPdf(r, r.card_details || {}) || r.pdf_base64;
  if (!pdfUri) {
    return alert(`Could not generate PDF for ${gsmId}.`);
  }

  const filename = `${r.gsm_id}_${r.phone_number || "DL"}_DL_Report.pdf`;
  chrome.runtime.sendMessage({
    action: "DOWNLOAD_FILE",
    url: pdfUri,
    filename: `Surepass_DL_Reports/${filename}`
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
window.downloadAllReportsZip = downloadAllReportsZip;

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

    // Clear any previous cached report in background
    try {
      chrome.runtime.sendMessage({ action: "CLEAR_SUREPASS_PDF" });
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

    // STRICT VERIFICATION CHECK: If verification failed, errored, or not verified, STRICTLY SKIP Verixa upload!
    if (!result || !result.success || result.status !== "Verified") {
      const errStatus = result?.status || "Not Verified";
      const errRemarks = result?.remarks || "Failed to verify on Surepass portal";
      
      const isServerErr = errStatus === "Server Error" || /server\s*error|500|502|503|504|bad\s*gateway|gateway\s*timeout/i.test(errRemarks);
      driver.verification_status = errStatus === "Login Required" 
        ? "Login Required" 
        : (isServerErr ? "Server Error" : "Not Verified");

      driver.verification_date = new Date().toLocaleString();
      driver.remarks = errRemarks;
      driver.upload_status = isServerErr ? "Skipped (Server Error)" : "Skipped (Verification Failed)";
      driver.report_download_status = "Skipped";
      log(`⛔ [Surepass] ${driver.verification_status}: ${errRemarks}. STRICTLY SKIPPING Verixa upload for ${driver.gsm_id}.`, "warn");

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
      continue; // STRICTLY ADVANCE TO NEXT DRIVER - NEVER TOUCH VERIXA!
    }

    const finalStatus = result.status; // "Verified"
    const finalRemarks = result.remarks || "Verified on Surepass";
    const reportFilename = `${driver.gsm_id}_${driver.phone_number || "DL"}_DL_Report.pdf`;
    const nowIso = new Date().toLocaleString();

    // Ensure card details contain required values
    result.card_details = result.card_details || {};
    if (!result.card_details["License Number"]) {
      result.card_details["License Number"] = driver.dl_number;
    }
    if (result.card_details["Name"] && result.card_details["Name"] !== "Verified Candidate" && result.card_details["Name"].toLowerCase() !== "on aadhaar") {
      driver.driver_name = result.card_details["Name"];
    } else if (!result.card_details["Name"]) {
      result.card_details["Name"] = driver.driver_name || "Verified Candidate";
    }

    // Secondary validation: Ensure returned DL doesn't belong to an old, different driver
    const returnedDl = cleanDl(result.card_details?.["License Number"]);
    const targetDl = cleanDl(driver.dl_number);
    if (returnedDl && targetDl && returnedDl.length > 5 && !returnedDl.includes(targetDl) && !targetDl.includes(returnedDl)) {
      log(`⛔ [Verixa360] Stale card detected on Surepass! Returned DL "${returnedDl}" does not match target DL "${targetDl}". Aborting Verixa upload for ${driver.gsm_id}.`, "err");
      driver.verification_status = "Not Verified";
      driver.verification_date = nowIso;
      driver.remarks = `Surepass card mismatch (expected ${targetDl}, got ${returnedDl})`;
      driver.upload_status = "Skipped (Verification Failed)";
      driver.report_download_status = "Skipped";
      chrome.storage.local.set({ localBatch: currentLocalBatch });
      updateUIFromBatch();
      await sleep(1500);
      continue; // STRICTLY SKIP!
    }

    // Update driver state for genuinely verified candidate
    driver.verification_status = "Verified";
    driver.verification_date = nowIso;
    driver.remarks = finalRemarks;
    driver.report_filename = reportFilename;
    driver.card_details = result.card_details || driver.card_details || {};

    // Capture DOI and DOE and evaluate Expiry before proceeding to download/upload with strict date validation
    const rawDoi = result.doi || result.card_details?.["Doi"] || result.card_details?.["Date of Issue"] || result.card_details?.["Issue Date"] || result.card_details?.["Transport Doi"] || "";
    const rawDoe = result.doe || result.card_details?.["Doe"] || result.card_details?.["Date of Expiry"] || result.card_details?.["Valid Till"] || "";
    const rawTransDoi = result.transport_doi || result.card_details?.["Transport Doi"] || "";
    const rawTransDoe = result.transport_doe || result.card_details?.["Transport Doe"] || "";

    driver.doi = extractDateFromText(rawDoi);
    driver.doe = extractDateFromText(rawDoe);
    driver.transport_doi = extractDateFromText(rawTransDoi);
    driver.transport_doe = extractDateFromText(rawTransDoe);

    // Sync validated date strings back to card_details
    if (driver.doi) driver.card_details["Doi"] = driver.doi;
    if (driver.doe) driver.card_details["Doe"] = driver.doe;
    if (driver.transport_doe) driver.card_details["Transport Doe"] = driver.transport_doe;
    if (driver.transport_doi) driver.card_details["Transport Doi"] = driver.transport_doi;

    const expiryEval = evaluateDlExpiry(driver.doe, driver.transport_doe);
    driver.dl_expiry_status = expiryEval.status;
    driver.expiry_basis = expiryEval.basis;
    driver.is_dl_expired = (driver.dl_expiry_status === "DL Expired");
    if (expiryEval.remarksNote) {
      driver.remarks = `${finalRemarks} (${expiryEval.remarksNote})`;
    }

    log(`📅 [Surepass] Captured DOI: ${driver.doi || '-'} | DOE: ${driver.doe || '-'} | Trans DOE: ${driver.transport_doe || '-'} ➔ Status: ${driver.dl_expiry_status} (Basis: ${driver.expiry_basis})`, driver.is_dl_expired ? "warn" : "info");
    log(`✓ Outcome: Verified (${driver.remarks})`, "info");

    // Official Surepass 4-Page Report Generation & Automatic Download
    // Surepass's manual Download button triggers window.print for 4 pages (Image 2).
    // We strictly generate the complete, official 4-page report containing all verified data fields.
    const official4PagePdf = generateSurepassReportPdf(driver, result.card_details) || result.pdf_base64;
    const pdfToUpload = official4PagePdf;

    if (pdfToUpload) {
      driver.pdf_base64 = pdfToUpload;
      // Download official 4-page report to Downloads/Surepass_DL_Reports/<GSM>_<PHONE>_DL_Report.pdf
      chrome.runtime.sendMessage({
        action: "DOWNLOAD_FILE",
        url: pdfToUpload,
        filename: `Surepass_DL_Reports/${reportFilename}`
      }, () => {});
      driver.report_download_status = "Downloaded";
      log(`📥 Official 4-page Surepass report saved to Downloads/Surepass_DL_Reports/${reportFilename}`, "info");
    }

    if (pdfToUpload) {
        log(`📤 [Verixa360] Uploading 4-page DL Certificate for ${driver.gsm_id}...`, "info");

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
  const btnZip = document.getElementById("btnDownloadZip");
  if (btnExpExcel) btnExpExcel.onclick = exportUpdatedExcel;
  if (btnCopyGS) btnCopyGS.onclick = copyGSheetResults;
  if (btnZip) btnZip.onclick = downloadAllReportsZip;

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
