import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '../src/download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function browserDownload() {
  vi.useFakeTimers();
  const sequence: string[] = [];
  const link = {
    href: '', download: '',
    click: vi.fn(() => { sequence.push('click'); }),
    remove: vi.fn(() => { sequence.push('remove'); }),
  };
  const createElement = vi.fn(() => link);
  const appendChild = vi.fn(() => { sequence.push('attach'); });
  vi.stubGlobal('document', { createElement, body: { appendChild } });
  vi.stubGlobal('window', { setTimeout: globalThis.setTimeout });
  const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download-test');
  const revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { sequence, link, createElement, appendChild, createURL, revokeURL };
}

describe('browser download output', () => {
  it('downloads the supplied Blob and filename and revokes its URL after one second', () => {
    const browser = browserDownload();
    const blob = new Blob(['synthetic backup'], { type: 'application/octet-stream' });

    downloadBlob(blob, 'im-overdue-backup.sqlite');

    expect(browser.createURL).toHaveBeenCalledExactlyOnceWith(blob);
    expect(browser.createElement).toHaveBeenCalledExactlyOnceWith('a');
    expect(browser.link.href).toBe('blob:download-test');
    expect(browser.link.download).toBe('im-overdue-backup.sqlite');
    expect(browser.appendChild).toHaveBeenCalledExactlyOnceWith(browser.link);
    expect(browser.sequence).toEqual(['attach', 'click', 'remove']);
    expect(browser.revokeURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(browser.revokeURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(browser.revokeURL).toHaveBeenCalledExactlyOnceWith('blob:download-test');
  });

  it('keeps repeated downloads and URL cleanup independent', () => {
    const browser = browserDownload();
    browser.createURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const json = new Blob(['{}'], { type: 'application/json;charset=utf-8' });
    const csv = new Blob(['source,id'], { type: 'text/csv;charset=utf-8' });

    downloadBlob(json, 'im-overdue-beispiel.json');
    expect(browser.link.download).toBe('im-overdue-beispiel.json');
    downloadBlob(csv, 'im-overdue-beispiel.csv');
    expect(browser.link.download).toBe('im-overdue-beispiel.csv');
    expect(browser.link.click).toHaveBeenCalledTimes(2);
    vi.runOnlyPendingTimers();
    expect(browser.revokeURL.mock.calls).toEqual([['blob:first'], ['blob:second']]);
  });

  it('cleans up and preserves a failed download error for the caller', () => {
    const browser = browserDownload();
    const failure = new Error('Download blocked');
    browser.link.click.mockImplementation(() => { browser.sequence.push('click'); throw failure; });

    expect(() => downloadBlob(new Blob(['synthetic export']), 'timesheet.csv')).toThrow(failure);
    expect(browser.sequence).toEqual(['attach', 'click', 'remove']);
    expect(browser.revokeURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(browser.revokeURL).toHaveBeenCalledExactlyOnceWith('blob:download-test');
  });
});
