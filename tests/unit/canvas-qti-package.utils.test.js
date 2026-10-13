const zlib = require('node:zlib');
const {
  CanvasImportError,
  DEFAULT_LIMITS,
  readCanvasPackage,
} = require('../../src/utils/canvas-qti-package');
const { buildManifest, buildExportZip } = require('../fixtures/canvas-qti/zip');

// Synthetic content only. Image bytes are a PNG signature plus a label, enough
// to tell files apart.
const png = (label) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]);

const quizXml = (ident) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">\n' +
  `  <assessment ident="${ident}" title="Synthetic quiz ${ident}"/>\n` +
  '</questestinterop>\n';

const metaXml = (ident, title) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  `<quiz identifier="${ident}" xmlns="http://canvas.instructure.com/xsd/cccv1p0">\n  <title>${title}</title>\n</quiz>\n`;

function quizFiles(ident, title) {
  return {
    [`${ident}/${ident}.xml`]: quizXml(ident),
    [`${ident}/assessment_meta.xml`]: metaXml(ident, title),
  };
}

const ONE_QUIZ = [{ ident: 'gquiz1', title: 'Week 1 check' }];

// A quiz export with its manifest, quiz folders, bundled `files` (listed in the
// manifest) and `extra` entries (not listed).
function exportZip({ quizzes = ONE_QUIZ, files = {}, extra = {}, manifest, ...zipOptions } = {}) {
  const entries = {
    'imsmanifest.xml': manifest ?? buildManifest({ quizzes, files: Object.keys(files) }),
    ...Object.assign({}, ...quizzes.map((quiz) => quizFiles(quiz.ident, quiz.title))),
    ...files,
    ...extra,
  };
  return buildExportZip({ entries, ...zipOptions });
}

