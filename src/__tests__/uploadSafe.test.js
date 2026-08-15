'use strict';

const { safeUploadFilename, isAllowedUploadName } = require('../../routes/uploadSafe');

describe('uploadSafe', () => {
  test('allows known extensions', () => {
    expect(isAllowedUploadName('a.xlsx')).toBe(true);
    expect(isAllowedUploadName('a.PDF')).toBe(true);
    expect(isAllowedUploadName('a.exe')).toBe(false);
  });

  test('never embeds path traversal segments', () => {
    const name = safeUploadFilename('../../etc/passwd.csv');
    expect(name).not.toContain('..');
    expect(name).not.toContain('/');
    expect(name).toMatch(/\.csv$/);
  });

  test('drops unknown extensions', () => {
    const name = safeUploadFilename('payload.php');
    expect(name).not.toMatch(/\.php$/);
  });
});
