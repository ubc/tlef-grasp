/**
 * Reads a Canvas "QTI Quiz Export" zip (Course > Settings > Export Course
 * Content > Quiz): finds the quizzes through imsmanifest.xml and resolves the
 * files their HTML points at. Pure: no network, no disk, no database.
 *
 * Why a small zip reader of our own instead of fflate.unzipSync: Canvas writes
 * every entry's sizes into a zip64 extra field (both 32-bit size fields read
 * 0xFFFFFFFF) but no zip64 end record. fflate 0.8 only reads that extra field
 * when the end record exists, so on real exports it reports every file as 4 GB
 * and allocates a 4 GB buffer per entry. Here the central directory is parsed
 * directly and entries are inflated on demand with node:zlib, whose
 * maxOutputLength stops a lying entry (zip bomb) at its declared size.
 */

const zlib = require('node:zlib');
const cheerio = require('cheerio');

/** A user-safe import failure. `message` is shown in the UI as is. */
class CanvasImportError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'CanvasImportError';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 5000,
  maxTotalUncompressed: 200 * 1024 * 1024,
  maxXmlBytes: 20 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
});

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_END = 0x06064b50;
const MAX_UINT32 = 0xffffffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8_NAMES = 0x800;

const QTI_RESOURCE_TYPE = 'imsqti_xmlv1p2';
// `$IMS-CC-FILEBASE$` is the package root for some files and web_resources/
// for others (both occur in real exports); some tools percent-encode the `$`.
const FILEBASE_TOKEN = /^(?:\$|%24)IMS[-_]CC[-_]FILEBASE(?:\$|%24)/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Canvas cuts zip entry paths longer than 175 characters and ends them in
// "..." while the QTI keeps the full name (66 of 69 images in a real export).
const TRUNCATION_MARK = '...';

const MESSAGES = {
  notAZip: "That file isn't a zip archive. Upload the .zip that Canvas gave you.",
  damaged: "This zip is damaged, so it can't be read. Download the export from Canvas again.",
  noManifest: "This zip has no imsmanifest.xml, so it isn't a Canvas quiz export.",
  courseExport:
    'This is a full Canvas course export. In Canvas, use Settings > Export Course Content > Quiz instead, and upload that .zip.',
  noQuizzes: "This Canvas export doesn't contain any quizzes.",
  missingQuiz: 'This export is incomplete: a quiz listed in imsmanifest.xml is missing from the zip.',
};

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

function notAZip() {
  return new CanvasImportError(MESSAGES.notAZip, 'NOT_A_ZIP');
}

function damaged() {
  return new CanvasImportError(MESSAGES.damaged, 'NOT_A_ZIP');
}

function tooLarge(message) {
  return new CanvasImportError(message, 'TOO_LARGE', 413);
}

function describeBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function unpacksTooLarge(limits) {
  return tooLarge(`This zip unpacks to more than ${describeBytes(limits.maxTotalUncompressed)}, which is too large to import.`);
}

function toSafeNumber(big) {
  return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : null;
}

// ---------------------------------------------------------------------------
// Zip container
// ---------------------------------------------------------------------------

function findEndRecord(zip) {
  // The end record is 22 bytes plus a comment of at most 65535 bytes.
  const last = zip.length - 22;
  const first = Math.max(0, last - 0xffff);
  for (let e = last; e >= first; e--) {
    if (zip.readUInt32LE(e) === SIG_END) return e;
  }
  return -1;
}

// Values from a zip64 extended-information field (id 1). Only the header
// fields that held 0xFFFFFFFF are present, always in this order.
function readZip64Extra(extra, needs) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const len = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      const field = extra.subarray(at + 4, at + 4 + len);
      const out = {};
      let pos = 0;
      for (const key of ['size', 'compressedSize', 'localHeaderOffset']) {
        if (!needs[key]) continue;
        if (pos + 8 > field.length) return null;
        out[key] = toSafeNumber(field.readBigUInt64LE(pos));
        if (out[key] === null) return null;
        pos += 8;
      }
      return out;
    }
    at += 4 + len;
  }
  return null;
}

