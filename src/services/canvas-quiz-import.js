/**
 * Canvas Classic Quizzes import (#140): preview and commit.
 *
 * The client uploads the export zip once for a preview (nothing is written),
 * then once per Canvas quiz to commit it. Nothing is kept between requests:
 * re-importing is idempotent because questions, parent objectives and GRASP
 * quizzes remember the Canvas item, group and quiz they came from (`source`).
 *
 * Each Canvas group (and each question outside a group) is one slot, which
 * becomes one parent objective with one granular child of the same name; every
 * imported variant of the slot goes on that granular, so spaced delivery
 * serves one variant per slot and keeps the others for repetition.
 *
 * Image links in an export carry Canvas's `verifier` token, which works like a
 * password. They are fetched here and never stored, logged or returned: every
 * report and saved payload holds only text and GRASP image references.
 *
 * Only one commit of a Canvas quiz runs at a time per course (a lock document
 * in MongoDB, so it holds across the server's cluster workers): two commits
 * that both read the course before either writes would both save everything.
 */

const { ObjectId } = require("mongodb");
const databaseService = require("./database");
const { saveQuestion } = require("./question");
const { createObjective, appendGranularObjectives } = require("./objective");
const { ensureCanvasImportMaterial } = require("./material");
const { linkObjectiveToMaterial, objectivesWithMaterials } = require("./objective-material");
const { createQuiz, addExistingQuestionsToQuiz } = require("./quiz");
const { uploadImage, deleteImages } = require("./image");
const { readCanvasPackage, CanvasImportError } = require("../utils/canvas-qti-package");
const { parseCanvasQuiz } = require("../utils/canvas-qti-parse");
const { mapCanvasQuizzes, compareQuizCreationOrder } = require("../utils/canvas-qti-map");
const {
    canvasImageHostsFromEnv,
    isAllowedCanvasImageUrl,
    createCanvasImageFetcher,
} = require("../utils/canvas-image-fetch");
const { sniffImageType, extensionForImageMime } = require("../utils/image-sniff");

const SOURCE_KIND = "canvas-classic";

const IMPORT_LIMITS = Object.freeze({
    // Per image, the same cap as an instructor's own upload.
    maxImageBytes: 5 * 1024 * 1024,
    // Per quiz (one commit). They stop a crafted export from making the server
    // download or store without bound; real quizzes use a few MB at most.
    maxRemoteImages: 1000,
    maxImageBytesPerQuiz: 200 * 1024 * 1024,
    fetchConcurrency: 6,
    // After this, links not yet requested count as failed downloads, so one
    // request stays well inside the server's timeouts.
    fetchBudgetMs: 120 * 1000,
});

const IMAGE_WARNINGS = Object.freeze({
    REMOTE: "An image could not be downloaded from Canvas.",
    EXPORT: "An image in the export could not be read.",
    TOO_MANY: "An image was not imported because this quiz has more images than one import can take.",
});
// Option text for an option whose only content was an image that failed.
const IMAGE_UNAVAILABLE = "(image unavailable)";
const SAVE_FAILED = "GRASP could not save this question.";
const UNKNOWN_QUIZ =
    "This quiz isn't in the uploaded export. Upload the export again and choose from its quizzes.";
const IMPORT_IN_PROGRESS = "This Canvas quiz is already being imported. Try again in a minute.";

const LOCK_COLLECTION = "grasp_canvas_import_lock";
// Well past the image-fetch budget plus the writes of a large quiz, so a live
// commit keeps its lock; a lock left by a worker that died expires (a TTL
// index removes it, and an expired one is taken over without waiting for it).
const IMPORT_LOCK_MS = 15 * 60 * 1000;

const DATA_IMAGE_PREFIX = /^data:image\/[a-z0-9.+-]+;base64,/i;
// A failed result that stands for "not requested: a per-quiz limit was reached".
const OVER_LIMIT = Object.freeze({ ok: false, reason: "over-limit" });

