const express = require("express");
const request = require("supertest");
const { ObjectId } = require("mongodb");

// Capture what gets appended to the export ZIP instead of building a real
// archive; finalize() ends the response so supertest resolves.
jest.mock("archiver", () => {
  const instances = [];
  const factory = jest.fn(() => {
    const archive = {
      appended: [],
      on: jest.fn().mockReturnThis(),
      pipe: jest.fn(function pipe(dest) {
        this.dest = dest;
        return dest;
      }),
      append: jest.fn(function append(content, opts) {
        this.appended.push({ content, name: opts.name });
      }),
      finalize: jest.fn(function finalize() {
        if (this.dest) this.dest.end();
      }),
    };
    instances.push(archive);
    return archive;
  });
  factory.instances = instances;
  return factory;
});

jest.mock("../../src/services/question", () => ({
  saveQuestion: jest.fn(),
  updateQuestion: jest.fn(),
  deleteQuestion: jest.fn(),
  getQuestions: jest.fn(),
  getQuestion: jest.fn(),
  getQuestionCourseId: jest.fn(),
}));
jest.mock("../../src/services/user-course", () => ({
  isUserInCourse: jest.fn(),
}));
jest.mock("../../src/services/quiz", () => ({}));
jest.mock("../../src/utils/auth", () => ({
  isFaculty: jest.fn(),
}));
jest.mock("../../src/utils/co-instructor-permissions", () => ({
  assertCoInstructorPermission: jest.fn(),
  PERMISSION_KEYS: { QUESTION_BANK: "questionBank" },
}));
jest.mock("../../src/services/image", () => ({
  downloadImageBuffer: jest.fn(),
}));

const archiver = require("archiver");
const { downloadImageBuffer } = require("../../src/services/image");
const questionRouter = require("../../src/routes/question");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: "faculty-1" };
    next();
  });
  app.use("/question", questionRouter);
  return app;
}

const FILE_ID = new ObjectId().toString();
const IMAGE_BYTES = Buffer.from("fake-png-bytes");

const mcqQuestion = (overrides = {}) => ({
  title: "Which organelle is shown?",
  stem: "Which organelle is shown?",
  questionType: "multiple-choice",
  options: { A: "Nucleus", B: "Ribosome", C: "Golgi", D: "Vacuole" },
  correctAnswer: "A",
  ...overrides,
});

const withImage = (overrides = {}) =>
  mcqQuestion({
    stemImages: [
      {
        fileId: FILE_ID,
        filename: "cell diagram.png",
        mimeType: "image/png",
        size: IMAGE_BYTES.length,
        caption: "A plant cell",
      },
    ],
    ...overrides,
  });

async function exportQti(questions) {
  const response = await request(buildApp())
    .post("/question/export?format=qti")
    .send({ course: "BIOL 200", questions, quizName: "Midterm" });
  const archive = archiver.instances[archiver.instances.length - 1];
  const entry = (predicate) => archive.appended.find(predicate);
  return {
    response,
    archive,
    manifest: entry((e) => e.name === "imsmanifest.xml")?.content,
    assessmentXml: entry(
      (e) => e.name.endsWith(".xml") && !e.name.includes("manifest") && !e.name.includes("meta")
    )?.content,
    imageEntries: archive.appended.filter((e) => e.name.startsWith("web_resources/")),
  };
}

