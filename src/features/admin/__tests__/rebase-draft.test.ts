import type { UserPolicy } from '@jellyfin/sdk/lib/generated-client/models';

import { draftFrom, policyDiff, rebaseDraft } from '../logic';

// A full policy, as the server sends it.
const policy = (p: Partial<UserPolicy>): UserPolicy => ({
  AuthenticationProviderId: 'x',
  PasswordResetProviderId: 'y',
  ...draftFrom({ AuthenticationProviderId: 'x', PasswordResetProviderId: 'y' }),
  ...p,
});

describe('rebaseDraft', () => {
  const before = policy({ EnableContentDownloading: false, IsDisabled: false });

  it('keeps an unsaved edit when the account is enabled or disabled', () => {
    const draft = { ...draftFrom(before), EnableContentDownloading: true };
    const after = policy({ EnableContentDownloading: false, IsDisabled: true });
    const next = rebaseDraft(before, after, draft, false)!;
    expect(next.EnableContentDownloading).toBe(true);
    // The new account state comes from the server, so a save does not undo it.
    expect(next.IsDisabled).toBe(true);
    expect(policyDiff(after, next)).toEqual(['EnableContentDownloading']);
  });

  it('starts again from the new policy when nothing was edited', () => {
    const after = policy({ EnableContentDownloading: true });
    expect(rebaseDraft(before, after, draftFrom(before), false)).toEqual(draftFrom(after));
  });

  it('starts again after the user’s own save', () => {
    const draft = { ...draftFrom(before), EnableRemoteAccess: true };
    const after = policy({ EnableRemoteAccess: false });
    expect(rebaseDraft(before, after, draft, true)).toEqual(draftFrom(after));
  });

  it('takes the new value of a field the user did not edit', () => {
    const draft = { ...draftFrom(before), EnableRemoteAccess: true };
    const after = policy({ EnableContentDownloading: true });
    const next = rebaseDraft(before, after, draft, false)!;
    expect(next.EnableRemoteAccess).toBe(true);
    expect(next.EnableContentDownloading).toBe(true);
  });

  it('is null with no policy, and fresh with no draft or no earlier policy', () => {
    expect(rebaseDraft(before, undefined, draftFrom(before), false)).toBeNull();
    expect(rebaseDraft(undefined, before, null, false)).toEqual(draftFrom(before));
  });
});
