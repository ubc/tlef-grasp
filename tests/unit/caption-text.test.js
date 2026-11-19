const { captionsToText, parseCaptionCues } = require('../../src/utils/caption-text');

describe('captionsToText', () => {
  it('keeps the words of an SRT file and drops cue numbers and timings', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,500',
      'Hello and',
      'welcome.',
      '',
      '2',
      '00:00:02,600 --> 00:00:04,000',
      'Today is osmosis.',
      '',
    ].join('\r\n');
    expect(captionsToText(srt)).toBe('Hello and welcome. Today is osmosis.');
  });

  it('strips Panopto\'s auto-generated note but keeps the rest of that cue', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:03,000',
      '[Auto-generated transcript. Edits may have been applied for clarity.] So, carbon carbon bonds.',
    ].join('\n');
    expect(captionsToText(srt)).toBe('So, carbon carbon bonds.');
  });

  it('drops a first cue that is only the note', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      '[Auto-generated transcript. Edits may have been applied for clarity.]',
      '',
      '2',
      '00:00:01,000 --> 00:00:02,000',
      'Okay.',
    ].join('\n');
    expect(captionsToText(srt)).toBe('Okay.');
  });

  it('starts a new paragraph at a pause', () => {
    const srt = [
      '1', '00:00:01,000 --> 00:00:02,000', 'First idea.', '',
      '2', '00:00:02,100 --> 00:00:03,000', 'Still first.', '',
      '3', '00:00:09,000 --> 00:00:10,000', 'After a pause.', '',
    ].join('\n');
    expect(captionsToText(srt)).toBe('First idea. Still first.\n\nAfter a pause.');
  });

  it('breaks a long paragraph at a sentence end', () => {
    const sentence = `${'word '.repeat(60).trim()}.`;
    const cues = Array.from({ length: 6 }, (_, i) => [
      String(i + 1),
      `00:00:${String(i).padStart(2, '0')},000 --> 00:00:${String(i).padStart(2, '0')},900`,
      sentence,
      '',
    ].join('\n'));
    const paragraphs = captionsToText(cues.join('\n')).split('\n\n');
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.every((paragraph) => paragraph.endsWith('.'))).toBe(true);
  });

  it('reads WebVTT, skipping the header, notes and markup', () => {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE made by a test',
      '',
      '00:01.000 --> 00:02.000 align:start',
      '<v Speaker>Hello <i>there</i></v>',
      '',
    ].join('\n');
    expect(captionsToText(vtt)).toBe('Hello there');
  });

  it.each(['', '   ', 'WEBVTT\n\n', '<html><body></body></html>'])(
    'returns nothing for a file with no cues (%p)',
    (raw) => {
      expect(captionsToText(raw)).toBe('');
    }
  );

  it('reads cue timings in seconds', () => {
    expect(parseCaptionCues('1\n01:02:03,500 --> 01:02:04,000\nx')).toEqual([
      { start: 3723.5, end: 3724, text: 'x' },
    ]);
  });
});
