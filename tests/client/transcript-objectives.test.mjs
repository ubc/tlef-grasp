import { describe, expect, it } from "@jest/globals";
import {
  countObjectives,
  describeGenerationError,
  draftFromGenerated,
  draftProblems,
  newGranular,
  newObjective,
  objectivePayloads,
} from "../../client/src/lib/transcriptObjectives.js";
import { importedTranscripts } from "../../client/src/lib/panoptoImport.js";

const generated = [
  {
    name: "Describe enzyme kinetics",
    granularObjectives: [
      {
        text: "Define Km",
        bloomTaxonomies: ["Remember"],
        questionTypes: [{ bloomLevel: "Remember", questionType: "fill-in-the-blank", count: 1 }],
      },
      {
        text: "Interpret a Lineweaver-Burk plot",
        bloomTaxonomies: ["Analyze"],
        questionTypes: [{ bloomLevel: "Analyze", questionType: "multiple-choice", count: 2 }],
      },
    ],
  },
];

describe("draftFromGenerated", () => {
  it("keeps names, texts, Bloom levels and question types, with a distinct key on every row", () => {
    const draft = draftFromGenerated(generated);
    expect(draft).toHaveLength(1);
    expect(draft[0].name).toBe("Describe enzyme kinetics");
    expect(draft[0].granulars.map((granular) => granular.text)).toEqual([
      "Define Km",
      "Interpret a Lineweaver-Burk plot",
    ]);
    expect(draft[0].granulars[1].questionTypes).toEqual(generated[0].granularObjectives[1].questionTypes);
    const keys = [draft[0].key, ...draft[0].granulars.map((granular) => granular.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("copes with nothing", () => {
    expect(draftFromGenerated(undefined)).toEqual([]);
  });
});

describe("rows added by hand", () => {
  it("start blank at Understand with that level's default question type", () => {
    const granular = newGranular();
    expect(granular.text).toBe("");
    expect(granular.bloomTaxonomies).toEqual(["Understand"]);
    expect(granular.questionTypes).toEqual([
      { bloomLevel: "Understand", questionType: "multiple-choice", count: 1 },
    ]);
  });

  it("give a new objective one sub-objective to type into", () => {
    const objective = newObjective();
    expect(objective.name).toBe("");
    expect(objective.granulars).toHaveLength(1);
  });
});

describe("draftProblems", () => {
  it("has nothing to say about a generated draft", () => {
    expect(draftProblems(draftFromGenerated(generated))).toEqual([]);
  });

  it("names an objective without a name, and one with only blank sub-objectives", () => {
    const draft = draftFromGenerated(generated);
    const blankName = { ...newObjective(), granulars: [newGranular("Explain feedback inhibition")] };
    const noSubs = { ...newObjective(), name: "Regulation", granulars: [newGranular("   ")] };
    expect(draftProblems([...draft, blankName, noSubs])).toEqual([
      "Objective 2 needs a name.",
      '"Regulation" needs at least one sub-objective.',
    ]);
  });
});

describe("objectivePayloads", () => {
  it("links every objective to its own video only, trims text and leaves blank sub-objectives out", () => {
    const draft = draftFromGenerated(generated);
    draft[0].name = "  Describe enzyme kinetics  ";
    draft[0].granulars.push(newGranular("   "));
    draft[0].granulars.push(newGranular(" Compare competitive and noncompetitive inhibition "));

    const [payload] = objectivePayloads(draft, { courseId: "course-1", materialId: "material-9" });
    expect(payload.name).toBe("Describe enzyme kinetics");
    expect(payload.courseId).toBe("course-1");
    expect(payload.materialIds).toEqual(["material-9"]);
    expect(payload.granularObjectives.map((granular) => granular.text)).toEqual([
      "Define Km",
      "Interpret a Lineweaver-Burk plot",
      "Compare competitive and noncompetitive inhibition",
    ]);
    expect(payload.granularObjectives[0]).not.toHaveProperty("key");
    expect(payload.granularObjectives[2].bloomTaxonomies).toEqual(["Understand"]);
  });

  it("keeps one payload per draft objective, in order", () => {
    const draft = [...draftFromGenerated(generated), { ...newObjective(), name: "Second" }];
    const payloads = objectivePayloads(draft, { courseId: "c", materialId: "m" });
    expect(payloads.map((payload) => payload.name)).toEqual(["Describe enzyme kinetics", "Second"]);
  });
});

describe("describeGenerationError", () => {
  it("treats a not-relevant verdict as a verdict, with the model's reason", () => {
    const error = {
      status: 422,
      body: {
        code: "MATERIAL_NOT_RELEVANT",
        error: "This video doesn't seem to teach enough course content.",
        details: "Only course logistics are discussed.",
      },
    };
    expect(describeGenerationError(error)).toEqual({
      kind: "not-relevant",
      message: "This video doesn't seem to teach enough course content. Only course logistics are discussed.",
    });
  });

  it("passes on the server's message for anything else", () => {
    expect(describeGenerationError({ status: 500, body: { error: "GRASP could not do it." } })).toEqual({
      kind: "failed",
      message: "GRASP could not do it.",
    });
    expect(describeGenerationError(new Error("Network down")).message).toBe("Network down");
  });
});

describe("countObjectives", () => {
  it("adds up every video's draft", () => {
    expect(countObjectives([[{}, {}], [], [{}]])).toBe(3);
    expect(countObjectives(undefined)).toBe(0);
  });
});

describe("importedTranscripts", () => {
  it("offers every imported video the server named a material for", () => {
    expect(
      importedTranscripts({
        imported: [
          { id: "s1", name: "Lecture 1", material: { sourceId: "m1", documentTitle: "Lecture 1" } },
          { id: "s2", name: "Lecture 2", material: null },
          { id: "s3", name: "Lecture 3", material: { sourceId: "m3", documentTitle: "" } },
        ],
        errors: [{ id: "s4", name: "Lecture 4", message: "No captions" }],
      })
    ).toEqual([
      { sourceId: "m1", documentTitle: "Lecture 1" },
      { sourceId: "m3", documentTitle: "Lecture 3" },
    ]);
  });

  it("offers nothing for an empty run", () => {
    expect(importedTranscripts({})).toEqual([]);
    expect(importedTranscripts()).toEqual([]);
  });
});
