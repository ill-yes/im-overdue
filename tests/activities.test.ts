import { describe, expect, it } from 'vitest';
import { intersectsRange, toActivityInterval, toInstantRange } from '../shared/activities.js';

describe('nanosecond activity ranges', () => {
  const day = toInstantRange('2026-10-01T22:00:00Z', '2026-10-02T22:00:00Z');

  it('keeps points on one exact half-open day', () => {
    expect(
      intersectsRange(toActivityInterval({ start: '2026-10-01T21:59:59.999999999Z', end: null }), day),
    ).toBe(false);
    expect(intersectsRange(toActivityInterval({ start: '2026-10-01T22:00:00Z', end: null }), day)).toBe(true);
    expect(
      intersectsRange(toActivityInterval({ start: '2026-10-02T21:59:59.999999999Z', end: null }), day),
    ).toBe(true);
    expect(intersectsRange(toActivityInterval({ start: '2026-10-02T22:00:00Z', end: null }), day)).toBe(
      false,
    );
  });

  it('includes a duration crossing midnight by one nanosecond but excludes an exact ending', () => {
    expect(
      intersectsRange(
        toActivityInterval({ start: '2026-10-01T21:30:00Z', end: '2026-10-01T22:00:00.000000001Z' }),
        day,
      ),
    ).toBe(true);
    expect(
      intersectsRange(
        toActivityInterval({ start: '2026-10-01T21:30:00Z', end: '2026-10-01T22:00:00Z' }),
        day,
      ),
    ).toBe(false);
    expect(
      intersectsRange(
        toActivityInterval({ start: '2026-10-02T21:30:00Z', end: '2026-10-02T22:00:00Z' }),
        day,
      ),
    ).toBe(true);
  });
});