const toId = (value) => (ObjectId.isValid(value) ? new ObjectId(value) : value);
const keyOf = (quizIdent, ident) => `${quizIdent}\u0000${ident}`;
const normalizeName = (value) => String(value ?? "").trim().toLowerCase();
// The Canvas items an import has decided about for this GRASP quiz
// (`importLinkedItems`): the ones it put in the quiz, and the ones an
// instructor imported while choosing not to add them to it. A later commit
// leaves these alone (see createQuizLinker).
const decidedItemsOf = (graspQuiz) =>
    new Set(Array.isArray(graspQuiz?.importLinkedItems) ? graspQuiz.importLinkedItems : []);
const recordDecidedItems = (db, graspQuizId, itemIdents) =>
    db.collection("grasp_quiz").updateOne(
        { _id: graspQuizId },
        { $addToSet: { importLinkedItems: { $each: itemIdents } } }
    );

// Skips as the client shows them; the Canvas item ident stays on the server.
const publicSkip = ({ slotName, itemTitle, canvasType, reason }) => ({
    slotName,
    itemTitle,
    canvasType,
    reason,
});

// Warnings about an option image name the option, like the mapper's own.
const imageWarning = (letter, sentence) => (letter ? `Option ${letter}: ${sentence}` : sentence);

const pushUnique = (list, value) => {
    if (value && !list.includes(value)) list.push(value);
};

// Every image reference of a draft, stem images first, then options A..H.
function imageRefsOf(draft) {
    return [
        ...draft.stemImages.map((image) => ({ image, letter: null })),
        ...Object.entries(draft.optionImages).map(([letter, image]) => ({ image, letter })),
    ];
}

/**
 * Read, parse and map an export. Pure: no database, no network.
 * Quizzes come back in GRASP creation order (Canvas due date, else unlock
 * date, else manifest order). `xmlPaths` (quiz ident -> its file in the zip)
 * lets relative image paths resolve; it is internal and never reported.
 * @param {Buffer} buffer - The uploaded zip
 * @returns {{ manifestTitle: string, quizzes: object[], resolveFile: Function, xmlPaths: Map<string, string> }}
 */
function buildImportPlan(buffer) {
    const pkg = readCanvasPackage(buffer);
    const parsed = pkg.quizzes.map(({ ident, xml, metaXml }) => parseCanvasQuiz({ ident, xml, metaXml }));
    return {
        manifestTitle: pkg.manifestTitle,
        quizzes: mapCanvasQuizzes(parsed).sort(compareQuizCreationOrder),
        resolveFile: pkg.resolveFile,
        xmlPaths: new Map(pkg.quizzes.map((quiz) => [quiz.ident, quiz.xmlPath])),
    };
}

/**
 * What a course already holds from these Canvas quizzes, found by provenance.
 * Orphaned questions count as imported: re-importing must not recreate a
 * question whose objective an instructor deleted.
 */
async function findExistingState(db, courseIdObj, quizzes) {
    const quizIdents = quizzes.map((quiz) => quiz.ident);
    const itemIdents = [...new Set(quizzes.flatMap((quiz) =>
        quiz.slots.flatMap((slot) => slot.questions.map((draft) => draft.itemIdent))))];
    const slotIdents = [...new Set(quizzes.flatMap((quiz) => quiz.slots.map((slot) => slot.ident)))];

    const [questions, parents, graspQuizzes] = await Promise.all([
        itemIdents.length
            ? db.collection("grasp_question").find(
                {
                    courseId: courseIdObj,
                    "source.itemIdent": { $in: itemIdents },
                    "source.quizIdent": { $in: quizIdents },
                },
                { projection: { _id: 1, source: 1, orphaned: 1, granularObjectiveId: 1 } }
            ).toArray()
            : [],
        slotIdents.length
            ? db.collection("grasp_objective").find({
                courseId: courseIdObj,
                parent: 0,
                "source.slotIdent": { $in: slotIdents },
                "source.quizIdent": { $in: quizIdents },
            }).toArray()
            : [],
        quizIdents.length
            ? db.collection("grasp_quiz").find(
                { courseId: courseIdObj, "source.quizIdent": { $in: quizIdents } },
                { projection: { _id: 1, name: 1, source: 1, importLinkedItems: 1 } }
            ).toArray()
            : [],
    ]);

    // The first match wins when an earlier, interrupted run left two.
    const index = (docs, key) => {
        const map = new Map();
        docs.forEach((doc) => {
            const k = key(doc);
            if (!map.has(k)) map.set(k, doc);
        });
        return map;
    };
    return {
        questions: index(questions, (doc) => keyOf(doc.source.quizIdent, doc.source.itemIdent)),
        // Kept as a list too: picking a slot's granular looks at its questions.
        questionList: questions,
        parents: index(parents, (doc) => keyOf(doc.source.quizIdent, doc.source.slotIdent)),
        quizzes: index(graspQuizzes, (doc) => doc.source.quizIdent),
    };
}

