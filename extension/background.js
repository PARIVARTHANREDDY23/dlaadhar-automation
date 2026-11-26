// background.js - Configures Chrome Side Panel and handles automated report downloads
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.log("SidePanel behavior notice:", err));
  }
});

// Cache the latest official Surepass report PDF in memory for auto-upload to Verixa
let latestSurepassPdf = null; // { url, filename, base64, timestamp }

// Listen for download creation to catch official Surepass PDF
chrome.downloads.onCreated.addListener(async (item) => {
  const isFromSurepass = item.url && (item.url.includes("surepass.app") || item.url.includes("surepass.io"));
  const isPdf = (item.filename && item.filename.toLowerCase().endsWith(".pdf")) || item.mime === "application/pdf";

  if (isFromSurepass || isPdf) {
    try {
      const resp = await fetch(item.url);
      const blob = await resp.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        latestSurepassPdf = {
          url: item.url,
          filename: item.filename || "Surepass_DL_Report.pdf",
          base64: reader.result,
          timestamp: Date.now()
        };
        console.log(`[Background] Cached latest Surepass PDF (${blob.size} bytes)`);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.warn("[Background] Download stream capture notice:", e.message);
    }
  }
});

// Automatically route official Surepass PDF downloads to Downloads/Surepass_DL_Reports/
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const isFromSurepass = item.url && (item.url.includes("surepass.app") || item.url.includes("surepass.io"));
  const isPdf = (item.filename && item.filename.toLowerCase().endsWith(".pdf")) || item.mime === "application/pdf";

  if (isFromSurepass && isPdf) {
    const rawName = item.filename.split(/[\\/]/).pop() || "Surepass_DL_Report.pdf";
    suggest({
      filename: `Surepass_DL_Reports/${rawName}`,
      conflictAction: "uniquify"
    });
    return;
  }
  suggest();
});

// Listener for downloading files requested by popup and querying latest captured report
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CLEAR_SUREPASS_PDF") {
    latestSurepassPdf = null;
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "GET_LATEST_SUREPASS_PDF") {
    // Return cached PDF if less than 90 seconds old AND matches the specific DL number if provided
    if (latestSurepassPdf && Date.now() - latestSurepassPdf.timestamp < 90000) {
      if (request.dlNumber && latestSurepassPdf.dlNumber && request.dlNumber !== latestSurepassPdf.dlNumber) {
        console.log(`[Background] Stale PDF DL mismatch: cached=${latestSurepassPdf.dlNumber}, requested=${request.dlNumber}`);
        sendResponse({ success: false, reason: "DL number mismatch" });
        return true;
      }
      sendResponse({ success: true, pdfBase64: latestSurepassPdf.base64, filename: latestSurepassPdf.filename });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (request.action === "STORE_SUREPASS_PDF") {
    if (request.pdfBase64) {
      latestSurepassPdf = {
        filename: request.filename || "Surepass_DL_Report.pdf",
        base64: request.pdfBase64,
        dlNumber: request.dlNumber || "",
        timestamp: Date.now()
      };
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (request.action === "DOWNLOAD_FILE") {
    let fileUrl = request.url;
    const filename = request.filename || `Export_${Date.now()}.xlsx`;
    const destinationPath = filename;

    // Safety guard: If an Excel file (.xlsx) is being downloaded from a data URI, ensure MIME type is strictly spreadsheetml so Chrome never forces .zip
    if (destinationPath.toLowerCase().endsWith(".xlsx") && fileUrl && typeof fileUrl === "string") {
      fileUrl = fileUrl.replace(/^data:application\/zip;/i, "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;");
    }

    if (!fileUrl) {
      sendResponse({ success: false, error: "Missing download URL" });
      return true;
    }

    try {
      chrome.downloads.download(
        {
          url: fileUrl,
          filename: destinationPath,
          conflictAction: "overwrite",
          saveAs: false
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn("Download failed:", chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            console.log(`File auto-downloaded successfully: ${destinationPath} (ID: ${downloadId})`);
            sendResponse({ success: true, downloadId: downloadId, path: destinationPath });
          }
        }
      );
    } catch (err) {
      console.error("chrome.downloads exception:", err);
      sendResponse({ success: false, error: err.message });
    }
    return true; // Keep message channel open for async response
  }
});
