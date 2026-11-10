/**
 * Starts the extension runtime once the user is signed in: it registers the
 * contributions of the signed-in account (again on an account switch),
 * syncs the extension list with the account, shows the questions of
 * extension actions and takes links that other apps share.
 */
import { router } from 'expo-router';
import { type ComponentType, useEffect } from 'react';

import { homeSections } from '@/registry/home-sections';

import { installFromAccount, startExtensions } from '../runtime';
import { listenForShares } from '../share-intake';
import { startExtensionSync } from '../sync/io';
import { ExtensionHomeSection, ExtensionTasksSection } from './home-section';
import { ExtensionPromptHost } from './prompt-host';

const sections = new Map<string, ComponentType>();

/** One stable component per extension row, so Home does not mount it again on each change. */
function sectionComponent(extId: string, sectionId: string): ComponentType {
  const key = `${extId}\u0000${sectionId}`;
  let C = sections.get(key);
  if (!C) {
    const Section = () => <ExtensionHomeSection extId={extId} sectionId={sectionId} />;
    Section.displayName = `ExtensionSection(${extId}.${sectionId})`;
    C = Section;
    sections.set(key, C);
  }
  return C;
}

let tasksRegistered = false;

export function ExtensionsHost() {
  useEffect(() => {
    if (!tasksRegistered) {
      tasksRegistered = true;
      homeSections.register({ id: 'ext.tasks', order: 3, component: ExtensionTasksSection });
    }
    const stop = startExtensions(sectionComponent);
    // The extension list follows the Jellyfin account across devices.
    startExtensionSync(installFromAccount);
    return stop;
  }, []);
  useEffect(() => listenForShares((text) => router.push({ pathname: '/share', params: { text } })), []);
  return <ExtensionPromptHost />;
}