// Bytes that are a PNG, JPEG, GIF or WebP within the size cap, or null.
function checkImageBytes(data, maxBytes) {
    if (!data || data.length > maxBytes) return null;
    const mimeType = sniffImageType(data);
    return mimeType ? { ok: true, data, mimeType } : null;
}

function decodeDataImage(src, maxBytes) {
    const prefix = DATA_IMAGE_PREFIX.exec(src);
    if (!prefix) return null;
    const base64 = src.slice(prefix[0].length).replace(/\s+/g, "");
    // Refuse before decoding anything that would be over the cap.
    if (base64.length > Math.ceil(maxBytes / 3) * 4) return null;
    return Buffer.from(base64, "base64");
}

/**
 * An image that does not need the network: a file in the zip or an inline
 * data: image. Remote links resolve elsewhere; any other kind of source was
 * already reported by the HTML conversion, so it fails without a new warning.
 */
function readLocalImage(plan, quizIdent, image, maxBytes) {
    let data = null;
    if (image.kind === "bundled") {
        const file = plan.resolveFile(image.src, { fromPath: plan.xmlPaths.get(quizIdent) });
        data = file ? file.data : null;
    } else if (image.kind === "data") {
        data = decodeDataImage(image.src, maxBytes);
    } else {
        return { ok: false, warning: null };
    }
    return checkImageBytes(data, maxBytes) || { ok: false, warning: IMAGE_WARNINGS.EXPORT };
}

/**
 * Preview an export: what each Canvas quiz would import, what is already in
 * the course, what is skipped and why. Writes nothing.
 * @param {{ courseId: string, buffer: Buffer, deps?: { imageHosts?: Set<string> } }} input
 * @returns {Promise<object>} PreviewReport
 */
