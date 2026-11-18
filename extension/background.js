// background.js - Configures Chrome Side Panel and handles automated report downloads
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.log("SidePanel behavior notice:", err));
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

// Listener for downloading files requested by popup (e.g. Exported Excel)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "DOWNLOAD_FILE") {
    const fileUrl = request.url;
    const filename = request.filename || `Export_${Date.now()}.xlsx`;
    const destinationPath = filename;

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
