/**
 * Live transcription through the OpenAI Realtime API, straight from the browser.
 * Microphone audio is captured with an AudioWorklet, resampled to 24 kHz PCM16 and streamed
 * over a WebSocket; transcript deltas arrive while the user is still speaking.
 */

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-live-transcribe';
const TARGET_RATE = 24000;

export interface VoiceCallbacks {
  onDelta: (text: string) => void;
  onCompleted: (text: string) => void;
  onError: (message: string) => void;
}

// Runs in the audio thread: forwards raw mono frames to the main thread.
const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

export function voiceAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && 'AudioWorkletNode' in window;
}

export class VoiceSession {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: number[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private transcript = '';
  private stopped = false;
  private completedResolve: ((text: string) => void) | null = null;

  constructor(
    private key: string,
    private callbacks: VoiceCallbacks,
  ) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    await this.connect();

    this.context = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'pcm-tap', { numberOfOutputs: 0 });
    const inputRate = this.context.sampleRate;
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (this.stopped) return;
      for (const sample of resample(event.data, inputRate, TARGET_RATE)) this.pending.push(sample);
    };
    source.connect(this.node);
    this.flushTimer = setInterval(() => this.flush(), 120);
  }

  /** Stops capture, commits the audio and resolves with the final transcript. */
  async stop(): Promise<string> {
    if (this.stopped) return this.transcript;
    this.stopped = true;
    this.teardownAudio();
    this.flush();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.close();
      return this.transcript;
    }
    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    const final = await new Promise<string>((resolve) => {
      this.completedResolve = resolve;
      setTimeout(() => resolve(this.transcript), 6000);
    });
    this.close();
    return final;
  }

  cancel() {
    this.stopped = true;
    this.teardownAudio();
    this.close();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_URL, ['realtime', `openai-insecure-api-key.${this.key}`]);
      this.ws = ws;
      let settled = false;
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              type: 'transcription',
              audio: {
                input: {
                  format: { type: 'audio/pcm', rate: TARGET_RATE },
                  transcription: { model: MODEL, delay: 'low' },
                  turn_detection: null,
                },
              },
            },
          }),
        );
      };
      ws.onmessage = (msg) => {
        let event: { type: string; delta?: string; transcript?: string; error?: { message?: string } };
        try {
          event = JSON.parse(msg.data as string);
        } catch {
          return;
        }
        switch (event.type) {
          case 'session.updated':
          case 'transcription_session.updated':
            if (!settled) {
              settled = true;
              resolve();
            }
            break;
          case 'conversation.item.input_audio_transcription.delta':
            this.transcript += event.delta ?? '';
            this.callbacks.onDelta(this.transcript);
            break;
          case 'conversation.item.input_audio_transcription.completed':
            this.transcript = event.transcript ?? this.transcript;
            this.callbacks.onCompleted(this.transcript);
            this.completedResolve?.(this.transcript);
            break;
          case 'error': {
            const message = event.error?.message ?? 'transcription error';
            if (!settled) {
              settled = true;
              reject(new Error(message));
            } else {
              this.callbacks.onError(message);
            }
            break;
          }
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Could not reach OpenAI. Check the API key in Settings.'));
        }
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Connection closed by OpenAI. Check the API key in Settings.'));
        }
      };
    });
  }

  private flush() {
    if (!this.pending.length || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const samples = this.pending;
    this.pending = [];
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64(pcm.buffer) }));
  }

  private teardownAudio() {
    clearInterval(this.flushTimer);
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
  }

  private close() {
    this.ws?.close();
    this.ws = null;
  }
}

/** Linear resampling; a no-op when the rates already match. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    out[i] = input[lo] + (input[hi] - input[lo]) * (pos - lo);
  }
  return out;
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
