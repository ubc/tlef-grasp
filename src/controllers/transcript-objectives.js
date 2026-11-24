// Learning objectives from one imported Panopto transcript (issue #218).
//
// Generation from course materials reads each material's outline. This reads
// the transcript itself, through a prompt written for spoken, auto-captioned
// lectures: it knows to skip announcements and asides and to correct misheard
// technical terms, which an outline made by the general summary prompt has
// already flattened.
//
// Nothing is saved here. The instructor edits what comes back and saves it
// through POST /api/objective, linked to this one transcript.

const { getMaterialBySourceId } = require('../services/material');
const outlineService = require('../services/material-outline');
const settingsService = require('../services/settings');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { assertCoInstructorPermission, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_PERMISSION_KEYS } = require('../utils/ta-permissions');
const { generateStructured } = require('../utils/structured-llm');
const { effortForStage } = require('../utils/llm-effort');
const { isRetryableLLMError } = require('../utils/llm-limiter');
const { renderOutlineBlock } = require('../utils/outline-text');
const { cleanGeneratedObjectives } = require('../utils/generated-objectives');
const { OBJECTIVES_SCHEMA } = require('../constants/llm-schemas');
const { DEFAULT_PROMPTS, TRANSCRIPT_OBJECTIVES_MAX_CHARS } = require('../constants/app-constants');

const DEFAULT_RETRY_AFTER_SECONDS = 30;

const OUTLINE_NOTE =
  'This recording is too long to include whole. Below is an outline of its full transcript instead.';

/**
 * What the prompt's {transcript} receives: the whole transcript, or for a very
 * long recording the outline made when it was imported.
 *
 * @returns {Promise<{ content: string, usedOutline: boolean } | { problem: 'empty' | 'too-long' }>}
 */
async function transcriptForPrompt(material) {
  const text = String(material.fileContent || '').trim();
  if (!text) return { problem: 'empty' };
  if (text.length <= TRANSCRIPT_OBJECTIVES_MAX_CHARS) return { content: text, usedOutline: false };

  const stored = await outlineService.getOutline(material.sourceId);
  if (!stored) return { problem: 'too-long' };
  const outline = renderOutlineBlock({
    documentTitle: material.documentTitle,
    sourceId: material.sourceId,
    outline: stored.outline,
  });
  return { content: `${OUTLINE_NOTE}\n\n${outline}`, usedOutline: true };
}

/**
 * Fill the prompt's placeholders in one pass, so a course name, title or
 * transcript that happens to contain "{transcript}" is never substituted into
 * again, and `$` sequences in LaTeX reach the model as written.
 */
function buildTranscriptObjectivesPrompt(template, values) {
  return template.replace(/\{(courseName|videoTitle|transcript)\}/g, (_match, key) => values[key]);
}

async function generateTranscriptObjectivesHandler(req, res) {
  const { courseId, materialId, courseName } = req.body || {};
  if (!courseId || typeof materialId !== 'string' || !materialId.trim()) {
    return res.status(400).json({ success: false, error: 'A course and a video are required.' });
  }

  try {
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ success: false, error: 'User is not in course' });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    const material = await getMaterialBySourceId(materialId);
    if (!material || String(material.courseId) !== String(courseId)) {
      return res.status(404).json({
        success: false,
        code: 'MATERIAL_NOT_FOUND',
        error: "This video is not in this course's materials.",
      });
    }
    if (material.lms?.provider !== 'panopto') {
      return res.status(400).json({
        success: false,
        code: 'NOT_A_TRANSCRIPT',
        error: 'Only videos imported from Panopto can be turned into learning objectives here.',
      });
    }

    const transcript = await transcriptForPrompt(material);
    if (transcript.problem === 'empty') {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_TRANSCRIPT',
        error: "This video's transcript is empty.",
      });
    }
    if (transcript.problem === 'too-long') {
      return res.status(400).json({
        success: false,
        code: 'TRANSCRIPT_TOO_LONG',
        error:
          'This recording is too long to read whole, and it has no outline to read instead. '
          + 'Generate its outline from its card in Course Materials, then try again.',
      });
    }

    const settings = await settingsService.getSettings(String(courseId));
    const template =
      settings?.prompts?.objectiveGenerationTranscript || DEFAULT_PROMPTS.objectiveGenerationTranscript;
    const prompt = buildTranscriptObjectivesPrompt(template, {
      courseName: String(courseName || '').trim() || 'Course',
      videoTitle: String(material.documentTitle || '').trim() || 'Lecture recording',
      transcript: transcript.content,
    });

    const { content } = await generateStructured({
      prompt,
      schema: OBJECTIVES_SCHEMA,
      operation: 'objective-generate',
      effort: effortForStage(settings, 'objective-generate'),
    });
    if (!content) throw new Error('Empty response from the model.');
    const data = JSON.parse(content);

    if (!data.materialIsRelevant) {
      return res.status(422).json({
        success: false,
        code: 'MATERIAL_NOT_RELEVANT',
        error: "This video doesn't seem to teach enough course content to create learning objectives from.",
        details: data.relevanceReason || '',
      });
    }

    const objectives = cleanGeneratedObjectives(data.objectives);
    if (objectives.length === 0) {
      throw new Error('The model returned no usable learning objectives.');
    }

    console.log(
      `✅ Generated ${objectives.length} learning objectives from transcript ${materialId}`
      + `${transcript.usedOutline ? ' (via its outline)' : ''}`
    );
    return res.json({ success: true, objectives, usedOutline: transcript.usedOutline });
  } catch (error) {
    if (isRetryableLLMError(error)) {
      const headerValue = error?.headers?.['retry-after'] ?? error?.response?.headers?.['retry-after'];
      const parsed = parseInt(headerValue, 10);
      const retryAfter = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        rateLimited: true,
        retryAfterSeconds: retryAfter,
        error: 'The AI service is busy. Please try again in a minute.',
      });
    }
    console.error('Error generating learning objectives from a transcript:', error);
    return res.status(500).json({
      success: false,
      error: 'GRASP could not create learning objectives from this video. Please try again.',
    });
  }
}

module.exports = {
  generateTranscriptObjectivesHandler,
  buildTranscriptObjectivesPrompt,
};
