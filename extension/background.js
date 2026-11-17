// background.js - Configures Chrome Side Panel and handles automated report downloads
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.log("SidePanel behavior notice:", err));
  }
});

// Listener for downloading verified driver PDF reports into a dedicated folder
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "DOWNLOAD_REPORT") {
    const fileUrl = request.url;
    const filename = request.filename || "DL_Report.pdf";
    const subfolder = request.subfolder || "Surepass_DL_Reports";
    const destinationPath = `${subfolder}/${filename}`;

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
          saveAs: false // Automatically saves to default Downloads without prompting
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn("Download failed:", chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            console.log(`Report auto-downloaded successfully: ${destinationPath} (ID: ${downloadId})`);
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

