// Turns a caption file (SRT, or WebVTT) into plain text for a course material:
// the cue numbers and timings go, and the cues are joined into paragraphs, a
// new one wherever the speaker pauses.

// A pause this long between two cues starts a new paragraph.
const PARAGRAPH_PAUSE_SECONDS = 3;
// A paragraph this long ends at the next sentence end even without a pause.
const PARAGRAPH_MAX_CHARS = 1000;

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
// The note Panopto puts at the start of a machine-made transcript, such as
// "[Auto-generated transcript. Edits may have been applied for clarity.]".
const AUTO_GENERATED_NOTE = /^\[\s*auto-generated[^\]]*\]\s*/i;

function toSeconds(timestamp) {
  const [clock, fraction] = timestamp.split(/[.,]/);
  const parts = clock.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds + Number(`0.${fraction}`);
}

/**
 * The cues of an SRT or WebVTT file, in order. Blocks without a timing line
 * (a WebVTT header, NOTE or STYLE block) are skipped, and so are cues with no
 * text once markup such as <i> is removed.
 * @param {string} raw
 * @returns {Array<{ start: number, end: number, text: string }>}
 */
function parseCaptionCues(raw) {
  const blocks = String(raw || '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/);

  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex === -1) continue;
    const [, start, end] = lines[timingIndex].match(TIMING);
    const text = lines
      .slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) cues.push({ start: toSeconds(start), end: toSeconds(end), text });
  }
  return cues;
}

/**
 * @param {string} raw - The caption file's text
 * @returns {string} Paragraphs separated by a blank line; '' when the file has
 *   no cues, which is how a video without captions comes back
 */
function captionsToText(raw) {
  const cues = parseCaptionCues(raw);
  if (cues.length > 0) {
    cues[0] = { ...cues[0], text: cues[0].text.replace(AUTO_GENERATED_NOTE, '') };
  }

  const paragraphs = [];
  let current = [];
  let currentLength = 0;
  let previousEnd = null;
  for (const cue of cues) {
    if (!cue.text) continue;
    const paused = previousEnd !== null && cue.start - previousEnd >= PARAGRAPH_PAUSE_SECONDS;
    const longAtSentenceEnd =
      currentLength >= PARAGRAPH_MAX_CHARS && /[.?!]["')\]]*$/.test(current[current.length - 1] || '');
    if (current.length > 0 && (paused || longAtSentenceEnd)) {
      paragraphs.push(current.join(' '));
      current = [];
      currentLength = 0;
    }
    current.push(cue.text);
    currentLength += cue.text.length + 1;
    previousEnd = cue.end;
  }
  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.join('\n\n');
}

module.exports = { captionsToText, parseCaptionCues };
