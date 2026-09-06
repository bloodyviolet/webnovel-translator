const MODES = {
  xianxia: {
    label: "Xianxia (Chinese Cultivation Fantasy)",
    guidance:
      "This is a Xianxia (Chinese cultivation) web novel. Preserve or properly render " +
      "cultivation-specific terminology: Qi, Dao, cultivation realm names (e.g. Qi " +
      "Condensation, Foundation Establishment, Core Formation, Nascent Soul, Soul " +
      "Formation, Void Refinement, Body Integration, Mahayana, Tribulation Transcendence " +
      "— or this novel's own realm system if it differs), dantian, spiritual roots, " +
      "meridians, pills/elixirs (dan), talismans, formations (arrays), sects and sect " +
      "ranks (Sect Master, Elder, Inner/Outer Disciple), and honorifics (Senior " +
      "Brother/Sister, Junior Brother/Sister, Young Master/Miss, Master, Patriarch). " +
      "Render technique/skill names evocatively rather than word-for-word. Favor a " +
      "slightly archaic, wuxia-flavored register over modern casual English.",
  },
  xuanhuan: {
    label: "Xuanhuan (Chinese Fantasy, original power systems)",
    guidance:
      "This is a Xuanhuan (Chinese fantasy) web novel, which blends cultivation elements " +
      "with more original, setting-specific power systems rather than the strict " +
      "traditional Daoist realm ladder. Identify and preserve the novel's own " +
      "terminology for its power system, ranks, currency, factions, and titles rather " +
      "than forcing standard Xianxia terms onto it unless the text itself uses them. " +
      "Favor an epic, dramatic tone appropriate to fantasy webfiction.",
  },
  wuxia: {
    label: "Wuxia (Chinese Martial Arts, non-supernatural)",
    guidance:
      "This is a Wuxia (martial arts / jianghu) novel, generally without immortal " +
      "cultivation. Preserve terms like jianghu, wulin, qinggong (lightness skill), " +
      "neigong/neili (internal energy), martial arts school/style names, sect and clan " +
      "structures, and honorifics (Senior, Young Hero, Elder, Sect Leader). Keep the " +
      "tone grounded in human-level martial prowess unless supernatural elements " +
      "appear in the text.",
  },
  murim: {
    label: "Murim (Korean Martial Arts Fantasy)",
    guidance:
      "This is a Korean Murim-genre novel. Preserve terms like Murim, internal energy " +
      "(naegong), martial arts sects, ranks and titles (Young Master, Elder, Sect " +
      "Leader, Blademaster), and any status/system elements if present. Match Korean " +
      "webnovel conventions for honorifics and titles rather than defaulting to " +
      "Chinese cultivation terms unless the text is explicitly cross-genre.",
  },
  isekai: {
    label: "Isekai / LitRPG (game-system fantasy)",
    guidance:
      "This is an Isekai or LitRPG-style novel featuring game-like systems: levels, " +
      "stats, skills, status windows, classes, dungeons, and guilds. Preserve game " +
      "terminology precisely and consistently (Skill, Stat, Level Up, class/job names, " +
      "status window formatting) and keep Japanese/Korean honorifics (-san, -kun, " +
      "-sama, Oppa, Hyung, etc.) untranslated where present in the original.",
  },
  fantasy: {
    label: "Western / General Fantasy",
    guidance:
      "This is a general Western-style fantasy novel. Use standard high-fantasy " +
      "conventions for titles, magic terminology, and world-building nouns.",
  },
  scifi: {
    label: "Science Fiction",
    guidance:
      "This is a science-fiction novel. Preserve technical and invented sci-fi " +
      "terminology (ship names, tech terms, ranks, factions) precisely and " +
      "consistently.",
  },
  general: {
    label: "General / Literal (no genre styling)",
    guidance:
      "Translate as accurately and literally as possible without applying any " +
      "particular genre's terminology conventions. Prioritize clarity and fidelity " +
      "to the source meaning.",
  },
  custom: {
    label: "Custom instructions",
    guidance: null,
  },
};