function thrownBy(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function expectImportError(fn, { code, message, status = 400 }) {
  const error = thrownBy(fn);
  expect(error).toBeInstanceOf(CanvasImportError);
  expect({ code: error.code, message: error.message, status: error.status }).toEqual({ code, message, status });
}

// Rewrite one central-directory record in place (a copy), e.g. to make an
// entry lie about its unpacked size the way a zip bomb does.
function patchCentralRecord(zip, name, patch) {
  const copy = Buffer.from(zip);
  let end = copy.length - 22;
  while (copy.readUInt32LE(end) !== 0x06054b50) end--;
  let at = copy.readUInt32LE(end + 16);
  for (let i = 0; i < copy.readUInt16LE(end + 10); i++) {
    const nameLength = copy.readUInt16LE(at + 28);
    if (copy.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      patch(copy, at);
      return copy;
    }
    at += 46 + nameLength + copy.readUInt16LE(at + 30) + copy.readUInt16LE(at + 32);
  }
  throw new Error(`no entry named ${name}`);
}

// The same archive with a zip64 end record, as zip tools write for very large
// archives: the classic end record then holds only 0xFFFF / 0xFFFFFFFF.
function withZip64EndRecord(zip) {
  const end = zip.length - 22; // fixture zips carry no comment
  const count = BigInt(zip.readUInt16LE(end + 10));
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(count, 24);
  record.writeBigUInt64LE(count, 32);
  record.writeBigUInt64LE(BigInt(zip.readUInt32LE(end + 12)), 40);
  record.writeBigUInt64LE(BigInt(zip.readUInt32LE(end + 16)), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(end), 8);
  locator.writeUInt32LE(1, 16);
  const classic = Buffer.from(zip.subarray(end));
  classic.writeUInt16LE(0xffff, 8);
  classic.writeUInt16LE(0xffff, 10);
  classic.writeUInt32LE(0xffffffff, 12);
  classic.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([zip.subarray(0, end), record, locator, classic]);
}

const MESSAGES = {
  notAZip: "That file isn't a zip archive. Upload the .zip that Canvas gave you.",
  damaged: "This zip is damaged, so it can't be read. Download the export from Canvas again.",
  noManifest: "This zip has no imsmanifest.xml, so it isn't a Canvas quiz export.",
  courseExport:
    'This is a full Canvas course export. In Canvas, use Settings > Export Course Content > Quiz instead, and upload that .zip.',
  noQuizzes: "This Canvas export doesn't contain any quizzes.",
  missingQuiz: 'This export is incomplete: a quiz listed in imsmanifest.xml is missing from the zip.',
};

describe('CanvasImportError', () => {
  test('carries a user-safe message, a code and an HTTP status (400 by default)', () => {
    const plain = new CanvasImportError('Nope.', 'NO_QUIZZES');
    const custom = new CanvasImportError('Too big.', 'TOO_LARGE', 413);

    expect(plain).toBeInstanceOf(Error);
    expect([plain.name, plain.message, plain.code, plain.status]).toEqual(['CanvasImportError', 'Nope.', 'NO_QUIZZES', 400]);
    expect([custom.code, custom.status]).toEqual(['TOO_LARGE', 413]);
  });
});

describe('readCanvasPackage: the zip container', () => {
  test.each([
    ['an HTML page', Buffer.from('<!DOCTYPE html><html><body>Not a zip</body></html>')],
    ['an empty buffer', Buffer.alloc(0)],
    ['a string', 'PK\u0005\u0006'],
    ['nothing', undefined],
  ])('rejects %s as not a zip', (_label, input) => {
    expectImportError(() => readCanvasPackage(input), { code: 'NOT_A_ZIP', message: MESSAGES.notAZip });
  });

  test('rejects a zip whose central directory is broken', async () => {
    const zip = await exportZip();
    const end = zip.length - 22;
    const broken = Buffer.from(zip);
    broken.writeUInt32LE(0, broken.readUInt32LE(end + 16));

    expectImportError(() => readCanvasPackage(broken), { code: 'NOT_A_ZIP', message: MESSAGES.notAZip });
  });

  test('reads sizes from zip64 extra fields, the way Canvas writes its exports', async () => {
    const zip = await exportZip({
      files: { 'assessment_questions/dye.png': png('dye') },
      zip64Extra: true,
    });

    const pkg = readCanvasPackage(zip);

    expect(pkg.quizzes).toEqual([
      {
        ident: 'gquiz1',
        xmlPath: 'gquiz1/gquiz1.xml',
        xml: quizXml('gquiz1'),
        metaXml: metaXml('gquiz1', 'Week 1 check'),
      },
    ]);
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/assessment_questions/dye.png').data).toEqual(png('dye'));
  });

  test('reads the entry count and directory offset from a zip64 end record', async () => {
    const zip = withZip64EndRecord(await exportZip({ files: { 'assessment_questions/dye.png': png('dye') } }));

    const pkg = readCanvasPackage(zip);

    expect(pkg.quizzes.map((quiz) => quiz.xmlPath)).toEqual(['gquiz1/gquiz1.xml']);
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/assessment_questions/dye.png').data).toEqual(png('dye'));
    expectImportError(() => readCanvasPackage(zip, { limits: { maxEntries: 3 } }), {
      code: 'TOO_LARGE',
      status: 413,
      message: 'This zip holds more than 3 files, which is too many to import.',
    });
  });

  test('accepts a Uint8Array as well as a Buffer', async () => {
    const zip = await exportZip();
    const pkg = readCanvasPackage(new Uint8Array(zip));
    expect(pkg.quizzes.map((quiz) => quiz.ident)).toEqual(['gquiz1']);
  });

  test('strips a wrapping folder and the __MACOSX entries of a re-zipped export', async () => {
    const zip = await exportZip({
      files: { 'assessment_questions/dye.png': png('dye') },
      topFolder: 'Week 1 export',
      macosx: true,
    });

    const pkg = readCanvasPackage(zip);

    expect(pkg.quizzes.map(({ ident, xmlPath }) => ({ ident, xmlPath }))).toEqual([
      { ident: 'gquiz1', xmlPath: 'gquiz1/gquiz1.xml' },
    ]);
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/assessment_questions/dye.png')).toEqual({
      path: 'assessment_questions/dye.png',
      data: png('dye'),
    });
    // The AppleDouble twin (__MACOSX/Week 1 export/assessment_questions/._dye.png) is not a file.
    expect(pkg.resolveFile('assessment_questions/._dye.png')).toBeNull();
    expect(pkg.resolveFile('._dye.png')).toBeNull();
  });

  test('skips __MACOSX entries and AppleDouble files without a wrapping folder too', async () => {
    const zip = await exportZip({
      files: { 'assessment_questions/dye.png': png('dye') },
      extra: { 'assessment_questions/._dye.png': png('apple double') },
      macosx: true,
    });

    const pkg = readCanvasPackage(zip);

    expect(pkg.resolveFile('assessment_questions/._dye.png')).toBeNull();
    // Would otherwise match __MACOSX/assessment_questions/._dye.png as a suffix.
    expect(pkg.resolveFile('._dye.png')).toBeNull();
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/assessment_questions/dye.png').data).toEqual(png('dye'));
  });

  test('ignores entries whose names climb out of the package or are absolute', async () => {
    const zip = await exportZip({
      extra: { '../escape.png': png('escape'), '/absolute.png': png('absolute'), 'C:/drive.png': png('drive') },
      rawNames: true,
    });

    const pkg = readCanvasPackage(zip);

    expect(pkg.quizzes.map((quiz) => quiz.ident)).toEqual(['gquiz1']);
    expect(pkg.resolveFile('escape.png')).toBeNull();
    expect(pkg.resolveFile('absolute.png')).toBeNull();
    expect(pkg.resolveFile('drive.png')).toBeNull();
  });

  test('keeps the first of two entries stored under the same path', async () => {
    const zip = await buildExportZip({
      entries: [
        ['imsmanifest.xml', buildManifest({ quizzes: ONE_QUIZ })],
        ...Object.entries(quizFiles('gquiz1', 'Week 1 check')),
        ['assessment_questions/dye.png', png('first')],
        ['assessment_questions/dye.png', png('second')],
      ],
    });

    const pkg = readCanvasPackage(zip);

    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/assessment_questions/dye.png').data).toEqual(png('first'));
  });

  test('treats a quiz file that unpacks past its declared size as damaged', async () => {
    const zip = await exportZip();
    const lying = patchCentralRecord(zip, 'gquiz1/gquiz1.xml', (buf, at) => {
      buf.writeUInt32LE(buf.readUInt32LE(at + 24) - 1, at + 24);
    });

    expectImportError(() => readCanvasPackage(lying), { code: 'NOT_A_ZIP', message: MESSAGES.damaged });
  });
});

