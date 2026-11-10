import { fetchDetail } from '../feeds';
import type { BuiltRequest } from '../http';
import { applyRefresh, handleActionResponse } from '../response';
import { render, renderJson } from '../template';

const base = 'https://media.example.org';

describe('{{action.next}}', () => {
  it('keeps its boolean type in a JSON body, like a toggle setting', () => {
    expect(renderJson({ on: '{{action.next}}', note: 'next={{action.next}}' }, { action: { next: true } })).toEqual({ on: true, note: 'next=true' });
    expect(renderJson({ on: '{{ action.next }}' }, { action: { next: false } })).toEqual({ on: false });
  });

  it('is text in a path or a query, and empty without a state', () => {
    expect(render('/save/{{action.next}}', { action: { next: false } })).toBe('/save/false');
    expect(renderJson({ on: '{{action.next}}' }, {})).toEqual({ on: '' });
  });
});

describe('detail action replies', () => {
  const fx = () => ({ toast: jest.fn(), startTask: jest.fn(), refreshItem: jest.fn(), refreshLibrary: jest.fn(), refreshEntry: jest.fn(), refreshPage: jest.fn() });

  it('reads the state and the refresh kinds', () => {
    const f = fx();
    expect(handleActionResponse({ toast: 'Saved', refresh: 'entry', state: { on: true } }, f, 'x')?.state).toEqual({ on: true });
    expect(f.refreshEntry).toHaveBeenCalled();
    applyRefresh('page', f);
    expect(f.refreshPage).toHaveBeenCalled();
    applyRefresh('library', f);
    expect(f.refreshLibrary).toHaveBeenCalled();
  });

  it('ignores a state that is not valid', () => {
    expect(handleActionResponse({ state: { on: 'yes' } }, fx(), 'x')?.state).toBeUndefined();
  });
});

describe('fetchDetail', () => {
  const req: BuiltRequest = { url: `${base}/api/e1`, method: 'GET', headers: {} };

  it('reads the reply with the origin rule', async () => {
    const send = jest.fn(async () => ({ title: 'An entry', image: 'https://other.example.net/x.jpg', backdrop: '/w.jpg' }));
    const d = await fetchDetail(() => req, base, { send });
    expect(send).toHaveBeenCalledWith(req);
    expect(d.imageUrl).toBeUndefined();
    expect(d.backdropUrl).toBe(`${base}/w.jpg`);
  });

  it('refuses a reply with no title, with no URL in the error', async () => {
    await expect(fetchDetail(() => req, base, { send: async () => ({ lines: [] }) })).rejects.toThrow(/^The extension sent a page the app cannot read\.$/);
  });
});