function buildSystemPrompt({ mode, customInstructions, glossary, targetLang }) {
  const modeInfo = MODES[mode] || MODES.general;
  const guidance =
    mode === "custom"
      ? customInstructions || "Follow the user's intended style as best you can infer it."
      : modeInfo.guidance;

  return (
    `You are a professional literary translator specializing in web novels. ${guidance}\n\n` +
    `Translate the given paragraphs into ${targetLang}, preserving paragraph breaks exactly ` +
    `(the output array must have the same number of elements, in the same order, as the input). ` +
    `Use the glossary below for any term or name that appears in it, to keep terminology ` +
    `consistent across chapters. If you encounter new proper nouns, character names, or ` +
    `setting-specific terms not already in the glossary, choose a consistent translation and ` +
    `include it in "glossary_updates" so it can be reused in future chapters. Do not add ` +
    `glossary entries for ordinary common words — only names, titles, ranks, and invented terms.\n\n` +
    `Glossary (source term -> established translation):\n${JSON.stringify(glossary)}\n\n` +
    `Respond with ONLY raw JSON (no markdown fences, no commentary) in this exact shape:\n` +
    `{"translations": ["...", "..."], "glossary_updates": {"source term": "translation"}}`
  );
}

async function callLLM({ baseUrl, apiKey, model, systemPrompt, paragraphs }) {
  const url = baseUrl || "https://api.deepseek.com/chat/completions";
  
  const body = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Input paragraphs (JSON array):\n" + JSON.stringify(paragraphs) }
    ],
    temperature: 0.3,
    max_tokens: 8192
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    let errObj;
    try { errObj = JSON.parse(errText); } catch(e){}
    throw new Error(`${resp.status}: ${errObj?.error?.message || errText}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || "";
  
  // Regex to extract JSON block in case model outputs Markdown or <think> tags
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Model response did not contain a valid JSON object.");
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error("Could not parse model response as JSON. Try lowering the batch size in options.");
  }

  if (!Array.isArray(parsed.translations)) {
    throw new Error("Model response missing a translations array.");
  }
  return parsed;
}

async function handleTranslateText(msg) {
  const cfg = await chrome.storage.local.get({
    baseUrl: "https://api.deepseek.com/chat/completions",
    apiKey: "",
    model: "deepseek-chat"
  });

  if (!cfg.apiKey) {
    throw new Error("No API key set. Open extension options.");
  }

  const glossaryKey = "glossary:" + msg.storyKey;
  const glossaryStore = await chrome.storage.local.get({ [glossaryKey]: {} });
  const glossary = glossaryStore[glossaryKey];

  const systemPrompt = buildSystemPrompt({
    mode: msg.mode,
    customInstructions: msg.customInstructions,
    glossary,
    targetLang: msg.targetLang,
  });

  const result = await callLLM({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    systemPrompt,
    paragraphs: msg.paragraphs,
  });

  if (result.glossary_updates && typeof result.glossary_updates === "object") {
    Object.assign(glossary, result.glossary_updates);
    await chrome.storage.local.set({ [glossaryKey]: glossary });
  }

  return {
    translations: result.translations,
    glossarySize: Object.keys(glossary).length,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TRANSLATE_TEXT") {
    handleTranslateText(msg)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async response
  }

  if (msg.type === "GET_MODES") {
    const list = Object.entries(MODES).map(([id, m]) => ({ id, label: m.label }));
    sendResponse({ ok: true, modes: list });
    return false;
  }

  if (msg.type === "GET_GLOSSARY") {
    const glossaryKey = "glossary:" + msg.storyKey;
    chrome.storage.local.get({ [glossaryKey]: {} }, (store) => {
      sendResponse({ ok: true, glossary: store[glossaryKey] });
    });
    return true;
  }

  if (msg.type === "SET_GLOSSARY") {
    const glossaryKey = "glossary:" + msg.storyKey;
    chrome.storage.local.set({ [glossaryKey]: msg.glossary }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});