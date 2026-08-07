// app/(app)/settings/pace-target.tsx
//
// Pace-target config AS A SETTINGS SUB-PAGE: pushed from the Profile row into the
// Settings modal's nested stack, so it slides in from the RIGHT with a back chevron
// (top-left), matching edit-info. Same body as the top-level /pace-target route
// (which presents as a bottom sheet) — see components/ProfilePageShell.tsx.

import * as Haptics from 'expo-haptics';

import { backFlow } from '../../../lib/navigation';
import { ProfilePageShell } from '../../../components/ProfilePageShell';
import { PaceTargetEditor } from '../../../components/PaceTargetEditor';

export default function SettingsPaceTarget() {
  const dismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };
  return (
    <ProfilePageShell title="Pace target" dismissKind="back" onDismiss={dismiss}>
      <PaceTargetEditor />
    </ProfilePageShell>
  );
}