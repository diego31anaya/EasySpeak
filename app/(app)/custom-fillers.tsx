// app/(app)/custom-fillers.tsx
//
// Custom-filler-words config AS A TOP-LEVEL route: reachable from anywhere via
// enterFlow('/custom-fillers') (a future Home link, the Filler metric expansion).
// The (app) Stack presents this with presentation:'modal' (see ./_layout.tsx), so it
// comes up from the BOTTOM with an X (top-right). The Settings entry uses the nested
// settings/custom-fillers route instead (right-slide). Body is shared — see
// components/ProfilePageShell.tsx.

import * as Haptics from 'expo-haptics';

import { backFlow } from '../../lib/navigation';
import { ProfilePageShell } from '../../components/ProfilePageShell';
import { CustomFillersEditor } from '../../components/CustomFillersEditor';

export default function CustomFillers() {
  const dismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    backFlow();
  };
  return (
    <ProfilePageShell title="Custom filler words" dismissKind="close" onDismiss={dismiss}>
      <CustomFillersEditor />
    </ProfilePageShell>
  );
}