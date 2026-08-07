// app/(app)/pace-target.tsx
//
// Pace-target config AS A TOP-LEVEL route: reachable from anywhere via
// enterFlow('/pace-target') (a future Home link, the Pace metric expansion). The
// (app) Stack presents this with presentation:'modal' (see ./_layout.tsx), so it
// comes up from the BOTTOM with an X (top-right). The Settings entry uses the
// nested settings/pace-target route instead (right-slide). Body is shared — see
// components/ProfilePageShell.tsx.

import * as Haptics from 'expo-haptics';

import { backFlow } from '../../lib/navigation';
import { ProfilePageShell } from '../../components/ProfilePageShell';
import { PaceTargetEditor } from '../../components/PaceTargetEditor';

export default function PaceTarget() {
  const dismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };
  return (
    <ProfilePageShell title="Pace target" dismissKind="close" onDismiss={dismiss}>
      <PaceTargetEditor />
    </ProfilePageShell>
  );
}