async function previewCanvasImport({ courseId, buffer, deps = {} }) {
    const plan = buildImportPlan(buffer);
    const db = await databaseService.connect();
    const existing = await findExistingState(db, toId(courseId), plan.quizzes);
    const hosts = deps.imageHosts || canvasImageHostsFromEnv();

    const remoteUrls = new Set();
    const totals = {
        quizzes: plan.quizzes.length,
        items: 0,
        importable: 0,
        alreadyImported: 0,
        skipped: 0,
        remoteImages: 0,
        bundledImages: 0,
        predictedDrafts: 0,
    };

    const quizzes = plan.quizzes.map((quiz) => {
        const predictedDrafts = [];
        const graspQuiz = existing.quizzes.get(quiz.ident);
        const decidedItems = decidedItemsOf(graspQuiz);
        // Questions an earlier import saved but never decided about for its
        // GRASP quiz (the run stopped part-way before linking them): a commit
        // adds them, so there is work to do.
        let unlinked = 0;
        const slots = quiz.slots.map((slot) => {
            const counts = { importable: 0, alreadyImported: 0 };
            for (const draft of slot.questions) {
                const doc = existing.questions.get(keyOf(quiz.ident, draft.itemIdent));
                if (doc) {
                    counts.alreadyImported += 1;
                    if (graspQuiz && !doc.orphaned && !decidedItems.has(draft.itemIdent)) unlinked += 1;
                    continue;
                }
                counts.importable += 1;
                const reasons = [...draft.warnings];
                for (const { image, letter } of imageRefsOf(draft)) {
                    if (image.kind === "remote") {
                        // The commit refuses links outside the allow-list
                        // without a request, so they can be predicted here.
                        if (isAllowedCanvasImageUrl(image.src, hosts)) remoteUrls.add(image.src);
                        else pushUnique(reasons, imageWarning(letter, IMAGE_WARNINGS.REMOTE));
                        continue;
                    }
                    if (image.kind === "bundled") totals.bundledImages += 1;
                    const local = readLocalImage(plan, quiz.ident, image, IMPORT_LIMITS.maxImageBytes);
                    if (!local.ok && local.warning) pushUnique(reasons, imageWarning(letter, local.warning));
                }
                if (reasons.length) {
                    predictedDrafts.push({ slotName: slot.name, title: draft.payload.title, reasons });
                }
            }
            return {
                name: slot.name,
                variants: slot.questions.length + slot.skipped.length,
                ...counts,
            };
        });

        const importable = slots.reduce((sum, slot) => sum + slot.importable, 0);
        const alreadyImported = slots.reduce((sum, slot) => sum + slot.alreadyImported, 0);
        totals.items += importable + alreadyImported + quiz.skipped.length;
        totals.importable += importable;
        totals.alreadyImported += alreadyImported;
        totals.skipped += quiz.skipped.length;
        totals.predictedDrafts += predictedDrafts.length;

        return {
            ident: quiz.ident,
            title: quiz.title,
            flavour: quiz.flavour,
            dueAt: quiz.order.dueAt,
            position: quiz.order.position,
            items: importable + alreadyImported + quiz.skipped.length,
            importable,
            alreadyImported,
            unlinked,
            skippedCount: quiz.skipped.length,
            slots,
            existingQuiz: graspQuiz ? { id: String(graspQuiz._id), name: graspQuiz.name } : null,
            skipped: quiz.skipped.map(publicSkip),
            predictedDrafts,
            notes: quiz.notes,
        };
    });
    totals.remoteImages = remoteUrls.size;

    return { manifestTitle: plan.manifestTitle, totals, quizzes };
}

/**
 * Images for one commit: remote links are fetched once each (several variants
 * often share one), then every reference gets its own GridFS file, because
 * editing or deleting a question deletes its files without checking whether
 * another question uses them.
 */
function createImageStore({ plan, quiz, fetcher, limits, courseId, userId }) {
    const remote = new Map();
    let storedBytes = 0;
    let uploads = 0;

    async function fetchRemote(urls) {
        const started = Date.now();
        let fetchedBytes = 0;
        let next = 0;
        const worker = async () => {
            while (next < urls.length) {
                const index = next;
                next += 1;
                const url = urls[index];
                if (index >= limits.maxRemoteImages || fetchedBytes >= limits.maxImageBytesPerQuiz) {
                    remote.set(url, OVER_LIMIT);
                    continue;
                }
                if (Date.now() - started >= limits.fetchBudgetMs) {
                    remote.set(url, { ok: false, reason: "timeout" });
                    continue;
                }
                let result;
                try {
                    result = await fetcher.fetchImage(url);
                } catch {
                    result = { ok: false, reason: "network" };
                }
                if (result.ok) fetchedBytes += result.data.length;
                remote.set(url, result);
            }
        };
        const workers = Math.max(1, Math.min(limits.fetchConcurrency, urls.length));
        await Promise.all(Array.from({ length: workers }, worker));
    }

    function load(image) {
        if (image.kind !== "remote") return readLocalImage(plan, quiz.ident, image, limits.maxImageBytes);
        const result = remote.get(image.src);
        if (result && result.ok) return result;
        return { ok: false, warning: result === OVER_LIMIT ? IMAGE_WARNINGS.TOO_MANY : IMAGE_WARNINGS.REMOTE };
    }

    // Upload one reference. Returns { ok, ref } or { ok: false, warning }.
    // `uploaded` collects file ids so a failed save can delete them.
    async function store(image, uploaded) {
        const loaded = load(image);
        if (!loaded.ok) return loaded;
        if (storedBytes + loaded.data.length > limits.maxImageBytesPerQuiz) {
            return { ok: false, warning: IMAGE_WARNINGS.TOO_MANY };
        }
        uploads += 1;
        // A neutral name: Canvas file names can give the answer away, and
        // students are sent the filename.
        const ref = await uploadImage(loaded.data, {
            filename: `canvas-image-${uploads}.${extensionForImageMime(loaded.mimeType)}`,
            mimeType: loaded.mimeType,
            courseId,
            uploadedBy: userId,
        });
        storedBytes += loaded.data.length;
        uploaded.push(ref.fileId);
        return { ok: true, ref: { ...ref, caption: image.caption || "" } };
    }

    return { fetchRemote, store };
}