function decodeName(bytes, flags) {
  if (flags & FLAG_UTF8_NAMES) return bytes.toString('utf8');
  // Many tools write UTF-8 names without setting the flag; fall back to
  // latin1 only when the bytes are not valid UTF-8.
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

// Every central-directory record, with the entry-count and declared-size
// limits enforced before anything is inflated.
function readCentralDirectory(zip, limits) {
  if (zip.length < 22) throw notAZip();
  const end = findEndRecord(zip);
  if (end < 0) throw notAZip();

  let count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const locator = end - 20;
  if (locator >= 0 && zip.readUInt32LE(locator) === SIG_ZIP64_LOCATOR) {
    const zip64End = toSafeNumber(zip.readBigUInt64LE(locator + 8));
    if (zip64End !== null && zip64End + 56 <= zip.length && zip.readUInt32LE(zip64End) === SIG_ZIP64_END) {
      count = toSafeNumber(zip.readBigUInt64LE(zip64End + 32));
      offset = toSafeNumber(zip.readBigUInt64LE(zip64End + 48));
      if (count === null || offset === null) throw notAZip();
    }
  }
  if (count > limits.maxEntries) {
    throw tooLarge(`This zip holds more than ${limits.maxEntries} files, which is too many to import.`);
  }

  const records = [];
  let totalSize = 0;
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== SIG_CENTRAL) throw notAZip();
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    let compressedSize = zip.readUInt32LE(at + 20);
    let size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    let localHeaderOffset = zip.readUInt32LE(at + 42);
    const nameStart = at + 46;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > zip.length) throw notAZip();

    const needs = {
      size: size === MAX_UINT32,
      compressedSize: compressedSize === MAX_UINT32,
      localHeaderOffset: localHeaderOffset === MAX_UINT32,
    };
    if (needs.size || needs.compressedSize || needs.localHeaderOffset) {
      const zip64 = readZip64Extra(zip.subarray(extraStart, extraStart + extraLength), needs);
      if (!zip64) throw notAZip();
      size = zip64.size ?? size;
      compressedSize = zip64.compressedSize ?? compressedSize;
      localHeaderOffset = zip64.localHeaderOffset ?? localHeaderOffset;
    }

    totalSize += size;
    if (totalSize > limits.maxTotalUncompressed) throw unpacksTooLarge(limits);
    records.push({
      name: decodeName(zip.subarray(nameStart, extraStart), flags),
      flags,
      method,
      compressedSize,
      size,
      localHeaderOffset,
    });
    at = next;
  }
  return records;
}

// The entry's bytes. Throws on anything unreadable; callers decide whether
// that is fatal (quiz XML) or just a missing file (an image).
function inflateEntry(zip, record) {
  if (record.flags & FLAG_ENCRYPTED) throw new Error('encrypted entry');
  const header = record.localHeaderOffset;
  if (header + 30 > zip.length || zip.readUInt32LE(header) !== SIG_LOCAL) {
    throw new Error('bad local header');
  }
  const start = header + 30 + zip.readUInt16LE(header + 26) + zip.readUInt16LE(header + 28);
  const end = start + record.compressedSize;
  if (end > zip.length) throw new Error('truncated entry');
  const raw = zip.subarray(start, end);

  let data;
  if (record.method === 0) {
    data = Buffer.from(raw);
  } else if (record.method === 8) {
    data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(record.size, 1) });
  } else {
    throw new Error('unsupported compression method');
  }
  if (data.length !== record.size) throw new Error('size mismatch');
  return data;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// Collapse "." and empty segments and resolve "..". Null when the path is
