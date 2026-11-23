// background.js - Manages Chrome Side Panel and handles automated Aadhaar report downloads
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.log("SidePanel behavior notice:", err));
  }
});

// Cache the latest official Surepass Aadhaar report in memory for auto-upload
let latestSurepassAadhaarPdf = null; // { url, filename, base64, aadhaarNumber, gsmId, timestamp }

// Automatically route official Surepass Aadhaar PDF downloads to Downloads/Surepass_Aadhaar_Reports/
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const isFromSurepass = item.url && (item.url.includes("surepass.app") || item.url.includes("surepass.io"));
  const isAadhaarPdf = (item.filename && item.filename.toLowerCase().includes("aadhaar") && item.filename.toLowerCase().endsWith(".pdf")) ||
                       (item.filename && item.filename.toLowerCase().endsWith(".pdf") && isFromSurepass);

  if (isAadhaarPdf) {
    const rawName = item.filename.split(/[\\/]/).pop() || "Surepass_Aadhaar_Report.pdf";
    suggest({
      filename: `Surepass_Aadhaar_Reports/${rawName}`,
      conflictAction: "uniquify"
    });
    return;
  }
  suggest();
});

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CLEAR_SUREPASS_AADHAAR_PDF") {
    latestSurepassAadhaarPdf = null;
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "GET_LATEST_SUREPASS_AADHAAR_PDF") {
    if (latestSurepassAadhaarPdf && Date.now() - latestSurepassAadhaarPdf.timestamp < 90000) {
      if (request.aadhaarNumber) {
        const cleanReq = String(request.aadhaarNumber).replace(/\D/g, "");
        const stored = String(latestSurepassAadhaarPdf.aadhaarNumber || "").replace(/\D/g, "");
        if (stored && cleanReq && stored !== cleanReq) {
          sendResponse({ success: false, reason: "Cached Aadhaar PDF number mismatch" });
          return true;
        }
      }
      sendResponse({ success: true, pdfBase64: latestSurepassAadhaarPdf.base64, filename: latestSurepassAadhaarPdf.filename });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (request.action === "STORE_SUREPASS_AADHAAR_PDF") {
    if (request.pdfBase64) {
      latestSurepassAadhaarPdf = {
        filename: request.filename || "Surepass_Aadhaar_Report.pdf",
        base64: request.pdfBase64,
        aadhaarNumber: request.aadhaarNumber || "",
        gsmId: request.gsmId || "",
        timestamp: Date.now()
      };
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (request.action === "DOWNLOAD_FILE") {
    const fileUrl = request.url;
    const filename = request.filename || `Export_${Date.now()}.xlsx`;

    if (!fileUrl) {
      sendResponse({ success: false, error: "Missing download URL" });
      return true;
    }

    try {
      chrome.downloads.download(
        {
          url: fileUrl,
          filename: filename,
          conflictAction: "overwrite",
          saveAs: false
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn("chrome.downloads error:", chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, downloadId: downloadId });
          }
        }
      );
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
});
