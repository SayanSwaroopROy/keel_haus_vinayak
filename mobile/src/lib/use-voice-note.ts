import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useState } from 'react';

import type { UploadFile } from '@/lib/api/endpoints';

export type VoiceNote = { file: UploadFile; durationMs: number };

export function useVoiceNote() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function start(): Promise<void> {
    setProblem(null);
    setStarting(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setProblem('Microphone access is off. Allow it in your phone settings, or type instead.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      setProblem('Could not start the microphone. Try again, or type instead.');
    } finally {
      setStarting(false);
    }
  }

  async function stop(): Promise<VoiceNote | null> {
    const durationMs = state.durationMillis;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      setProblem('The recording could not be saved. Try again.');
      return null;
    }
    const uri = recorder.uri;
    if (!uri) {
      setProblem('The recording could not be saved. Try again.');
      return null;
    }
    return { file: { uri, name: 'voice-note.m4a', mimeType: 'audio/mp4' }, durationMs };
  }

  return { recording: state.isRecording, durationMs: state.durationMillis, starting, problem, start, stop };
}
