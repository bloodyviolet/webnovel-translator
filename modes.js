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


globalThis.WNT_MODES = MODES;
