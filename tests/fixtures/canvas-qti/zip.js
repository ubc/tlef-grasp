/**
 * Builders for synthetic Canvas "QTI Quiz Export" zips (unit and e2e tests).
 * Side-effect free. The layout mirrors a real export: imsmanifest.xml at the
 * root, each quiz as <ident>/<ident>.xml plus <ident>/assessment_meta.xml,
 * and every bundled file listed as a webcontent resource.
 */

const archiver = require('archiver');
const { PassThrough } = require('stream');

// Fixed so archives are byte-for-byte repeatable.
const ENTRY_DATE = new Date('2026-01-05T12:00:00Z');

// Start of an AppleDouble file, as Finder writes into __MACOSX/.
const APPLE_DOUBLE = Buffer.concat([Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]), Buffer.alloc(24)]);

const MAX_UINT32 = 0xffffffff;

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

/**
 * imsmanifest.xml as Canvas writes it for a quiz export.
 *
 * quizzes: [{ ident, title, href?, metaHref? }]. Canvas puts no quiz title in
 * the manifest (it lives in assessment_meta.xml), so `title` is accepted for
 * symmetry with the other builders and not written. `href` overrides the quiz
 * file path; `metaHref` overrides the meta path, or `null` leaves out the meta
 * resource and the dependency on it.
 * files: package paths of bundled files, written as raw paths like Canvas does
 * (spaces stay spaces).
 */
