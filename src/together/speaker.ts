/**
 * "Sound plays on": in a listen-together session the host picks where the
 * sound comes out, every device (the default) or one member device (one
 * phone on the car stereo). Every device keeps playing in sync; a device
 * that is not the sound device only sets its audio volume to 0, so a change
 * is instant and needs no new sync.
 *
 * The rules (pure, so it is unit-tested):
 * - The host keeps the choice: null (every device), its own id, or a member id.
 * - A chosen member that leaves the session for good gives way to the host.
 * - While a chosen member is away (its link dropped), the host plays the
 *   sound; the choice stays, so the sound goes back when it returns.
 * - The wire carries only the sound device now (`soundDevice`), so a guest
 *   only compares it with its own id.
 */

/** Null: every device plays the sound. Else the member id of the one device. */
export type SpeakerChoice = string | null;

export interface SpeakerMember {
  id: string;
  away?: boolean;
}

/** The choice after a member change: a chosen member that is no longer in the session gives way to the host. */
export function keepChoice(choice: SpeakerChoice, members: readonly SpeakerMember[], hostId: string | null): SpeakerChoice {
  if (choice === null || choice === hostId) return choice;
  return members.some((m) => m.id === choice) ? choice : hostId;
}

/** The device that plays the sound now (null: every device). */
export function soundDevice(choice: SpeakerChoice, members: readonly SpeakerMember[], hostId: string | null): SpeakerChoice {
  const c = keepChoice(choice, members, hostId);
  if (c === null || c === hostId) return c;
  return members.find((m) => m.id === c)?.away ? hostId : c;
}

/** True when this device plays the session's audio with no sound. */
export function mutedHere(target: SpeakerChoice, selfId: string | null): boolean {
  return target !== null && target !== selfId;
}

/** True when a choice is one the host can make: every device, the host, or a member that is in the session now. */
export function validChoice(choice: SpeakerChoice, members: readonly SpeakerMember[], hostId: string | null): boolean {
  if (choice === null) return true;
  return choice === hostId || members.some((m) => m.id === choice && !m.away);
}

/** The view of the setting for the session sheet. */
export interface SpeakerView {
  /** The device that plays the sound now (null: every device). */
  target: SpeakerChoice;
  /** This device's member id. */
  selfId: string | null;
  /** The host's member id. */
  hostId: string | null;
}

/** The name of the sound device for the sheet: "Every device", "This device", or a name. */
export function speakerLabel(view: SpeakerView, names: { hostName: string | null; members: readonly { id: string; name: string }[] }): string {
  const t = view.target;
  if (t === null) return 'Every device';
  if (t === view.selfId) return 'This device';
  if (t === view.hostId) return names.hostName ?? 'The host';
  return names.members.find((m) => m.id === t)?.name ?? 'Another device';
}

/** The note when the sound device changes: "Sound plays on Sam's iPhone now." */
export function speakerNote(view: SpeakerView, names: { hostName: string | null; members: readonly { id: string; name: string }[] }): string {
  const t = view.target;
  const where = t === null ? 'every device' : t === view.selfId ? 'this device' : speakerLabel(view, names);
  return `Sound plays on ${where} now.`;
}

/** True when the session's audio on this device plays with no sound (`TogetherState` facts). */
export function muteSession(s: { mode: string; kind: string; speaker: SpeakerView | null }): boolean {
  return s.mode === 'nearby' && s.kind === 'audio' && !!s.speaker && mutedHere(s.speaker.target, s.speaker.selfId);
}

/** The toast when the chosen device left and the host plays the sound now. */
export function fallbackText(selfIsHost: boolean, hostName: string | null): string {
  return selfIsHost ? 'The sound device left. Sound plays on this device now.' : `The sound device left. Sound plays on ${hostName ?? 'the host'} now.`;
}
