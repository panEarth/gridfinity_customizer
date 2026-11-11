// Send a model generated in the browser to Prusa EasyPrint or PrusaSlicer.
// Docs: https://slicer.printables.com/developers/import

const IMPORT_URL = "https://slicer.printables.com/import";
const MAX_BYTES = 100 * 1024 * 1024;

const ERRORS = {
  "missing-file": "The upload did not contain a file.",
  "invalid-extension": "EasyPrint did not accept this file type.",
  "file-too-large": "The model is larger than EasyPrint's 100 MB limit.",
  "invalid-form": "EasyPrint rejected the upload.",
  "upload-failed": "EasyPrint could not store the file. Please try again.",
  "config-missing": "EasyPrint is temporarily unavailable. Please try again later.",
};

// Uploads the file anonymously. The returned links stay valid for 30 minutes.
export async function uploadToSlicer(blob, fileName, source = {}) {
  if (blob.size > MAX_BYTES) throw new Error(ERRORS["file-too-large"]);
  const form = new FormData();
  form.append("file", new File([blob], fileName));
  form.append("file_name", fileName);
  if (source.name) form.append("file_source_name", source.name);
  if (source.url) form.append("file_source_url", source.url);

  let res;
  try {
    res = await fetch(IMPORT_URL, { method: "POST", body: form, headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Could not reach EasyPrint. Check your connection and try again.");
  }
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok || !json?.easyprint_url) {
    throw new Error(ERRORS[json?.error] || `Upload failed (HTTP ${res.status}).`);
  }
  return json; // { easyprint_url, prusaslicer_url, file_url, file_name }
}

// PrusaSlicer ships only for Windows, macOS and Linux, so its prusaslicer://
// handler can never exist on iOS or Android (including iPadOS in desktop mode).
export function canOpenInPrusaslicer() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return false;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return false;
  return true;
}

// Opens a placeholder tab synchronously inside the click handler, so pop-up
// blockers allow it; navigate it once the upload has finished.
export function openPendingTab(message) {
  const tab = window.open("", "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
    tab.document.title = "Opening EasyPrint…";
    tab.document.body.innerHTML =
      `<p style="font:16px/1.5 system-ui,sans-serif;color:#555;padding:32px;text-align:center">${message}</p>`;
  } catch {}
  return tab;
}

export function launchPrusaslicer(url) {
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