describe('readCanvasPackage: limits', () => {
  test('defaults', () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxEntries: 5000,
      maxTotalUncompressed: 200 * 1024 * 1024,
      maxXmlBytes: 20 * 1024 * 1024,
      maxFileBytes: 25 * 1024 * 1024,
    });
  });

  test('refuses more entries than maxEntries, counting every entry', async () => {
    // manifest + quiz + meta + image = 4 entries.
    const zip = await exportZip({ files: { 'assessment_questions/dye.png': png('dye') } });

    expect(readCanvasPackage(zip, { limits: { maxEntries: 4 } }).quizzes).toHaveLength(1);
    expectImportError(() => readCanvasPackage(zip, { limits: { maxEntries: 3 } }), {
      code: 'TOO_LARGE',
      status: 413,
      message: 'This zip holds more than 3 files, which is too many to import.',
    });
  });

  test('refuses a declared unpacked size over maxTotalUncompressed before unpacking', async () => {
    // Zeros compress to almost nothing; the declared size is what counts.
    const zip = await exportZip({ files: { 'web_resources/big.bin': Buffer.alloc(3 * 1024 * 1024) } });

    expect(readCanvasPackage(zip, { limits: { maxTotalUncompressed: 4 * 1024 * 1024 } }).quizzes).toHaveLength(1);
    expectImportError(() => readCanvasPackage(zip, { limits: { maxTotalUncompressed: 3 * 1024 * 1024 } }), {
      code: 'TOO_LARGE',
      status: 413,
      message: 'This zip unpacks to more than 3 MB, which is too large to import.',
    });
    expectImportError(() => readCanvasPackage(zip, { limits: { maxTotalUncompressed: 8000 } }), {
      code: 'TOO_LARGE',
      status: 413,
      message: 'This zip unpacks to more than 8 KB, which is too large to import.',
    });
  });

  // Three quizzes that all point at one padded assessment_meta.xml: by a
  // manifest dependency, or by sitting in one folder with no dependency.
  const SHARED_META = `${metaXml('gshared', 'Shared settings')}<!--${' '.repeat(6000)}-->`;
  const SHARED_IDENTS = ['gquiz1', 'gquiz2', 'gquiz3'];
  const sharedMetaEntries = {
    dependency: () => ({
      'imsmanifest.xml': buildManifest({
        quizzes: SHARED_IDENTS.map((ident) => ({ ident, metaHref: 'shared/assessment_meta.xml' })),
      }),
      ...Object.fromEntries(SHARED_IDENTS.map((ident) => [`${ident}/${ident}.xml`, quizXml(ident)])),
      'shared/assessment_meta.xml': SHARED_META,
    }),
    folder: () => ({
      'imsmanifest.xml': buildManifest({
        quizzes: SHARED_IDENTS.map((ident) => ({ ident, href: `bank/${ident}.xml`, metaHref: null })),
      }),
      ...Object.fromEntries(SHARED_IDENTS.map((ident) => [`bank/${ident}.xml`, quizXml(ident)])),
      'bank/assessment_meta.xml': SHARED_META,
    }),
  };

  test.each(Object.keys(sharedMetaEntries))(
    'counts a meta file shared by several quizzes (%s) once per quiz against maxTotalUncompressed',
    async (variant) => {
      const entries = sharedMetaEntries[variant]();
      const zip = await buildExportZip({ entries });
      // Every entry declared once fits in 16 KB; the meta handed to three
      // quizzes (3 x 6 KB) does not.
      const declared = Object.values(entries).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
      expect(declared).toBeLessThan(16 * 1024);

      expect(readCanvasPackage(zip).quizzes.map((quiz) => [quiz.ident, quiz.metaXml])).toEqual(
        SHARED_IDENTS.map((ident) => [ident, SHARED_META]),
      );
      expectImportError(() => readCanvasPackage(zip, { limits: { maxTotalUncompressed: 16 * 1024 } }), {
        code: 'TOO_LARGE',
        status: 413,
        message: 'This zip unpacks to more than 16 KB, which is too large to import.',
      });
    },
  );

  test('unpacks a meta file shared by several quizzes only once', async () => {
    const zip = await buildExportZip({ entries: sharedMetaEntries.dependency() });
    const inflate = jest.spyOn(zlib, 'inflateRawSync');
    try {
      readCanvasPackage(zip);
      // The manifest, three quiz files and the one meta file.
      expect(inflate).toHaveBeenCalledTimes(5);
    } finally {
      inflate.mockRestore();
    }
  });

  test('refuses a quiz XML file over maxXmlBytes', async () => {
    const zip = await exportZip({
      manifest: buildManifest({ quizzes: ONE_QUIZ }),
      extra: { 'gquiz1/gquiz1.xml': `${quizXml('gquiz1')}<!--${' '.repeat(6000)}-->` },
    });

    expectImportError(() => readCanvasPackage(zip, { limits: { maxXmlBytes: 5000 } }), {
      code: 'TOO_LARGE',
      status: 413,
      message: 'An XML file in this zip is larger than 5 KB, which is too large to import.',
    });
  });

  test('does not hand out a bundled file over maxFileBytes', async () => {
    const zip = await exportZip({
      files: { 'assessment_questions/big.png': png('a large figure'), 'assessment_questions/small.png': png('s') },
    });

    const pkg = readCanvasPackage(zip, { limits: { maxFileBytes: 10 } });

    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/assessment_questions/big.png')).toBeNull();
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/assessment_questions/small.png').data).toEqual(png('s'));
  });
});

