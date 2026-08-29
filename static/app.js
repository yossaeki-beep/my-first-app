const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const selectedFile = document.getElementById("selected-file");
const convertBtn = document.getElementById("convert-btn");
const statusEl = document.getElementById("status");
const resultSection = document.getElementById("result-section");
const resultText = document.getElementById("result-text");
const downloadBtn = document.getElementById("download-btn");
const langSelect = document.getElementById("lang");
const dpiSelect = document.getElementById("dpi");

let currentFile = null;
let outputFilename = "converted.txt";

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setSelectedFile(file) {
  currentFile = file;
  if (!file) {
    selectedFile.hidden = true;
    selectedFile.textContent = "";
    convertBtn.disabled = true;
    return;
  }

  selectedFile.hidden = false;
  selectedFile.textContent = `選択中: ${file.name} (${formatBytes(file.size)})`;
  convertBtn.disabled = false;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pickFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("PDFファイルを選択してください。", true);
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    setStatus("ファイルサイズは50MB以下にしてください。", true);
    return;
  }

  setStatus("");
  setSelectedFile(file);
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  pickFile(fileInput.files[0]);
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragover");
  pickFile(event.dataTransfer.files[0]);
});

convertBtn.addEventListener("click", async () => {
  if (!currentFile) return;

  convertBtn.disabled = true;
  setStatus("変換中です。ページ数が多いと時間がかかります...");
  resultSection.hidden = true;

  const formData = new FormData();
  formData.append("file", currentFile);
  formData.append("lang", langSelect.value);
  formData.append("dpi", dpiSelect.value);

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || "変換に失敗しました。");
    }

    outputFilename = payload.filename;
    resultText.value = payload.text;
    resultSection.hidden = false;
    setStatus(`変換完了（${payload.page_count}ページ）`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    convertBtn.disabled = !currentFile;
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([resultText.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = outputFilename;
  link.click();
  URL.revokeObjectURL(url);
});