// empty or climbs above the package root.
function normalizePath(path) {
  const out = [];
  for (const segment of String(path).replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (!out.length) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.length ? out.join('/') : null;
}

function isUnsafeEntryName(name) {
  const slashed = name.replace(/\\/g, '/');
  return slashed.startsWith('/') || /^[a-z]:/i.test(slashed) || slashed.split('/').includes('..');
}

// Finder adds __MACOSX/ resource forks and "._name" AppleDouble files when
// someone re-zips an unpacked export.
function isMacMetadata(path) {
  const segments = path.split('/');
  return segments.includes('__MACOSX') || segments[segments.length - 1].startsWith('._');
}

function dirnameOf(path) {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Map of package path -> central-directory record (files only), plus the
// directory paths, after dropping unsafe names and Mac metadata and after
// stripping a single wrapping folder.
function indexEntries(records) {
  let files = new Map();
  let directories = [];
  let duplicates = new Set();
  for (const record of records) {
    if (isUnsafeEntryName(record.name)) continue;
    const isDirectory = /[/\\]$/.test(record.name);
    const path = normalizePath(record.name);
    if (!path || isMacMetadata(path)) continue;
    if (isDirectory) directories.push(path);
    // A path stored twice keeps its first entry.
    else if (files.has(path)) duplicates.add(path);
    else files.set(path, record);
  }

  if (!files.has('imsmanifest.xml')) {
    const nested = [...files.keys()].filter((path) => /^[^/]+\/imsmanifest\.xml$/.test(path));
    if (nested.length === 1) {
      const prefix = nested[0].slice(0, -'imsmanifest.xml'.length);
      const strip = (paths) => paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
      files = new Map(strip([...files.keys()]).map((path) => [path, files.get(prefix + path)]));
      directories = strip(directories);
      duplicates = new Set(strip([...duplicates]));
    }
  }
  return { files, directories, duplicates };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

// Tag names carry prefixes (imsmd:title, lomimscc:string) that vary by export.
function localName(el) {
  return String(el.name || '').toLowerCase().replace(/^.*:/, '');
}

function childrenNamed($, $parent, name) {
  return $parent.children().filter((_, el) => localName(el) === name);
}

function descendantsNamed($, $parent, name) {
  return $parent.find('*').filter((_, el) => localName(el) === name);
}

function parseManifest(xml) {
  const $ = cheerio.load(xml, { xml: true });
  const $manifest = childrenNamed($, $.root(), 'manifest').first();
  const $title = descendantsNamed($, childrenNamed($, $manifest, 'metadata').first(), 'title').first();
  const $string = descendantsNamed($, $title, 'string').first();
  const manifestTitle = ($string.length ? $string : $title).text().replace(/\s+/g, ' ').trim();

  const resources = descendantsNamed($, $manifest, 'resource')
    .toArray()
    .map((el) => {
      const $resource = $(el);
      const fileHrefs = childrenNamed($, $resource, 'file')
        .toArray()
        .map((file) => $(file).attr('href'))
        .filter(Boolean);
      return {
        identifier: ($resource.attr('identifier') || '').trim(),
        type: ($resource.attr('type') || '').trim().toLowerCase(),
        href: $resource.attr('href') || fileHrefs[0] || '',
        dependencies: childrenNamed($, $resource, 'dependency')
          .toArray()
          .map((dep) => ($(dep).attr('identifierref') || '').trim())
          .filter(Boolean),
      };
    });
  return { manifestTitle, resources };
}

// ---------------------------------------------------------------------------
// Package
// ---------------------------------------------------------------------------

/**
 * @param {Buffer} buffer the uploaded zip
 * @param {{ limits?: Partial<typeof DEFAULT_LIMITS> }} [options]
 * @returns {{
 *   manifestTitle: string,
 *   quizzes: Array<{ ident: string, xmlPath: string, xml: string, metaXml: string|null }>,
 *   resolveFile: (src: string, opts?: { fromPath?: string }) => ({ path: string, data: Buffer } | null),
 * }}
 * @throws {CanvasImportError}
 */
function readCanvasPackage(buffer, { limits } = {}) {
  const effectiveLimits = { ...DEFAULT_LIMITS, ...(limits || {}) };
  if (!(buffer instanceof Uint8Array)) throw notAZip();
  const zip = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const { files, directories, duplicates } = indexEntries(readCentralDirectory(zip, effectiveLimits));

  if (!files.has('imsmanifest.xml')) {
    throw new CanvasImportError(MESSAGES.noManifest, 'NO_MANIFEST');
  }
  const isCourseExport = [...files.keys(), ...directories].some(
    (path) => path === 'course_settings' || path.startsWith('course_settings/'),
  );
  if (isCourseExport) {
    throw new CanvasImportError(MESSAGES.courseExport, 'COURSE_EXPORT');
  }

  // Every byte of XML handed out counts against maxTotalUncompressed, a repeat
  // read of the same entry included: quizzes that all name one shared
  // assessment_meta.xml (by dependency, or by sitting in one folder) would
  // otherwise pass the declared-size check once and then be parsed once per
  // quiz. Each entry is unpacked once and cached, so a repeat costs no memory.
  // Canvas writes one meta file per quiz, so real exports never repeat a read.
  let xmlBytesHandedOut = 0;
  const xmlCache = new Map();
  const readXml = (path) => {
    const record = files.get(path);
    if (record.size > effectiveLimits.maxXmlBytes) {
      throw tooLarge(
        `An XML file in this zip is larger than ${describeBytes(effectiveLimits.maxXmlBytes)}, which is too large to import.`,
      );
    }
    xmlBytesHandedOut += record.size;
    if (xmlBytesHandedOut > effectiveLimits.maxTotalUncompressed) throw unpacksTooLarge(effectiveLimits);
    if (!xmlCache.has(path)) {
      let data;
      try {
        data = inflateEntry(zip, record);
      } catch {
        throw damaged();
      }
      xmlCache.set(path, data.toString('utf8').replace(/^\uFEFF/, ''));
    }
    return xmlCache.get(path);
  };

  // Manifest hrefs are plain paths, but tolerate a percent-encoded one.
  const findPath = (href) => {
    for (const form of [href, safeDecode(href)]) {
      const path = normalizePath(form);
      if (path && files.has(path)) return path;
    }
    return null;
  };

  const { manifestTitle, resources } = parseManifest(readXml('imsmanifest.xml'));
  const byIdentifier = new Map(resources.map((resource) => [resource.identifier, resource]));

  const quizzes = [];
  const seen = new Set();
  for (const resource of resources) {
    if (resource.type !== QTI_RESOURCE_TYPE) continue;
    const xmlPath = findPath(resource.href);
    if (!xmlPath) throw new CanvasImportError(MESSAGES.missingQuiz, 'BAD_XML');
    if (seen.has(xmlPath)) continue;
    seen.add(xmlPath);

    let metaPath = null;
    for (const dependency of resource.dependencies) {
      const href = byIdentifier.get(dependency)?.href || '';
      if (/(^|\/)assessment_meta\.xml$/i.test(href)) {
        metaPath = findPath(href);
        if (metaPath) break;
      }
    }
    if (!metaPath) metaPath = findPath(`${dirnameOf(xmlPath)}/assessment_meta.xml`);

    quizzes.push({
      ident: resource.identifier || dirnameOf(xmlPath).split('/').pop() || xmlPath,
      xmlPath,
      xml: readXml(xmlPath),
      metaXml: metaPath ? readXml(metaPath) : null,
    });
  }

  // A hand-edited or third-party manifest may list no quizzes; Canvas always
  // writes each one as <ident>/<ident>.xml.
  if (!quizzes.length) {
    for (const path of files.keys()) {
      const match = /^([^/]+)\/\1\.xml$/.exec(path);
      if (!match) continue;
      const xml = readXml(path);
      if (!xml.includes('<questestinterop')) continue;
      const metaPath = `${match[1]}/assessment_meta.xml`;
      quizzes.push({
        ident: match[1],
        xmlPath: path,
        xml,
        metaXml: files.has(metaPath) ? readXml(metaPath) : null,
      });
    }
  }
  if (!quizzes.length) {
    throw new CanvasImportError(MESSAGES.noQuizzes, 'NO_QUIZZES');
  }

  const paths = [...files.keys()];
  // Two different files cut to the same name can't be told apart, so neither
  // is offered as a match.
  const truncatedPaths = paths.filter(
    (path) => path.endsWith(TRUNCATION_MARK) && path.length > TRUNCATION_MARK.length && !duplicates.has(path),
  );
  const fileCache = new Map();

  const readFile = (path) => {
    if (!fileCache.has(path)) {
      const record = files.get(path);
      let data = null;
      if (record.size <= effectiveLimits.maxFileBytes) {
        try {
          data = inflateEntry(zip, record);
        } catch {
          data = null;
        }
      }
      fileCache.set(path, data);
    }
    const data = fileCache.get(path);
    return data ? { path, data } : null;
  };

  const matchPath = (src, fromPath) => {
    let rest = src.trim();
    if (FILEBASE_TOKEN.test(rest)) {
      rest = rest.replace(FILEBASE_TOKEN, '').replace(/^[/\\]+/, '');
    } else if (URL_SCHEME.test(rest) || rest.startsWith('/') || rest.startsWith('\\')) {
      // Remote, data: and absolute URLs are not files in the package.
      return null;
    }
    rest = rest.replace(/[?#][\s\S]*$/, '');

    // Decoded first ("%20" -> space); the raw form covers names that really
    // contain a "%" sequence.
    const forms = [...new Set([safeDecode(rest), rest])];
    const fromDir = typeof fromPath === 'string' ? dirnameOf(fromPath) : null;
    const bases = [];
    const candidates = [];
    for (const form of forms) {
      // Only a path relative to the quiz file may use "../" to leave its folder.
      const base = normalizePath(form);
      if (base) {
        bases.push(base);
        candidates.push(base, `web_resources/${base}`);
      }
      if (fromDir !== null) candidates.push(normalizePath(`${fromDir}/${form}`));
    }
    const exact = candidates.find((candidate) => candidate && files.has(candidate));
    if (exact) return exact;

    for (const base of bases) {
      const suffixed = paths.filter((path) => path.endsWith(`/${base}`));
      if (suffixed.length === 1) return suffixed[0];
    }

    const truncated = truncatedPaths.filter((path) => {
      const prefix = path.slice(0, -TRUNCATION_MARK.length);
      return candidates.some((candidate) => candidate && candidate.startsWith(prefix));
    });
    return truncated.length === 1 ? truncated[0] : null;
  };

  // Never throws: an unresolvable file is the caller's "image unavailable".
  const resolveFile = (src, options) => {
    if (typeof src !== 'string') return null;
    try {
      const path = matchPath(src, options?.fromPath);
      return path ? readFile(path) : null;
    } catch {
      return null;
    }
  };

  return { manifestTitle, quizzes, resolveFile };
}

module.exports = {
  CanvasImportError,
  DEFAULT_LIMITS,
  readCanvasPackage,
};