/**
 * The granular objective each slot's questions go on: the slot's parent is
 * found by provenance, or created with one granular of the same name. The
 * parent is linked to the course's "From Canvas" material, since an import
 * brings no course material of its own (issue #165).
 */
function createSlotObjectives({ db, courseId, courseIdObj, quiz, existing, report }) {
    let takenNames = null;
    let childrenByParent = null;
    let parentsWithMaterial = null;
    let canvasMaterial = null;

    // "<name>", else "<name> (2)", "(3)" ... against every parent in the course.
    async function uniqueParentName(base) {
        if (!takenNames) {
            const parents = await db.collection("grasp_objective")
                .find({ courseId: courseIdObj, parent: 0 }, { projection: { name: 1 } })
                .toArray();
            takenNames = new Set(parents.map((parent) => normalizeName(parent.name)));
        }
        let name = base;
        for (let n = 2; takenNames.has(normalizeName(name)); n += 1) name = `${base} (${n})`;
        takenNames.add(normalizeName(name));
        return name;
    }

    async function childrenOf(parentId) {
        if (!childrenByParent) {
            const parentIds = quiz.slots
                .map((slot) => existing.parents.get(keyOf(quiz.ident, slot.ident)))
                .filter(Boolean)
                .map((parent) => parent._id);
            const children = parentIds.length
                ? await db.collection("grasp_objective")
                    .find({ courseId: courseIdObj, parent: { $in: parentIds } })
                    .toArray()
                : [];
            childrenByParent = new Map();
            children.forEach((child) => {
                const key = String(child.parent);
                if (!childrenByParent.has(key)) childrenByParent.set(key, []);
                childrenByParent.get(key).push(child);
            });
        }
        return childrenByParent.get(String(parentId)) || [];
    }

    async function hasMaterial(parentId) {
        if (!parentsWithMaterial) {
            const parentIds = quiz.slots
                .map((slot) => existing.parents.get(keyOf(quiz.ident, slot.ident)))
                .filter(Boolean)
                .map((parent) => parent._id);
            parentsWithMaterial = await objectivesWithMaterials(parentIds);
        }
        return parentsWithMaterial.has(String(parentId));
    }

    // A parent this import made always gets the material. An earlier one gets
    // it only when it has none: it predates the material, or its material was
    // deleted. Best effort: the material only says where an objective came
    // from, so a failure here is logged and the import carries on.
    async function linkCanvasMaterial(parentId, { created }) {
        try {
            if (!created && (await hasMaterial(parentId))) return;
            if (!canvasMaterial) canvasMaterial = await ensureCanvasImportMaterial(courseIdObj);
            await linkObjectiveToMaterial(parentId, canvasMaterial._id);
        } catch (error) {
            console.error("Could not link an imported objective to the From Canvas material:", error.message);
        }
    }

    return async function granularFor(slot) {
        const parent = existing.parents.get(keyOf(quiz.ident, slot.ident));
        if (!parent) {
            const name = await uniqueParentName(slot.name);
            const created = await createObjective({
                name,
                granularObjectives: [{ text: name }],
                courseId,
                source: { kind: SOURCE_KIND, quizIdent: quiz.ident, slotIdent: slot.ident },
            });
            report.created.objectives += 1;
            await linkCanvasMaterial(created.parent._id, { created: true });
            return created.granular[0]._id;
        }

        await linkCanvasMaterial(parent._id, { created: false });
        const children = await childrenOf(parent._id);
        if (children.length === 0) {
            const text = String(parent.name || "").trim() || slot.name;
            const appended = await appendGranularObjectives(parent._id, [{ text }]);
            return (appended.added[0] || appended.granular[0])._id;
        }
        // An instructor may have added granulars since: stay on the one this
        // slot's earlier variants use.
        const used = new Set(existing.questionList
            .filter((doc) => doc.source.quizIdent === quiz.ident && doc.source.slotIdent === slot.ident)
            .map((doc) => String(doc.granularObjectiveId)));
        return (children.find((child) => used.has(String(child._id))) || children[0])._id;
    };
}

