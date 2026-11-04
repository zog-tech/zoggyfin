import { approveErrorText, cleanCode, isCompleteCode } from '../code';

describe('cleanCode', () => {
  it('keeps digits only', () => {
    expect(cleanCode('123 456')).toBe('123456');
    expect(cleanCode('12-34-56')).toBe('123456');
    expect(cleanCode('ab1c2')).toBe('12');
  });

  it('keeps at most six digits', () => {
    expect(cleanCode('1234567890')).toBe('123456');
  });

  it('gives an empty code for no digits', () => {
    expect(cleanCode('')).toBe('');
    expect(cleanCode('abc')).toBe('');
  });
});

describe('isCompleteCode', () => {
  it('needs six digits', () => {
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('12345a')).toBe(false);
    expect(isCompleteCode('')).toBe(false);
  });
});

describe('approveErrorText', () => {
  const http = (status: number) => ({ response: { status } });

  it('explains an unknown or expired code', () => {
    expect(approveErrorText(http(404))).toMatch(/does not know this code/);
  });

  it('explains that Quick Connect may be off', () => {
    expect(approveErrorText(http(401))).toMatch(/Quick Connect may be off/);
  });

  it('explains a missing permission', () => {
    expect(approveErrorText(http(403))).toBe('This account cannot approve this code.');
  });

  it('falls back to the general error text', () => {
    expect(approveErrorText({ code: 'ERR_NETWORK', message: 'Network Error' })).toMatch(/^Cannot reach the server\./);
    expect(approveErrorText(http(500))).toMatch(/^Server error\./);
  });
});