describe('readCanvasPackage: manifest and quiz discovery', () => {
  test('finds quizzes through the manifest, in manifest order, each with its meta file', async () => {
    const zip = await exportZip({
      quizzes: [
        { ident: 'gquiz2', title: 'Week 2 check' },
        { ident: 'gquiz1', title: 'Week 1 check' },
      ],
    });

    const pkg = readCanvasPackage(zip);

    expect(pkg.manifestTitle).toBe('QTI Quiz Export for course "Synthetic Chemistry 100"');
    expect(pkg.quizzes).toEqual([
      { ident: 'gquiz2', xmlPath: 'gquiz2/gquiz2.xml', xml: quizXml('gquiz2'), metaXml: metaXml('gquiz2', 'Week 2 check') },
      { ident: 'gquiz1', xmlPath: 'gquiz1/gquiz1.xml', xml: quizXml('gquiz1'), metaXml: metaXml('gquiz1', 'Week 1 check') },
    ]);
  });

  test('follows the manifest dependency to the meta file wherever it is stored', async () => {
    const quizzes = [{ ident: 'gquiz1', metaHref: 'settings/gquiz1 settings/assessment_meta.xml' }];
    const zip = await buildExportZip({
      entries: {
        'imsmanifest.xml': buildManifest({ quizzes }),
        'gquiz1/gquiz1.xml': quizXml('gquiz1'),
        'settings/gquiz1 settings/assessment_meta.xml': metaXml('gquiz1', 'Stored elsewhere'),
      },
    });

    expect(readCanvasPackage(zip).quizzes[0].metaXml).toBe(metaXml('gquiz1', 'Stored elsewhere'));
  });

  test('uses the meta file beside the quiz when the manifest names none, and null when there is none', async () => {
    const quizzes = [
      { ident: 'gquiz1', metaHref: null },
      { ident: 'gquiz2', metaHref: null },
    ];
    const zip = await buildExportZip({
      entries: {
        'imsmanifest.xml': buildManifest({ quizzes }),
        ...quizFiles('gquiz1', 'Beside the quiz'),
        'gquiz2/gquiz2.xml': quizXml('gquiz2'),
      },
    });

    expect(readCanvasPackage(zip).quizzes.map((quiz) => quiz.metaXml)).toEqual([metaXml('gquiz1', 'Beside the quiz'), null]);
  });

  test('takes the title from the manifest metadata, whitespace collapsed', async () => {
    const zip = await exportZip({ manifest: buildManifest({ title: '  QTI Quiz Export for\n   course "Lab"  ', quizzes: ONE_QUIZ }) });
    expect(readCanvasPackage(zip).manifestTitle).toBe('QTI Quiz Export for course "Lab"');
  });

  test('tolerates namespace prefixes other than Canvas\'s and a manifest without metadata', async () => {
    const prefixed =
      '<?xml version="1.0"?>\n<cp:manifest xmlns:cp="urn:cp" xmlns:lomimscc="urn:lom"><cp:metadata><lomimscc:lom><lomimscc:general>' +
      '<lomimscc:title><lomimscc:string language="en">Prefixed export</lomimscc:string></lomimscc:title>' +
      '</lomimscc:general></lomimscc:lom></cp:metadata><cp:resources>' +
      '<cp:resource identifier="gquiz1" type="imsqti_xmlv1p2"><cp:file href="gquiz1/gquiz1.xml"/></cp:resource>' +
      '</cp:resources></cp:manifest>';
    const bare =
      '<manifest><resources><resource identifier="gquiz1" type="imsqti_xmlv1p2" href="gquiz1/gquiz1.xml"/></resources></manifest>';

    const prefixedPkg = readCanvasPackage(await exportZip({ manifest: prefixed }));
    const barePkg = readCanvasPackage(await exportZip({ manifest: bare }));

    expect([prefixedPkg.manifestTitle, prefixedPkg.quizzes.map((quiz) => quiz.xmlPath)]).toEqual([
      'Prefixed export',
      ['gquiz1/gquiz1.xml'],
    ]);
    expect([barePkg.manifestTitle, barePkg.quizzes.map((quiz) => quiz.xmlPath)]).toEqual(['', ['gquiz1/gquiz1.xml']]);
  });

  test('does not expand entities declared in a DTD', async () => {
    const manifest = buildManifest({ title: 'TITLE', quizzes: ONE_QUIZ })
      .replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE manifest [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]>')
      .replace('TITLE', 'Export &b;');

    expect(readCanvasPackage(await exportZip({ manifest })).manifestTitle).toBe('Export &b;');
  });

  test('strips a UTF-8 byte-order mark from XML files', async () => {
    const zip = await exportZip({
      manifest: `\uFEFF${buildManifest({ quizzes: ONE_QUIZ })}`,
      extra: { 'gquiz1/gquiz1.xml': `\uFEFF${quizXml('gquiz1')}` },
    });

    expect(readCanvasPackage(zip).quizzes[0].xml).toBe(quizXml('gquiz1'));
  });

  test('reports a quiz the manifest lists but the zip lacks', async () => {
    const zip = await buildExportZip({
      entries: { 'imsmanifest.xml': buildManifest({ quizzes: ONE_QUIZ }), 'gquiz1/assessment_meta.xml': metaXml('gquiz1', 'x') },
    });

    expectImportError(() => readCanvasPackage(zip), { code: 'BAD_XML', message: MESSAGES.missingQuiz });
  });

  test('falls back to <dir>/<dir>.xml quiz files when the manifest lists no quizzes', async () => {
    const zip = await buildExportZip({
      entries: {
        'imsmanifest.xml': buildManifest({ quizzes: [], files: ['notes/notes.xml'] }),
        ...quizFiles('gquiz9', 'Found without the manifest'),
        'gquiz8/gquiz8.xml': quizXml('gquiz8'),
        'notes/notes.xml': '<notes>Not a quiz</notes>',
        'gquiz7/other.xml': quizXml('gquiz7'),
      },
    });

    expect(readCanvasPackage(zip).quizzes).toEqual([
      { ident: 'gquiz9', xmlPath: 'gquiz9/gquiz9.xml', xml: quizXml('gquiz9'), metaXml: metaXml('gquiz9', 'Found without the manifest') },
      { ident: 'gquiz8', xmlPath: 'gquiz8/gquiz8.xml', xml: quizXml('gquiz8'), metaXml: null },
    ]);
  });

  test('says so when there are no quizzes at all', async () => {
    const zip = await buildExportZip({
      entries: { 'imsmanifest.xml': buildManifest({ quizzes: [] }), 'notes/notes.xml': '<notes/>' },
    });

    expectImportError(() => readCanvasPackage(zip), { code: 'NO_QUIZZES', message: MESSAGES.noQuizzes });
  });

  test('rejects a zip without imsmanifest.xml', async () => {
    const zip = await buildExportZip({ entries: quizFiles('gquiz1', 'No manifest') });
    expectImportError(() => readCanvasPackage(zip), { code: 'NO_MANIFEST', message: MESSAGES.noManifest });
  });

  test('does not guess between two wrapped manifests', async () => {
    const manifest = buildManifest({ quizzes: ONE_QUIZ });
    const zip = await buildExportZip({
      entries: { 'first/imsmanifest.xml': manifest, 'second/imsmanifest.xml': manifest, ...quizFiles('gquiz1', 'x') },
    });

    expectImportError(() => readCanvasPackage(zip), { code: 'NO_MANIFEST', message: MESSAGES.noManifest });
  });

  test('recognises a full course export', async () => {
    const zip = await exportZip({ extra: { 'course_settings/course_settings.xml': '<course/>' } });
    expectImportError(() => readCanvasPackage(zip), { code: 'COURSE_EXPORT', message: MESSAGES.courseExport });
  });

  test('recognises a course export from an empty course_settings folder, inside a wrapping folder', async () => {
    const zip = await exportZip({ extra: { 'course_settings/': '' }, topFolder: 'course' });
    expectImportError(() => readCanvasPackage(zip), { code: 'COURSE_EXPORT', message: MESSAGES.courseExport });
  });

  test('an empty non_cc_assessments folder, as in real quiz exports, is fine', async () => {
    const zip = await exportZip({ extra: { 'non_cc_assessments/': '' } });
    expect(readCanvasPackage(zip).quizzes.map((quiz) => quiz.ident)).toEqual(['gquiz1']);
  });
});