/**
 * Import ONE Canvas quiz from the export: its new questions (with their
 * images), one objective per slot, and optionally a GRASP quiz.
 * @param {object} input
 * @param {string} input.courseId
 * @param {Buffer} input.buffer - The uploaded zip
 * @param {string} input.quizIdent - Which Canvas quiz to import
 * @param {boolean} input.createQuiz - Also create (or extend) a GRASP quiz.
 *   False from someone who may create quizzes, when the GRASP quiz exists,
 *   keeps this run's new questions out of it on later commits too.
 * @param {object} input.user - The importing user (req.user)
 * @param {boolean} input.canApprove - Faculty: lossless questions are Approved
 * @param {boolean} input.canCreateQuizzes - May create GRASP quizzes
 * @param {{ fetcher?: { fetchImage: Function }, limits?: object }} [input.deps]
 * @returns {Promise<object>} CommitReport
 * @throws {CanvasImportError} IMPORT_IN_PROGRESS (409) while another commit
 *   of the same Canvas quiz runs in this course
 */
async function commitCanvasQuiz({
    courseId,
    buffer,
    quizIdent,
    createQuiz: wantsQuiz,
    user,
    canApprove,
    canCreateQuizzes,
    deps = {},
}) {
    const plan = buildImportPlan(buffer);
    const quiz = plan.quizzes.find((candidate) => candidate.ident === quizIdent);
    if (!quiz) throw new CanvasImportError(UNKNOWN_QUIZ, "UNKNOWN_QUIZ");

    const db = await databaseService.connect();
    // Taken before the course is read, so a second commit of this quiz cannot
    // work from a snapshot the first one is about to change.
    const releaseLock = await acquireImportLock(db, courseId, quiz.ident);
    try {
        return await importQuiz({ db, plan, quiz, courseId, wantsQuiz, user, canApprove, canCreateQuizzes, deps });
    } finally {
        await releaseLock();
    }
}

/**
 * Lock one (course, Canvas quiz) for a commit. The lock's _id is the pair, so
 * MongoDB's unique _id refuses a second one from any worker. An expired lock
 * (its commit died with its worker) is taken over. Returns the release
 * function, which removes only this commit's own lock.
 */
async function acquireImportLock(db, courseId, quizIdent) {
    const locks = db.collection(LOCK_COLLECTION);
    const _id = `${courseId}:${quizIdent}`;
    const owner = new ObjectId();
    const tryInsert = async () => {
        const startedAt = new Date();
        try {
            await locks.insertOne({ _id, owner, startedAt, expiresAt: new Date(startedAt.getTime() + IMPORT_LOCK_MS) });
            return true;
        } catch (error) {
            if (error?.code === 11000) return false;
            throw error;
        }
    };

    if (!(await tryInsert())) {
        await locks.deleteOne({ _id, expiresAt: { $lt: new Date() } });
        if (!(await tryInsert())) {
            throw new CanvasImportError(IMPORT_IN_PROGRESS, "IMPORT_IN_PROGRESS", 409);
        }
    }
    return async function releaseLock() {
        try {
            await locks.deleteOne({ _id, owner });
        } catch (error) {
            // Not worth failing a finished commit over: the lock expires.
            console.error("Could not release the Canvas import lock:", error.message);
        }
    };
}

