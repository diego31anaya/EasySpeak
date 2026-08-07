// lib/mic-permission.ts
//
// Microphone permission for the recording flows. Split from the recording hook because the
// request is a static AudioModule call (not recorder-instance state) and the recovery Alert
// is imperative UI — mirroring how lib/notifications.ts owns notification permission.
//
// `ensureMicPermission` REQUESTS access: on iOS one request call handles all three states —
// undetermined shows the OS dialog and resolves with the choice; granted resolves instantly
// from cache; denied resolves instantly (granted:false) with NO dialog, because iOS never
// re-prompts a denial. So the only recovery for a denied user is deep-linking them to
// Settings, which is exactly what `promptEnableMic` does (mirroring the reminders flow in
// app/(app)/settings/reminders.tsx).

import { AudioModule } from 'expo-audio';
import { Alert, Linking } from 'react-native';

// Request mic access. Callers check `.granted`; a false result means the OS won't prompt
// again this session, so route the user through promptEnableMic().
export function ensureMicPermission() {
  return AudioModule.requestRecordingPermissionsAsync();
}

// Recovery for a denied mic: the OS dialog is spent, so the only way back is the iOS
// Settings page. Copy is PLACEHOLDER (dev owns final wording per the copy standards).
export function promptEnableMic(): void {
  Alert.alert(
    'Microphone is off', // PLACEHOLDER
    'Turn on microphone access for EasySpeak in Settings to record your practice.', // PLACEHOLDER
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
}