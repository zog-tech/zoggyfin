/** Voice input through the system speech screen (`modules/zoggyfin-native`, ZoggyfinVoiceModule.kt). */
export interface VoiceInput {
  /** True when the device has a speech screen. Ask while a screen shows: the check needs the activity. */
  available(): boolean;
  /** Opens the speech screen. Resolves with what was said, or null when the user closed it. */
  listen(prompt?: string): Promise<string | null>;
}
