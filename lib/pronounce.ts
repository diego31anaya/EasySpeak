// lib/pronounce.ts
//
// Speaks a word aloud with the DEVICE's built-in TTS (expo-speech / iOS AVSpeechSynthesizer)
// — free, offline, no API key, covers every word. Chosen over OpenAI TTS for the Vocabulary
// pronounce button (OpenAI is cheap-if-cached but needs a backend + cache; this needs
// neither). Slightly synthetic but clear for single-word pronunciation.
//
// ⚠️ expo-speech is a NATIVE module — it only works in a native build (`npx expo run:ios`),
// not a JS-only reload. On iOS it also stays silent when the device is in silent mode.

import * as Speech from 'expo-speech';

// A touch slower than normal so a single word reads clearly (tune on device).
const RATE = 0.9;

export function pronounceWord(word: string): void {
  const w = word.trim();
  if (!w) return;
  Speech.stop(); // cancel any in-flight utterance so double-taps don't queue
  Speech.speak(w, { rate: RATE, language: 'en-US' });
}

export function stopPronounce(): void {
  Speech.stop();
}