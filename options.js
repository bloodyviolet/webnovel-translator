const $ = (id) => document.getElementById(id);

function load() {
  chrome.storage.local.get(
    { 
      baseUrl: "https://api.deepseek.com/chat/completions",
      apiKey: "", 
      model: "deepseek-chat", 
      targetLang: "English", 
      chunkChars: 6000 
    },
    (cfg) => {
      $("baseUrl").value = cfg.baseUrl;
      $("apiKey").value = cfg.apiKey;
      $("model").value = cfg.model;
      $("targetLang").value = cfg.targetLang;
      $("chunkChars").value = cfg.chunkChars;
    }
  );
}

function save() {
  const cfg = {
    baseUrl: $("baseUrl").value.trim(),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim(),
    targetLang: $("targetLang").value.trim() || "English",
    chunkChars: parseInt($("chunkChars").value, 10) || 6000,
  };
  
  chrome.storage.local.set(cfg, () => {
    $("status").textContent = "Saved.";
    setTimeout(() => ($("status").textContent = ""), 1500);
  });
}

document.addEventListener("DOMContentLoaded", load);
$("save").addEventListener("click", save);