// The body of commitCanvasQuiz, run while this quiz is locked.
async function importQuiz({ db, plan, quiz, courseId, wantsQuiz, user, canApprove, canCreateQuizzes, deps }) {
    const limits = { ...IMPORT_LIMITS, ...(deps.limits || {}) };
    const userId = String(user?._id || user?.id || "");
    const courseIdObj = toId(courseId);
    const existing = await findExistingState(db, courseIdObj, [quiz]);

    const report = {
        quizIdent: quiz.ident,
        title: quiz.title,
        created: { questions: 0, approved: 0, drafts: 0, objectives: 0 },
        alreadyImported: 0,
        skipped: quiz.skipped.map(publicSkip),
        drafts: [],
        failures: [],
        imageFailures: 0,
        quiz: null,
    };

    const graspQuiz = existing.quizzes.get(quiz.ident);
    const linker = wantsQuiz && canCreateQuizzes
        ? createQuizLinker({ db, quiz, graspQuiz, courseId })
        : null;
    // Leaving "Create a GRASP quiz" off when this Canvas quiz already has one
    // is an instructor's choice not to add to it: what this run saves is
    // recorded as decided, so a later commit does not add it either. Someone
    // who cannot create quizzes never gets that choice, so nothing is recorded.
    const declinedQuiz = !wantsQuiz && canCreateQuizzes ? graspQuiz || null : null;
    // Only new questions are saved. Questions from earlier imports go in the
    // GRASP quiz too unless an import already decided about them (so the ones
    // an instructor took out, or chose not to add, stay out); orphaned ones
    // cannot go in.
    const work = quiz.slots.map((slot) => ({
        slot,
        drafts: slot.questions.filter((draft) => {
            const doc = existing.questions.get(keyOf(quiz.ident, draft.itemIdent));
            if (!doc) return true;
            report.alreadyImported += 1;
            if (linker && !doc.orphaned && !linker.wasDecided(draft.itemIdent)) linker.add(doc._id, draft.itemIdent);
            return false;
        }),
    }));
    // Before anything slow that could fail.
    if (linker) await linker.flush();

    const images = createImageStore({
        plan,
        quiz,
        fetcher: deps.fetcher
            || createCanvasImageFetcher({ maxBytes: limits.maxImageBytes, concurrency: limits.fetchConcurrency }),
        limits,
        courseId,
        userId,
    });
    const remoteUrls = [...new Set(work.flatMap(({ drafts }) => drafts.flatMap((draft) =>
        imageRefsOf(draft).filter(({ image }) => image.kind === "remote").map(({ image }) => image.src))))];
    await images.fetchRemote(remoteUrls);

    const granularFor = createSlotObjectives({ db, courseId, courseIdObj, quiz, existing, report });
    try {
        for (const { slot, drafts } of work) {
            if (drafts.length === 0) continue;
            const granularId = await granularFor(slot);
            for (const draft of drafts) {
                const savedId = await saveDraft({ draft, slot, granularId, images, courseId, userId, canApprove, report });
                if (!savedId) continue;
                if (linker) {
                    linker.add(savedId, draft.itemIdent);
                } else if (declinedQuiz) {
                    // Question by question, so a run that stops part-way
                    // keeps the choice for what it saved.
                    await recordDecidedItems(db, declinedQuiz._id, [draft.itemIdent]);
                }
            }
            // Slot by slot, so a commit that stops part-way has already put
            // what it saved in the GRASP quiz.
            if (linker) await linker.flush();
        }
    } catch (error) {
        // Best effort for what this run saved; anything still unlinked is
        // added by the next commit of this quiz.
        if (linker) {
            await linker.flush().catch((linkError) => {
                console.error("Could not add the imported questions to the GRASP quiz:", linkError.message);
            });
        }
        throw error;
    }

    report.quiz = linker ? linker.result() : null;
    return report;
}

