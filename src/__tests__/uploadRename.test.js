'use strict';

const { validateUploadRename } = require('../uploadRename');

describe('upload rename (original_name only)', () => {
  test('requires a non-empty name', () => {
    expect(validateUploadRename('').ok).toBe(false);
    expect(validateUploadRename('   ').error).toMatch(/required/i);
  });

  test('rejects path separators', () => {
    expect(validateUploadRename('a/b.pdf').ok).toBe(false);
    expect(validateUploadRename('a\\\\b.pdf').ok).toBe(false);
  });

  test('unchanged name is ok', () => {
    const r = validateUploadRename('THEI.HEALTHSPRING.08.2026.pdf', {
      currentName: 'THEI.HEALTHSPRING.08.2026.pdf',
    });
    expect(r).toMatchObject({ ok: true, unchanged: true });
  });

  test('blocks renaming onto an existing upload name', () => {
    const r = validateUploadRename('THEI.HEALTHSPRING.09.2026.pdf', {
      currentName: 'THEI.HEALTHSRPING.09.2026.pdf',
      existingNames: ['THEI.HEALTHSPRING.09.2026.pdf', 'other.xlsx'],
    });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
    expect(r.error).toMatch(/already named/i);
  });

  test('allows fixing HEALTHSRPING typo when the target is free', () => {
    const r = validateUploadRename('THEI.HEALTHSPRING.08.2026.pdf', {
      currentName: 'THEI.HEALTHSRPING.08.2026.pdf',
      existingNames: ['THEI.HEALTHSPRING.09.2026.pdf'],
    });
    expect(r).toMatchObject({
      ok: true,
      unchanged: false,
      name: 'THEI.HEALTHSPRING.08.2026.pdf',
    });
  });
});
