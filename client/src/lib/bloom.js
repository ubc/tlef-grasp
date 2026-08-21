// Bloom's Taxonomy presentation data shared by the instructor settings table
// and the student dashboard guide. The level names themselves come from
// BLOOM_LEVELS in ./constants.js, which mirrors the server.

export const BLOOM_BADGE_COLORS = {
  Remember: "bg-blue-100 text-blue-700",
  Understand: "bg-green-100 text-green-700",
  Apply: "bg-yellow-100 text-yellow-700",
  Analyze: "bg-orange-100 text-orange-700",
  Evaluate: "bg-purple-100 text-purple-700",
  Create: "bg-pink-100 text-pink-700",
};

// Plain-language gloss of each level for students. `summary` says what the
// level asks of them; `example` makes it concrete with a task they could be
// given. Deliberately jargon-free — this is read by students, not instructors,
// so it describes the thinking rather than the verb list the generation
// prompts use (BLOOM guidance in src/constants/app-constants.js).
export const BLOOM_LEVEL_GUIDE = {
  Remember: {
    summary: "Recall a fact, term, or definition you have studied.",
    example: "Name the stages of cell division.",
  },
  Understand: {
    summary: "Explain an idea in your own words.",
    example: "Describe why water moves across a membrane during osmosis.",
  },
  Apply: {
    summary: "Use what you know to work through a new situation or problem.",
    example: "Calculate the concentration of a solution after it is diluted.",
  },
  Analyze: {
    summary: "Break something down, compare its parts, or find a pattern.",
    example: "Compare mitosis and meiosis and explain where they differ.",
  },
  Evaluate: {
    summary: "Judge or defend a choice, and give the reasons behind it.",
    example: "Decide which of two experimental methods gives more reliable results, and say why.",
  },
  Create: {
    summary: "Put ideas together to design or propose something new.",
    example: "Design an experiment that would test a given hypothesis.",
  },
};
