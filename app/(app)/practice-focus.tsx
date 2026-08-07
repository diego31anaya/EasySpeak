// app/(app)/practice-focus.tsx
//
// "What you're working on" (focus) config AS A TOP-LEVEL route: reachable from
// anywhere via enterFlow('/practice-focus') (a future Home link; later it can feed
// the AI feedback prompt). The (app) Stack presents this with presentation:'modal'
// (see ./_layout.tsx), so it comes up from the BOTTOM with an X (top-right). The
// Settings entry uses the nested settings/practice-focus route instead (right-slide).
// Body is shared — see components/ProfilePageShell.tsx. Title kept short ("Focus").

import * as Haptics from 'expo-haptics';

import { backFlow } from '../../lib/navigation';
import { ProfilePageShell } from '../../components/ProfilePageShell';
import { FocusEditor } from '../../components/FocusEditor';

export default function PracticeFocus() {
  const dismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };
  return (
    <ProfilePageShell title="Focus" dismissKind="close" onDismiss={dismiss}>
      <FocusEditor />
    </ProfilePageShell>
  );
}