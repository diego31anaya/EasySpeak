import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  IOSOutputFormat,
  AudioQuality,
  setAudioModeAsync,
  AudioModule,
  type RecordingOptions,
} from 'expo-audio';

export type RecordingStatus = 'idle' | 'recording' | 'recorded';

// iOS-only WAV/PCM recording (v1). Pitch analysis needs the raw waveform,
// which AAC/m4a doesn't expose without a decoder; LINEARPCM hands us readable
// samples directly. 16 kHz mono is plenty for F0 (well under 500 Hz) and a
// quarter the size of 44.1 kHz stereo. Metering stays on for the waveBuffer.
// NOTE: Android's MediaRecorder can't emit PCM — the android block here falls
// back to m4a, which is why intonation is iOS-only until the recorder is
// swapped for a PCM-capable lib (see intonation-build-plan-v1.md, "Future").
const WAV_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 128000,
  isMeteringEnabled: true,
  ios: {
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

export function useRecording() {
  const recorder = useAudioRecorder(WAV_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);

  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [uri, setUri] = useState<string | null>(null);

  const player = useAudioPlayer(uri ? { uri } : null);

  // Track current status in a ref so the unmount cleanup can read it
  // without depending on stale closure state.
  const statusRef = useRef<RecordingStatus>('idle');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Cleanup on unmount only — empty deps array.
  // Safely no-op if the native recorder is already torn down.
  useEffect(() => {
    return () => {
      if (statusRef.current === 'recording') {
       // recorder.stop() is async - a sync try/catch won't catch promise
       // rejections.
        recorder.stop().catch(() => {})
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Holds the in-flight (or finished) warm-up so startRecording can reuse it.
  const prepareRef = useRef<Promise<void> | null>(null);

  // The cheap, SAFE half of arming the recorder: the permission check + the
  // audio-session category switch/activation (allowsRecording → playAndRecord).
  // Run this DURING TTS playback to pull it off the post-prompt hot path.
  //
  // ⚠️ Do NOT also prepareToRecordAsync() here. A recorder prepared while the
  // TTS player still owns the session goes STALE when playback ends — record()
  // then runs (the timer ticks) but captures SILENCE. prepareToRecordAsync must
  // stay adjacent to record() in startRecording, after the player has released
  // the session. (Learned the hard way — verified 2026-06-29.) The session
  // category switch is safe to front-load and is a good chunk of the latency.
  // Idempotent within a session; the result is cached on prepareRef.
  const prepareRecording = useCallback(() => {
    if (!prepareRef.current) {
      prepareRef.current = (async () => {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) {
          throw new Error('Microphone permission was denied.');
        }
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
      })();
      // Keep a handler attached so a rejection startRecording hasn't awaited yet
      // can't surface as an unhandled rejection; startRecording awaits the same
      // promise and still observes the throw.
      prepareRef.current.catch(() => {});
    }
    return prepareRef.current;
  }, []);

  const startRecording = useCallback(async () => {
    // Reuse the permission + audio-mode warm-up kicked off during playback; if
    // none ran (a caller skipped prepareRecording), do it now — unchanged
    // fallback contract.
    try {
      await (prepareRef.current ?? prepareRecording());
    } catch (e) {
      prepareRef.current = null; // let a retry re-prepare from scratch
      throw e;
    }
    // prepareToRecordAsync stays HERE — adjacent to record(), after the TTS
    // player has released the session — so capture actually works.
    setUri(null);
    await recorder.prepareToRecordAsync();
    recorder.record();
    setStatus('recording');
    prepareRef.current = null; // consumed; the next round re-prepares
  }, [recorder, prepareRecording]);

  const stopRecording = useCallback(async () => {
    await recorder.stop();

    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });

    setUri(recorder.uri);
    setStatus('recorded');
  }, [recorder]);

  const playRecording = useCallback(() => {
    if (!uri) return;
    player.seekTo(0);
    player.play();
  }, [uri, player]);

  const reset = useCallback(async () => {
    if (statusRef.current === 'recording') {
      try {
        await recorder.stop();
      } catch {
        // Already stopped or torn down
      }
    }
    // Drop any prepare that never got consumed (e.g. exited mid-playback) so the
    // next session re-prepares cleanly.
    prepareRef.current = null;
    setStatus('idle');
    setUri(null);
  }, [recorder]);

  const durationSec = recorderState.durationMillis / 1000;

  const metering = recorderState.metering ?? -160;

  return {
    status,
    durationSec,
    metering,
    uri,
    prepareRecording,
    startRecording,
    stopRecording,
    playRecording,
    reset,
  };
}