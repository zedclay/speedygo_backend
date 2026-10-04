import {
  COVER_PURPOSE,
  assertCoverDimensions,
  detectCoverImage,
  parseCoverLocator,
  toCoverLocator,
} from './cover-media.policy';
import { COVER_NAMESPACE } from './cover-media.policy';
import { STORAGE_ERROR_CODES } from './storage.errors';

function pngWithSize(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([signature, ihdr]);
}

function jpegWithSize(width: number, height: number): Buffer {
  const body = Buffer.alloc(32, 0);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[2] = 0xff;
  body[3] = 0xc0;
  body.writeUInt16BE(17, 4);
  body[6] = 8;
  body.writeUInt16BE(height, 7);
  body.writeUInt16BE(width, 9);
  return body;
}

describe('cover-media.policy', () => {
  it('keeps cover locators and namespace separate from verification objects', () => {
    expect(COVER_PURPOSE).toBe('MERCHANT_BRANCH_COVER');
    expect(COVER_NAMESPACE).toBe('covers/');
    expect(toCoverLocator('a'.repeat(32))).toBe(`sg-cover:v1:${'a'.repeat(32)}`);
    expect(parseCoverLocator(`sg-cover:v1:${'ab'.repeat(16)}`)).toBe(
      'ab'.repeat(16),
    );
    expect(parseCoverLocator(`sg-object:v1:${'ab'.repeat(16)}`)).toBeNull();
    expect(parseCoverLocator('covers/abc')).toBeNull();
  });

  it('reads PNG and JPEG dimensions and rejects invalid content', () => {
    expect(detectCoverImage(pngWithSize(400, 400))).toMatchObject({
      contentType: 'image/png',
      widthPx: 400,
      heightPx: 400,
    });
    expect(detectCoverImage(jpegWithSize(800, 600))).toMatchObject({
      contentType: 'image/jpeg',
      widthPx: 800,
      heightPx: 600,
    });
    try {
      detectCoverImage(Buffer.from('not-an-image'));
      throw new Error('expected throw');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        STORAGE_ERROR_CODES.STORAGE_UNSUPPORTED_TYPE,
      );
    }
  });

  it('rejects dimensions outside 400..4096', () => {
    try {
      assertCoverDimensions(399, 400);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        STORAGE_ERROR_CODES.STORAGE_UNSUPPORTED_TYPE,
      );
    }
    expect(() => assertCoverDimensions(400, 400)).not.toThrow();
    expect(() => assertCoverDimensions(4096, 4096)).not.toThrow();
    try {
      assertCoverDimensions(4097, 400);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        STORAGE_ERROR_CODES.STORAGE_UNSUPPORTED_TYPE,
      );
    }
  });
});
