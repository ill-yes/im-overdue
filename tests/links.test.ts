import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from '../src/links.js';

describe('external evidence links', () => {
  it('accepts only absolute HTTP and HTTPS links', () => {
    expect(safeExternalUrl('https://example.org/a?b=1#c')).toBe('https://example.org/a?b=1#c');
    expect(safeExternalUrl('http://example.org')).toBe('http://example.org/');
    for (const value of [
      null,
      '',
      '/relative',
      'not a url',
      'javascript:alert(1)',
      'data:text/html,test',
      'file:///tmp/test',
      'mailto:test@example.org',
    ]) {
      expect(safeExternalUrl(value)).toBeNull();
    }
  });
});