// Upload a draft's images and save it. Returns the new question id, or null
// after recording why it failed (its uploads are deleted again).
async function saveDraft({ draft, slot, granularId, images, courseId, userId, canApprove, report }) {
    const uploaded = [];
    const warnings = [...draft.warnings];
    const { payload } = draft;
    try {
        const stemImages = [];
        for (const image of draft.stemImages) {
            const stored = await images.store(image, uploaded);
            if (stored.ok) {
                stemImages.push(stored.ref);
            } else {
                report.imageFailures += 1;
                pushUnique(warnings, stored.warning);
            }
        }

        let options = payload.options;
        if (options) {
            options = Object.fromEntries(Object.entries(options).map(([letter, option]) => [letter, { ...option }]));
            for (const [letter, image] of Object.entries(draft.optionImages)) {
                const stored = await images.store(image, uploaded);
                if (stored.ok) {
                    options[letter].image = stored.ref;
                    continue;
                }
                report.imageFailures += 1;
                if (stored.warning) pushUnique(warnings, imageWarning(letter, stored.warning));
                // An empty option would render as nothing and could be the
                // correct answer.
                if (!options[letter].text) options[letter].text = IMAGE_UNAVAILABLE;
            }
        }

        const status = canApprove && warnings.length === 0 ? "Approved" : "Draft";
        const result = await saveQuestion(
            courseId,
            {
                ...payload,
                ...(options ? { options } : {}),
                stemImages,
                granularObjectiveId: granularId,
                status,
                by: userId,
                source: draft.source,
                importWarnings: warnings,
            },
            { dedupe: false }
        );

        const questionId = result.insertedId;
        report.created.questions += 1;
        if (status === "Approved") {
            report.created.approved += 1;
        } else {
            report.created.drafts += 1;
            if (warnings.length) {
                report.drafts.push({ slotName: slot.name, title: payload.title, questionId: String(questionId), reasons: warnings });
            }
        }
        return questionId;
    } catch (error) {
        // saveQuestion logs its own errors; the payload it logs has no URLs.
        if (uploaded.length) await deleteImages(uploaded);
        report.failures.push({ slotName: slot.name, title: payload.title, reason: SAVE_FAILED });
        return null;
    }
}

/**
 * Puts imported questions in the GRASP quiz made from this Canvas quiz: the
 * one an earlier import made, else a new unpublished spaced-3phase quiz,
 * created only once there is a question for it, so a commit that saves
 * nothing leaves no empty quiz.
 *
 * The quiz keeps the Canvas items an import has decided about
 * (`importLinkedItems`, outside `source`; see decidedItemsOf): the ones it
 * linked, and the ones an instructor imported without adding them. A later
 * commit adds the questions a run saved but never linked because it stopped
 * part-way, and still leaves out a question an instructor took out of the
 * quiz or chose not to add.
 *
 * `add` queues a question; `flush` links the queue and records it. A failed
 * flush keeps its queue, so it can be tried again.
 */
function createQuizLinker({ db, quiz, graspQuiz, courseId }) {
    const decidedItems = decidedItemsOf(graspQuiz);
    let target = graspQuiz || null;
    let created = false;
    let addedAny = false;
    let pending = [];

    return {
        wasDecided: (itemIdent) => decidedItems.has(itemIdent),
        add(questionId, itemIdent) {
            pending.push({ questionId, itemIdent });
        },
        async flush() {
            if (pending.length === 0) return;
            const batch = pending;
            if (!target) {
                target = await createQuiz(courseId, {
                    ...quiz.quizSettings,
                    deliveryFormat: "spaced-3phase",
                    source: { kind: SOURCE_KIND, quizIdent: quiz.ident },
                    // The client commits quizzes one at a time in Canvas due
                    // order, so creation times keep that order ("earlier
                    // quiz" in spaced repetition).
                    createdAt: new Date(),
                });
                created = true;
            }
            const { insertedCount } = await addExistingQuestionsToQuiz(
                target._id,
                courseId,
                batch.map((entry) => entry.questionId)
            );
            // Recorded after linking: a crash in between only means the next
            // commit offers these again, and linking skips what is there.
            const itemIdents = batch.map((entry) => entry.itemIdent);
            await recordDecidedItems(db, target._id, itemIdents);
            itemIdents.forEach((itemIdent) => decidedItems.add(itemIdent));
            pending = pending.slice(batch.length);
            if (insertedCount > 0) addedAny = true;
        },
        // What the report says about the GRASP quiz: null when this commit
        // neither created it nor added a question to it.
        result() {
            if (!target || !(created || addedAny)) return null;
            return { id: String(target._id), name: target.name, created };
        },
    };
}

module.exports = {
    buildImportPlan,
    previewCanvasImport,
    commitCanvasQuiz,
    IMPORT_LIMITS,
    IMAGE_WARNINGS,
};