function buildManifest({ title = 'QTI Quiz Export for course "Synthetic Chemistry 100"', quizzes = [], files = [] } = {}) {
  const resources = [];
  for (const quiz of quizzes) {
    const href = quiz.href || `${quiz.ident}/${quiz.ident}.xml`;
    const metaHref = quiz.metaHref === undefined ? `${quiz.ident}/assessment_meta.xml` : quiz.metaHref;
    const metaId = `${quiz.ident}meta`;
    const dependency = metaHref ? `\n      <dependency identifierref="${escapeAttr(metaId)}"/>` : '';
    resources.push(
      `    <resource identifier="${escapeAttr(quiz.ident)}" type="imsqti_xmlv1p2">\n` +
        `      <file href="${escapeAttr(href)}"/>${dependency}\n` +
        '    </resource>',
    );
    if (metaHref) {
      resources.push(
        `    <resource identifier="${escapeAttr(metaId)}" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${escapeAttr(metaHref)}">\n` +
          `      <file href="${escapeAttr(metaHref)}"/>\n` +
          '    </resource>',
      );
    }
  }
  files.forEach((path, index) => {
    resources.push(
      `    <resource identifier="gfile${index + 1}" type="webcontent" href="${escapeAttr(path)}">\n` +
        `      <file href="${escapeAttr(path)}"/>\n` +
        '    </resource>',
    );
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="gsyntheticmanifest" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource" xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <schema>IMS Content</schema>
    <schemaversion>1.1.3</schemaversion>
    <imsmd:lom>
      <imsmd:general>
        <imsmd:title>
          <imsmd:string>${escapeText(title)}</imsmd:string>
        </imsmd:title>
      </imsmd:general>
      <imsmd:lifeCycle>
        <imsmd:contribute>
          <imsmd:date>
            <imsmd:dateTime>2026-01-05</imsmd:dateTime>
          </imsmd:date>
        </imsmd:contribute>
      </imsmd:lifeCycle>
      <imsmd:rights>
        <imsmd:copyrightAndOtherRestrictions>
          <imsmd:value>yes</imsmd:value>
        </imsmd:copyrightAndOtherRestrictions>
        <imsmd:description>
          <imsmd:string>Private (Copyrighted)</imsmd:string>
        </imsmd:description>
      </imsmd:rights>
    </imsmd:lom>
  </metadata>
  <organizations/>
  <resources>
${resources.join('\n')}
  </resources>
</manifest>
`;
}

function archive(list, placeholderNames) {
  return new Promise((resolve, reject) => {
    const zip = archiver('zip', { zlib: { level: 9 } });
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (chunk) => chunks.push(chunk));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    zip.on('error', reject);
    zip.on('warning', reject);
    zip.pipe(out);
    list.forEach((entry, index) => {
      // archiver strips "../", leading "/" and drive letters from names, so
      // raw names go in as placeholders and are written back afterwards.
      const name = placeholderNames ? `entry-${index}${entry.directory ? '/' : ''}` : entry.name;
      if (entry.directory) zip.append('', { name, type: 'directory', date: ENTRY_DATE });
      else zip.append(entry.data, { name, date: ENTRY_DATE });
    });
    zip.finalize();
  });
}

function zip64SizesField(size, compressedSize) {
  const field = Buffer.alloc(20);
  field.writeUInt16LE(0x0001, 0);
  field.writeUInt16LE(16, 2);
  field.writeBigUInt64LE(BigInt(size), 4);
  field.writeBigUInt64LE(BigInt(compressedSize), 12);
  return field;
}

// Re-emit an archiver zip entry by entry: optionally with verbatim names, and
// optionally the way Canvas writes its exports (both 32-bit size fields set to
// 0xFFFFFFFF, the real sizes in a zip64 extra field, no zip64 end record).
function rewriteZip(zip, { names, zip64Extra }) {
  let end = zip.length - 22;
  while (zip.readUInt32LE(end) !== 0x06054b50) end--;
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const nameLength = zip.readUInt16LE(at + 28);
    const name = names ? Buffer.from(names[i], 'utf8') : zip.subarray(at + 46, at + 46 + nameLength);
    // Bit 3 (data descriptor) is dropped: the sizes go in the headers instead.
    let flags = zip.readUInt16LE(at + 8) & ~0x8;
    if (name.some((byte) => byte >= 0x80)) flags |= 0x800;
    const method = zip.readUInt16LE(at + 10);
    const time = zip.readUInt16LE(at + 12);
    const date = zip.readUInt16LE(at + 14);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const externalAttrs = zip.readUInt32LE(at + 38);
    const sourceHeader = zip.readUInt32LE(at + 42);
    const dataStart = sourceHeader + 30 + zip.readUInt16LE(sourceHeader + 26) + zip.readUInt16LE(sourceHeader + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    const extra = zip64Extra ? zip64SizesField(size, compressedSize) : Buffer.alloc(0);
    const version = zip64Extra ? 45 : 20;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(zip64Extra ? MAX_UINT32 : compressedSize, 18);
    local.writeUInt32LE(zip64Extra ? MAX_UINT32 : size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0300 | version, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(zip64Extra ? MAX_UINT32 : compressedSize, 20);
    central.writeUInt32LE(zip64Extra ? MAX_UINT32 : size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(externalAttrs, 38);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, extra, data);
    centralParts.push(central, name, extra);
    offset += local.length + name.length + extra.length + data.length;
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(count, 8);
  endRecord.writeUInt16LE(count, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

/**
 * A zip Buffer, built in memory.
 *
 * entries: { path: string | Buffer } (insertion order), or [[path, content]]
 *   pairs when a test needs the same path twice.
 * topFolder: wrap every entry in this folder, as re-zipping an unpacked export does.
 * macosx: add the __MACOSX/ "._name" entries Finder writes next to each file.
 * rawNames: write every entry name byte for byte (archiver would otherwise
 *   clean "../x", "/x" and "C:\x").
 * zip64Extra: store sizes the way Canvas's own exports do (see rewriteZip).
 */
async function buildExportZip({ entries = {}, topFolder, macosx = false, rawNames = false, zip64Extra = false } = {}) {
  const pairs = Array.isArray(entries) ? entries : Object.entries(entries);
  const prefix = topFolder ? `${topFolder}/` : '';
  const list = [];
  if (topFolder) list.push({ name: prefix, directory: true });
  for (const [path, content] of pairs) {
    list.push({ name: prefix + path, data: Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8') });
  }
  if (macosx) {
    const files = list.filter((entry) => !entry.directory);
    list.push({ name: '__MACOSX/', directory: true });
    for (const file of files) {
      const cut = file.name.lastIndexOf('/') + 1;
      list.push({ name: `__MACOSX/${file.name.slice(0, cut)}._${file.name.slice(cut)}`, data: APPLE_DOUBLE });
    }
  }

  const zip = await archive(list, rawNames);
  if (!rawNames && !zip64Extra) return zip;
  return rewriteZip(zip, { names: rawNames ? list.map((entry) => entry.name) : null, zip64Extra });
}

module.exports = {
  buildManifest,
  buildExportZip,
};
