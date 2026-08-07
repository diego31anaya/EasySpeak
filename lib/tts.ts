// TTS audio is synthesized via the `openai-tts` Supabase Edge Function (which holds
// the OpenAI key); the client only sends the text + voice. See lib/ai-proxy.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioSampleListener,
  setAudioModeAsync,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { openaiTts } from './ai-proxy';

type Voice = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse';

type SpeakOptions = {
    voice?: Voice;
    instructions?: string;
    onReady?: () => void;
}

const DEFAULT_VOICE: Voice = 'coral';
const DEFAULT_INSTRUCTIONS =
  'Speak in a warm, conversational tone, like a friend asking a thoughtful question.';

// Higher = smoother but laggier. 0.6 reads as natural without strobing.
const SMOOTHING = 0.6;
// Speech RMS typically peaks around 0.3; scaling 0..0.4 → 0..1 gives good orb range.
const RMS_SCALE = 0.4;

export type TTS = {
    speak: (text: string, options?: SpeakOptions) => Promise<void>;
    stopSpeaking: () => Promise<void>
    isSpeaking: boolean;
    amplitude: number; // 0..1, smoothed; consumed by the AI orb
}

export const TTS_AUDIO_FILENAME = 'tts-current.mp3';

export function useTTS(): TTS {
    // Player starts source-less. We swap in the freshly downloaded MP3 each time.
    // keepAudioSessionActive: do NOT tear down the iOS audio session when the
    // prompt finishes playing. Without this, the session deactivates the instant
    // the prompt ends, so the recorder has to REACTIVATE it — the ~1s iOS audio
    // hardware warm-up that reads as the silent gap before recording. Keeping it
    // active lets recording start against an already-warm session. The recorder
    // side switches the category to playAndRecord during playback (prepareRecording
    // in onReady), so at record time the session is already active AND the right
    // category — no deactivate/reactivate cycle. (iOS-only AudioPlayerOptions.)
    const player = useAudioPlayer(null, { keepAudioSessionActive: true });
    const status = useAudioPlayerStatus(player);

    const [isSpeaking, setIsSpeaking] = useState(false);
    const [amplitude, setAmplitude] = useState(0);

    // Refs let the sample listener and cleanup paths read latest values
    // without re-subscribing on every render
    const smoothedRef = useRef(0);
    const resolveRef = useRef<(() => void) | null>(null);
    const isSpeakingRef = useRef(false);

    // Tracks an in-flight speak() call (network + file write + player load).
    // Distinct from isSpeakingRef which only flips true once audio starts playing.
    const isPendingRef = useRef(false);

    // Real PCM amplitude during playback.
    // IOS: words. Android: known unreliable in expo-audio as of late 2025
    useAudioSampleListener(player, (sample) => {
        const frames = sample.channels[0]?.frames;
        if (!frames || frames.length === 0) return;

        // RMS = sqrt(mean of squared samples). Standard amplitude measure for a window of audio.
        let sumSq = 0;
        for (let i = 0; i < frames.length; i++) {
        sumSq += frames[i] * frames[i];
        }
        const rms = Math.sqrt(sumSq / frames.length);

        const normalized = Math.min(1, rms / RMS_SCALE);
        smoothedRef.current =
        smoothedRef.current * SMOOTHING + normalized * (1 - SMOOTHING);
        setAmplitude(smoothedRef.current);
    });

    // When playback finishes naturally, resolve the speak() promise
    useEffect(() => {
        if (status.didJustFinish && isSpeakingRef.current) {
            finishSpeaking();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status.didJustFinish])

    const finishSpeaking = useCallback(() => {
        isSpeakingRef.current = false;
        isPendingRef.current = false;
        setIsSpeaking(false);
        setAmplitude(0);
        smoothedRef.current = 0;
        if (resolveRef.current) {
            resolveRef.current();
            resolveRef.current = null;
        }
    }, []);

    const speak = useCallback(
        async(text: string, options: SpeakOptions = {}) => {
            isPendingRef.current = true;

            // Ensure TTS plays even when the device's ringer is on silent.
            await setAudioModeAsync({ playsInSilentMode: true });

            // 1. Synthesize the MP3 via the openai-tts Edge Function (the model +
            //    response_format are forced server-side; we send text + voice).
            const res = await openaiTts({
                input: text,
                voice: options.voice ?? DEFAULT_VOICE,
                instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(
                `OpenAI TTS ${res.status}: ${errText || res.statusText}`,
        );
            }

            // 2. Save the MP3 to a fixed cache file (overwrites previous).
            const arrayBuffer = await res.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            const file = new File(Paths.cache, TTS_AUDIO_FILENAME);
            if (file.exists) file.delete();
            file.create();
            file.write(bytes);

            // 3. Enable sampling and load the new file.
            player.setAudioSamplingEnabled(true);
            await player.replace({ uri: file.uri });

            // Cancellation check: stopSpeaking() may have been called while we
            // were loading (e.g. user navigated away)/ Bail without playing.
            if (!isPendingRef.current) return;

            // 4. Play. status.didJustFinish (via useEffect above) resolve the promise
            options.onReady?.()

            isSpeakingRef.current = true;
            setIsSpeaking(true);
            player.play();

            return new Promise<void>((resolve) => {
                resolveRef.current = resolve;
            })

        },
        [player]
    );

    const stopSpeaking = useCallback(async () => {
        // Signal cancellation to any in-flight speak() that's still loading.
        // If audio has already started, this also glags it stopped (harmless)/
        isPendingRef.current = false;

        if (!isSpeakingRef.current) return;
        try {
            player.pause();
        } catch {
            // Player may already be released by unmount cleanup. Safe to ignore
        }
        
        finishSpeaking();
    }, [player, finishSpeaking]);

    // Cleanup on unmount: stop in-flight speech, resolve dangling promise.
    useEffect(() => {
        return () => {
            if (isSpeakingRef.current) {
                try {
                    player.pause();
                } catch {
                    // Ignore
                }
                if (resolveRef.current) {
                    resolveRef.current();
                    resolveRef.current = null;
                }
            }
        }
    }, [])

    return { speak, stopSpeaking, isSpeaking, amplitude}
}
