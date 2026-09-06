import {
  assertSafeOriginalFilename,
  detectDocumentContent,
  requireDeclaredMimeAgreement,
  STORAGE_MAX_BYTES,
} from './content-validation';
import { STORAGE_ERROR_CODES } from './storage.errors';

function expectCode(error: unknown, code: string): void {
  expect((error as { code: string }).code).toBe(code);
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_MIN = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff,
  0xd9,
]);
const PDF_MIN = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

describe('content-validation', () => {
  it('accepts PDF JPEG PNG by magic bytes', () => {
    expect(detectDocumentContent(PDF_MIN).contentType).toBe('application/pdf');
    expect(detectDocumentContent(JPEG_MIN).contentType).toBe('image/jpeg');
    expect(detectDocumentContent(PNG_1X1).contentType).toBe('image/png');
  });

  it('rejects empty and oversized bodies', () => {
    try {
      detectDocumentContent(Buffer.alloc(0));
      throw new Error('expected empty');
    } catch (error) {
      expectCode(error, STORAGE_ERROR_CODES.STORAGE_EMPTY_FILE);
    }
    try {
      detectDocumentContent(Buffer.alloc(STORAGE_MAX_BYTES + 1, 0xff));
      throw new Error('expected oversized');
    } catch (error) {
      expectCode(error, STORAGE_ERROR_CODES.STORAGE_FILE_TOO_LARGE);
    }
  });

  it('rejects SVG HTML executable archive unknown binary', () => {
    const samples = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      Buffer.from('<!DOCTYPE html><html></html>'),
      Buffer.from('MZ\x90\x00executable'),
      Buffer.from('PK\x03\x04zip-archive'),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    ];
    for (const body of samples) {
      try {
        detectDocumentContent(body);
        throw new Error(
          `expected reject for ${body.subarray(0, 8).toString('hex')}`,
        );
      } catch (error) {
        expectCode(error, STORAGE_ERROR_CODES.STORAGE_INVALID_SIGNATURE);
      }
    }
  });

  it('rejects PDF polyglot with embedded HTML/script markers', () => {
    const polyglot = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from('<html><script>alert(1)</script></html>\n'),
      Buffer.from('%%EOF\n'),
    ]);
    try {
      detectDocumentContent(polyglot);
      throw new Error('expected polyglot reject');
    } catch (error) {
      expectCode(error, STORAGE_ERROR_CODES.STORAGE_INVALID_SIGNATURE);
    }
  });

  it('rejects declared MIME mismatch and disallowed declared MIME', () => {
    try {
      requireDeclaredMimeAgreement('image/png', 'application/pdf');
      throw new Error('expected mismatch');
    } catch (error) {
      expectCode(error, STORAGE_ERROR_CODES.STORAGE_UNSUPPORTED_TYPE);
    }
    try {
      requireDeclaredMimeAgreement('image/png', 'image/svg+xml');
      throw new Error('expected svg mime');
    } catch (error) {
      expectCode(error, STORAGE_ERROR_CODES.STORAGE_UNSUPPORTED_TYPE);
    }
    requireDeclaredMimeAgreement('image/jpeg', 'image/jpg');
    requireDeclaredMimeAgreement('application/pdf', undefined);
  });

  it('rejects unsafe original filenames', () => {
    const unsafe = [
      '../etc/passwd',
      '/etc/passwd',
      'C:\\Windows\\system32',
      'a'.repeat(300),
      'name\0.pdf',
    ];
    for (const name of unsafe) {
      try {
        assertSafeOriginalFilename(name);
        throw new Error(`expected unsafe ${name}`);
      } catch (error) {
        expectCode(error, STORAGE_ERROR_CODES.STORAGE_UNSUPPORTED_TYPE);
      }
    }
    assertSafeOriginalFilename('licence.pdf');
    assertSafeOriginalFilename(undefined);
  });
});