describe('readCanvasPackage: resolveFile', () => {
  // A path Canvas cut to 175 characters: the QTI still names the full file.
  const LONG_DIR = `web_resources/Canvas_Quizzes/Quiz Files/synthetic-chem-100-quiz-export_00001/quiz files/${'a'.repeat(32)}`;
  const LONG_NAME = 'b'.repeat(32);
  const TRUNCATED = `${`${LONG_DIR}/${LONG_NAME}`.slice(0, 172)}...`;
  const LONG_SRC = `$IMS-CC-FILEBASE$/Canvas_Quizzes/Quiz%20Files/synthetic-chem-100-quiz-export_00001/quiz%20files/${'a'.repeat(32)}/${LONG_NAME}`;
  const MEDIA = 'Uploaded Media/7d0c1e2a-0000-4000-8000-000000000001';

  let pkg;
  beforeAll(async () => {
    pkg = readCanvasPackage(
      await exportZip({
        quizzes: [
          { ident: 'gquiz1', title: 'Week 1 check' },
          { ident: 'gquiz2', title: 'Week 2 check' },
        ],
        files: {
          'assessment_questions/dye.png': png('dye'),
          'web_resources/Quiz Files/plot 1.png': png('plot'),
          [MEDIA]: png('media'),
          'both.png': png('root'),
          'web_resources/both.png': png('web'),
          'gquiz1/figures/local.png': png('local 1'),
          'gquiz2/figures/local.png': png('local 2'),
          'shared/figure.png': png('figure'),
          'set-a/label.png': png('label a'),
          'set-b/label.png': png('label b'),
          [TRUNCATED]: png('truncated'),
          'web_resources/cut/abc...': png('cut short'),
          'web_resources/cut/abcd...': png('cut longer'),
          'assessment_questions/100%.png': png('percent'),
          'web_resources/literal%20name.png': png('literal'),
        },
      }),
    );
  });

  test.each([
    ['the token and a query string', '$IMS-CC-FILEBASE$/assessment_questions/dye.png?canvas_download=1', 'assessment_questions/dye.png'],
    ['a percent-encoded token', '%24IMS-CC-FILEBASE%24/assessment_questions/dye.png', 'assessment_questions/dye.png'],
    ['a fragment', '$IMS-CC-FILEBASE$/assessment_questions/dye.png#zoom', 'assessment_questions/dye.png'],
    ['"./" segments', '$IMS-CC-FILEBASE$/./assessment_questions/./dye.png', 'assessment_questions/dye.png'],
    ['%20 under web_resources/', '$IMS-CC-FILEBASE$/Quiz%20Files/plot%201.png', 'web_resources/Quiz Files/plot 1.png'],
    ['a raw space at the package root', `$IMS-CC-FILEBASE$/${MEDIA}`, MEDIA],
    ['an encoded space at the package root', '$IMS-CC-FILEBASE$/Uploaded%20Media/7d0c1e2a-0000-4000-8000-000000000001', MEDIA],
    ['the root before web_resources/', '$IMS-CC-FILEBASE$/both.png', 'both.png'],
    ['a relative path that is unique as a suffix', 'figure.png', 'shared/figure.png'],
    ['a name Canvas truncated to "..."', LONG_SRC, TRUNCATED],
    ['malformed percent-encoding, used raw', '$IMS-CC-FILEBASE$/assessment_questions/100%.png', 'assessment_questions/100%.png'],
    ['a name that really contains "%20"', '$IMS-CC-FILEBASE$/literal%20name.png', 'web_resources/literal%20name.png'],
  ])('resolves %s', (_label, src, path) => {
    expect(pkg.resolveFile(src)?.path).toBe(path);
  });

  test('returns the file bytes with the path', () => {
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/Quiz%20Files/plot%201.png')).toEqual({
      path: 'web_resources/Quiz Files/plot 1.png',
      data: png('plot'),
    });
    expect(pkg.resolveFile(LONG_SRC).data).toEqual(png('truncated'));
  });

  test('resolves relative to the quiz file given as fromPath, including "../"', () => {
    expect(pkg.resolveFile('figures/local.png', { fromPath: 'gquiz1/gquiz1.xml' }).data).toEqual(png('local 1'));
    expect(pkg.resolveFile('figures/local.png', { fromPath: 'gquiz2/gquiz2.xml' }).data).toEqual(png('local 2'));
    expect(pkg.resolveFile('../gquiz2/figures/local.png', { fromPath: 'gquiz1/gquiz1.xml' }).data).toEqual(png('local 2'));
  });

  test('does not guess between two files sharing a suffix', () => {
    // Without fromPath, figures/local.png matches gquiz1/ and gquiz2/.
    expect(pkg.resolveFile('figures/local.png')).toBeNull();
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/label.png')).toBeNull();
  });

  test('does not guess between two truncated names that both fit', () => {
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/cut/abcdef.png')).toBeNull();
    // Only the shorter prefix fits this one.
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/cut/abxyz.png')).toBeNull();
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/cut/abc-only.png').data).toEqual(png('cut short'));
  });

  test.each([
    ['a remote Canvas file', 'https://canvas.example.test/assessment_questions/1/files/2/download?verifier=abc&file=dye.png'],
    ['a remote URL ending in a bundled path', 'https://canvas.example.test/assessment_questions/dye.png'],
    ['plain http', 'http://canvas.example.test/both.png'],
    ['a protocol-relative URL', '//canvas.example.test/both.png'],
    ['an absolute path', '/assessment_questions/dye.png'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['another scheme', 'javascript:alert(1)'],
    ['a missing file', '$IMS-CC-FILEBASE$/assessment_questions/missing.png'],
    ['a path above the package root', '$IMS-CC-FILEBASE$/../both.png'],
    ['an empty src', ''],
    ['only the token and a query', '$IMS-CC-FILEBASE$/?canvas_download=1'],
  ])('returns null for %s', (_label, src) => {
    expect(pkg.resolveFile(src)).toBeNull();
  });

  test.each([[undefined], [null], [42], [{ src: 'both.png' }]])('returns null for a non-string src (%p)', (src) => {
    expect(pkg.resolveFile(src)).toBeNull();
  });

  test('tolerates missing or odd options', () => {
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/both.png', null)?.path).toBe('both.png');
    expect(pkg.resolveFile('$IMS-CC-FILEBASE$/both.png', { fromPath: 42 })?.path).toBe('both.png');
  });

  test('two different files cut to the same name are not offered', async () => {
    const zip = await buildExportZip({
      entries: [
        ['imsmanifest.xml', buildManifest({ quizzes: ONE_QUIZ })],
        ...Object.entries(quizFiles('gquiz1', 'x')),
        ['web_resources/cut/abc...', png('one')],
        ['web_resources/cut/abc...', png('two')],
      ],
    });

    expect(readCanvasPackage(zip).resolveFile('$IMS-CC-FILEBASE$/cut/abcdef.png')).toBeNull();
  });

  test('returns null, without throwing, for a file that unpacks past its declared size', async () => {
    const zip = await exportZip({ files: { 'assessment_questions/dye.png': png('dye'.repeat(50)) } });
    const lying = patchCentralRecord(zip, 'assessment_questions/dye.png', (buf, at) => buf.writeUInt32LE(20, at + 24));

    expect(readCanvasPackage(lying).resolveFile('$IMS-CC-FILEBASE$/assessment_questions/dye.png')).toBeNull();
  });

  test('returns null for a file that unpacks short of its declared size', async () => {
    const zip = await exportZip({ files: { 'assessment_questions/dye.png': png('dye') } });
    const lying = patchCentralRecord(zip, 'assessment_questions/dye.png', (buf, at) => {
      buf.writeUInt32LE(buf.readUInt32LE(at + 24) + 1, at + 24);
    });

    expect(readCanvasPackage(lying).resolveFile('$IMS-CC-FILEBASE$/assessment_questions/dye.png')).toBeNull();
  });
});
