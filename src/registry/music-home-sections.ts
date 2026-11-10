/**
 * The music Home section registry. The Home tab of a music library renders
 * every registered section in order. Built-in rows (Recently played, Mixes
 * for you, Genres) register here the same way later contributors will.
 */
import type { ComponentType } from 'react';

import { createRegistry } from './item-actions';

export interface MusicHomeSectionProps {
  /** The music library the tab shows. Every row is scoped to it. */
  libraryId: string;
}

export interface MusicHomeSection {
  id: string;
  order?: number;
  /** Renders the section. It hides itself when it has nothing to show. */
  component: ComponentType<MusicHomeSectionProps>;
}

export const musicHomeSections = createRegistry<MusicHomeSection>();