describe("QTI export with question images", () => {
  let consoleErrorSpy;
  let consoleWarnSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  beforeEach(() => {
    archiver.instances.length = 0;
    downloadImageBuffer.mockResolvedValue(IMAGE_BYTES);
  });

  it("bundles the image into web_resources and references it from the manifest", async () => {
    const { response, manifest, imageEntries } = await exportQti([withImage()]);
    // The filename is sanitized (space → underscore) and prefixed with the fileId.
    const expectedPath = `web_resources/grasp/${FILE_ID}-cell_diagram.png`;

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(downloadImageBuffer).toHaveBeenCalledWith(FILE_ID);

    expect(imageEntries).toEqual([
      expect.objectContaining({ name: expectedPath, content: IMAGE_BYTES }),
    ]);
    // Canvas only imports files declared as webcontent resources the
    // assessment depends on.
    expect(manifest).toContain(`type="webcontent" href="${expectedPath}"`);
    const resourceId = manifest.match(
      new RegExp(`<resource identifier="([^"]+)" type="webcontent" href="${expectedPath}"`)
    )?.[1];
    expect(resourceId).toBeTruthy();
    expect(manifest).toContain(`<dependency identifierref="${resourceId}"/>`);
  });

  it("renders the image and its caption inside the question's QTI html", async () => {
    const { assessmentXml } = await exportQti([withImage()]);

    // The mattext body is XML-escaped html; $IMS-CC-FILEBASE$ lets Canvas
    // rewrite the src to the imported course file.
    expect(assessmentXml).toContain(
      `$IMS-CC-FILEBASE$/grasp/${FILE_ID}-cell_diagram.png`
    );
    expect(assessmentXml).toContain("A plant cell");
    expect(assessmentXml).toContain("Which organelle is shown?");
  });

  it("downloads each shared image only once across questions", async () => {
    await exportQti([withImage({ title: "Q1" }), withImage({ title: "Q2" })]);

    expect(downloadImageBuffer).toHaveBeenCalledTimes(1);
  });

  it("falls back to a text-only export when the image is missing from storage", async () => {
    downloadImageBuffer.mockResolvedValue(null);

    const { response, manifest, assessmentXml, imageEntries } = await exportQti([withImage()]);

    expect(response.status).toBe(200);
    expect(imageEntries).toEqual([]);
    expect(manifest).not.toContain("webcontent");
    expect(assessmentXml).not.toContain("$IMS-CC-FILEBASE$");
    expect(assessmentXml).toContain("Which organelle is shown?");
  });

  it("exports questions without images exactly as before", async () => {
    const { response, manifest, assessmentXml, imageEntries } = await exportQti([mcqQuestion()]);

    expect(response.status).toBe(200);
    expect(downloadImageBuffer).not.toHaveBeenCalled();
    expect(imageEntries).toEqual([]);
    expect(manifest).not.toContain("webcontent");
    expect(assessmentXml).toContain("Which organelle is shown?");
  });
});

async function exportH5P(questions) {
  const response = await request(buildApp())
    .post("/question/export?format=h5p")
    .send({ course: "BIOL 200", questions, quizName: "Midterm" });
  const archive = archiver.instances[archiver.instances.length - 1];
  const entry = (name) => archive.appended.find((e) => e.name === name);
  return {
    response,
    archive,
    manifest: entry("h5p.json") ? JSON.parse(entry("h5p.json").content) : null,
    content: entry("content/content.json")
      ? JSON.parse(entry("content/content.json").content)
      : null,
    imageEntries: (archive?.appended || []).filter((e) =>
      e.name.startsWith("content/images/")
    ),
  };
}

describe("H5P export with question images", () => {
  let consoleErrorSpy;
  let consoleWarnSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  beforeEach(() => {
    archiver.instances.length = 0;
    downloadImageBuffer.mockResolvedValue(IMAGE_BYTES);
  });

  it("bundles the image under content/images and wires it into the media block", async () => {
    const { response, manifest, content, imageEntries } = await exportH5P([withImage()]);
    const expectedName = `${FILE_ID}-cell_diagram.png`;

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(downloadImageBuffer).toHaveBeenCalledWith(FILE_ID);

    expect(imageEntries).toEqual([
      expect.objectContaining({
        name: `content/images/${expectedName}`,
        content: IMAGE_BYTES,
      }),
    ]);
    // content.json paths are relative to the content/ folder.
    const media = content.questions[0].params.media;
    expect(media.type.params.file.path).toBe(`images/${expectedName}`);
    expect(media.type.params.alt).toBe("A plant cell");
    expect(manifest.preloadedDependencies).toContainEqual({
      machineName: "H5P.Image",
      majorVersion: 1,
      minorVersion: 1,
    });
  });

  it("falls back to a text-only package when the image is missing from storage", async () => {
    downloadImageBuffer.mockResolvedValue(null);

    const { response, manifest, content, imageEntries } = await exportH5P([withImage()]);

    expect(response.status).toBe(200);
    expect(imageEntries).toEqual([]);
    expect(content.questions[0].params.media).toBeUndefined();
    expect(manifest.preloadedDependencies).not.toContainEqual(
      expect.objectContaining({ machineName: "H5P.Image" })
    );
    expect(content.questions[0].params.question).toContain("Which organelle is shown?");
  });

  it("exports imageless quizzes without touching image storage", async () => {
    const { response, imageEntries, content } = await exportH5P([mcqQuestion()]);

    expect(response.status).toBe(200);
    expect(downloadImageBuffer).not.toHaveBeenCalled();
    expect(imageEntries).toEqual([]);
    expect(content.questions[0].params.media).toBeUndefined();
  });
});
