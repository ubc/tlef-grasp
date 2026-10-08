const {
  ALLOWED_IMAGE_MIME_TYPES,
  sniffImageType,
  extensionForImageMime,
} = require('../../src/utils/image-sniff');

// Real magic bytes padded past the 12-byte sniff window; the rest is filler.
const pad = (head) => Buffer.concat([head, Buffer.alloc(16)]);
const PNG = pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const JPEG = pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
const GIF = pad(Buffer.from('GIF89a'));
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);

describe('sniffImageType', () => {
  test.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['GIF', GIF, 'image/gif'],
    ['WebP', WEBP, 'image/webp'],
  ])('recognises %s by its magic bytes', (_label, buffer, expected) => {
    expect(sniffImageType(buffer)).toBe(expected);
  });

  test('rejects an HTML page, which is what an expired Canvas link returns', () => {
    expect(sniffImageType(Buffer.from('<!DOCTYPE html><html><body>Log in</body></html>'))).toBeNull();
  });

  test('rejects SVG, which can carry scripts', () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });

  test('rejects a RIFF container that is not WebP', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(8)]);
    expect(sniffImageType(wav)).toBeNull();
  });

  test('needs at least 12 bytes', () => {
    expect(sniffImageType(PNG.subarray(0, 11))).toBeNull();
    expect(sniffImageType(PNG.subarray(0, 12))).toBe('image/png');
  });

  test.each([[null], [undefined], [Buffer.alloc(0)]])('returns null for %p', (input) => {
    expect(sniffImageType(input)).toBeNull();
  });
});

describe('extensionForImageMime', () => {
  test.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
  ])('%s -> %s', (mimeType, extension) => {
    expect(extensionForImageMime(mimeType)).toBe(extension);
  });

  test.each([['image/svg+xml'], ['image/bmp'], ['text/html'], ['constructor'], [''], [undefined], [null]])(
    'returns null for %p',
    (mimeType) => {
      expect(extensionForImageMime(mimeType)).toBeNull();
    },
  );
});

describe('ALLOWED_IMAGE_MIME_TYPES', () => {
  test('lists exactly the types sniffImageType can return, each with an extension', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    expect(ALLOWED_IMAGE_MIME_TYPES.map(extensionForImageMime)).toEqual(['png', 'jpg', 'gif', 'webp']);
  });

  test('cannot be changed by an importer', () => {
    expect(Object.isFrozen(ALLOWED_IMAGE_MIME_TYPES)).toBe(true);
  });
});
