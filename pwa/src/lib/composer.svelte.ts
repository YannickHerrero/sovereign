import { settings } from './settings.svelte';
import type { ImageContent } from './types';
import { VoiceSession, voiceAvailable } from './voice';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type SubmitHandler = (text: string, images: ImageContent[]) => Promise<void> | void;

/** Draft, attachment and dictation state shared by the mobile sheet and the desktop composer. */
export class ComposerState {
  draft = $state('');
  sending = $state(false);
  image = $state<ImageContent | null>(null);
  imageLoading = $state(false);
  imageError = $state<string | null>(null);
  mode = $state<'text' | 'voice'>('text');
  transcript = $state('');
  voiceError = $state<string | null>(null);
  seconds = $state(0);

  private voice: VoiceSession | null = null;
  private ticker: ReturnType<typeof setInterval> | undefined;

  get hasDraft(): boolean {
    return this.draft.trim().length > 0 || this.image !== null;
  }

  get timer(): string {
    return `${Math.floor(this.seconds / 60)}:${String(this.seconds % 60).padStart(2, '0')}`;
  }

  get canVoice(): boolean {
    return voiceAvailable() && settings.openaiKey !== '';
  }

  get busy(): boolean {
    return this.sending || this.imageLoading;
  }

  /**
   * Starts dictation. Resolves false when voice is unavailable or failed to start; in that
   * case `voiceError` explains why and the caller should fall back to typing.
   */
  async startVoice(): Promise<boolean> {
    if (!this.canVoice) {
      this.voiceError = voiceAvailable() ? 'Add an OpenAI key in Settings to dictate.' : 'Voice needs microphone access over HTTPS.';
      return false;
    }
    this.voiceError = null;
    this.transcript = '';
    this.seconds = 0;
    this.mode = 'voice';
    const session = new VoiceSession(settings.openaiKey, {
      onDelta: (text) => (this.transcript = text),
      onCompleted: (text) => (this.transcript = text),
      onError: (message) => (this.voiceError = message),
    });
    this.voice = session;
    try {
      await session.start();
      this.ticker = setInterval(() => this.seconds++, 1000);
      return true;
    } catch (err) {
      this.voice = null;
      this.voiceError = (err as Error).message;
      this.mode = 'text';
      return false;
    }
  }

  /** Stops dictation and appends the transcript to the draft. */
  async stopVoice() {
    const session = this.voice;
    this.voice = null;
    clearInterval(this.ticker);
    const text = session ? await session.stop() : this.transcript;
    this.draft = this.draft ? `${this.draft.trimEnd()} ${text}`.trim() : text;
    this.transcript = '';
    this.mode = 'text';
  }

  cancelVoice() {
    clearInterval(this.ticker);
    this.voice?.cancel();
    this.voice = null;
    this.transcript = '';
    this.mode = 'text';
  }

  /** Attaches the first image found in a paste event. Returns true when one was taken. */
  pasteImage(event: ClipboardEvent): boolean {
    const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (!file) return false;
    void this.attachImage(file);
    return true;
  }

  async attachImage(file: File) {
    if (this.busy) return;
    this.imageError = null;
    if (!IMAGE_TYPES.includes(file.type)) {
      this.imageError = 'Choose a JPEG, PNG, WebP or GIF image.';
      return;
    }
    if (!file.size || file.size > IMAGE_MAX_BYTES) {
      this.imageError = 'Image must be non-empty and at most 5 MiB.';
      return;
    }
    this.imageLoading = true;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
      });
      this.image = { type: 'image', mimeType: file.type, data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
    } catch (err) {
      this.imageError = (err as Error).message;
    } finally {
      this.imageLoading = false;
    }
  }

  removeImage() {
    this.image = null;
  }

  /**
   * Sends the draft through `onSubmit`. Resolves true on success (draft cleared) and false
   * when nothing was sent or the handler threw (draft kept for retry).
   */
  async submit(onSubmit: SubmitHandler): Promise<boolean> {
    const text = this.draft.trim();
    if ((!text && !this.image) || this.busy) return false;
    this.sending = true;
    try {
      await onSubmit(text, this.image ? [this.image] : []);
      this.draft = '';
      this.image = null;
      this.imageError = null;
      return true;
    } catch {
      // The parent displays the error; keep the draft available for retry.
      return false;
    } finally {
      this.sending = false;
    }
  }

  dispose() {
    this.cancelVoice();
  }
}

export function isSubmitShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}
