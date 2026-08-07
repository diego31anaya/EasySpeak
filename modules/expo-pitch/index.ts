import { requireNativeModule } from 'expo-modules-core';

const ExpoPitch = requireNativeModule('ExpoPitch');

export function echoDouble(x: number): number {
  return ExpoPitch.echoDouble(x);
}

export function sumArray(values: number[]): number {
  return ExpoPitch.sumArray(values);
}

export type PitchFrame = { t: number; f0Hz: number };

export function detectPitch(samples: number[], sampleRate: number): Promise<PitchFrame[]> {
  return ExpoPitch.detectPitch(samples, sampleRate);
}