import type { Manifest } from '../schema';
import { parseManifest } from '../schema';

export const raw = {
  schemaVersion: 1,
  id: 'com.example.hello',
  name: 'Hello',
  version: '1.0.0',
  baseUrl: 'http://192.0.2.10:3000',
  permissions: ['network', 'itemPath', 'jellyfinToken'],
  headers: { 'X-Api-Key': '{{settings.apiKey}}' },
  contributes: {
    settings: [
      { key: 'apiKey', type: 'text', label: 'API key', secret: true },
      { key: 'user', type: 'text', label: 'User', source: 'jellyfin.userName' },
      { key: 'folder', type: 'choice', label: 'Folder', optionsSource: '/folders', matchLibrary: true },
      { key: 'loud', type: 'toggle', label: 'Loud', default: true },
    ],
    itemActions: [
      {
        id: 'greet',
        title: 'Say hello',
        when: { types: ['Movie'], pathPrefixes: ['/media/videos/'] },
        confirm: { title: 'Greet {{item.name}}?', action: 'Greet' },
        inputs: [{ key: 'name', type: 'text', title: 'Name' }],
        request: { method: 'POST', path: '/greet/{{item.id}}', query: { loud: '{{settings.loud}}' }, body: { path: '{{item.path}}', name: '{{input.name}}', loud: '{{settings.loud}}' } },
      },
    ],
    homeSections: [{ id: 'latest', title: 'Latest', feed: '/feed', refreshSeconds: 10 }],
    shareTargets: [{ id: 'send', title: 'Send', hosts: ['youtube.com', 'youtu.be'], request: { path: '/send', body: { url: '{{share.url}}' } } }],
    panels: [{ id: 'main', title: 'Hello', url: '/panel#k={{settings.apiKey}}' }],
  },
};

/** The schema version 2 sample of the plan (docs/extensions.md). */
export const rawV2 = {
  schemaVersion: 2,
  id: 'org.example.media',
  name: 'Example Media',
  version: '2.0.0',
  baseUrl: 'https://media.example.org',
  permissions: ['network', 'playback', 'downloads'],
  contributes: {
    pages: [
      {
        id: 'main',
        title: 'Example',
        icon: 'play.rectangle',
        placement: { tab: true, library: true, home: ['latest'] },
        search: { feed: '/api/search', placeholder: 'Search Example' },
        sections: [
          { id: 'latest', title: 'Latest', layout: 'row', shape: 'thumb', feed: '/api/feed/latest', refreshSeconds: 300 },
          { id: 'all', title: 'Everything', layout: 'grid', shape: 'poster', feed: '/api/feed/all' },
          { id: 'queue', title: 'Queue', layout: 'list', feed: '/api/feed/queue' },
        ],
      },
    ],
    skipLabels: [
      { id: 'intro', title: 'Intro', default: 'ask' },
      { id: 'promo', title: 'Promotion', default: 'auto' },
    ],
  },
};

export function manifest(over: Partial<typeof raw> = {}): Manifest {
  const r = parseManifest({ ...raw, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.manifest;
}
