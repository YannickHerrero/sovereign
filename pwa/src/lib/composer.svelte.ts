import { drafts } from './drafts';
import { settings } from './settings.svelte';
import type { ImageContent } from './types';
import { VoiceSession, voiceAvailable } from './voice';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type SubmitHandler = (text: string, images: ImageContent[]) => Promise<void> | void;

/** Draft, attachment and dictation state shared by the mobile sheet and the desktop composer. */
export class ComposerState {
  #draft = $state('');
  sending = $state(false);
  images = $state<{ id: string; content: ImageContent }[]>([]);
  private nextImageId = 1;
  imageLoading = $state(false);
  imageError = $state<string | null>(null);
  mode = $state<'text' | 'voice'>('text');
  transcript = $state('');
  voiceError = $state<string | null>(null);
  seconds = $state(0);

  private voice: VoiceSession | null = null;
  private ticker: ReturnType<typeof setInterval> | undefined;

  /** @param draftKey when given, the text is restored from and saved to `drafts` under this id. */
  constructor(private readonly draftKey?: string) {
    if (draftKey) this.#draft = drafts.get(draftKey);
  }

  get draft(): string {
    return this.#draft;
  }

  set draft(value: string) {
    this.#draft = value;
    if (this.draftKey) drafts.set(this.draftKey, value);
  }

  get hasDraft(): boolean {
    return this.draft.trim().length > 0 || this.images.length > 0;
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

  /** Appends text typed or pasted while the field had no focus. */
  append(text: string) {
    this.draft += text;
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

  /** Inserts references synchronously so subsequent typing cannot move the paste location. */
  pasteImage(event: ClipboardEvent, start = this.draft.length, end = start): boolean {
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return false;
    void this.attachImages(files, start, end);
    return true;
  }

  async attachImages(files: File[], start = this.draft.length, end = start) {
    if (this.busy || !files.length) return;
    this.imageError = null;
    if (this.images.length + files.length > 10) {
      this.imageError = 'Attach at most 10 images per message.';
      return;
    }
    if (files.some((file) => !IMAGE_TYPES.includes(file.type))) {
      this.imageError = 'Choose JPEG, PNG, WebP or GIF images.';
      return;
    }
    if (files.some((file) => !file.size || file.size > IMAGE_MAX_BYTES)) {
      this.imageError = 'Each image must be non-empty and at most 5 MiB.';
      return;
    }
    // Do not reuse numbers, including references restored from a text-only draft.
    for (const match of this.draft.matchAll(/\[IMG_(\d+)\]/g)) {
      this.nextImageId = Math.max(this.nextImageId, Number(match[1]) + 1);
    }
    const ids = files.map(() => `IMG_${this.nextImageId++}`);
    this.draft = this.draft.slice(0, start) + ids.map((id) => `[${id}]`).join(' ') + this.draft.slice(end);
    this.imageLoading = true;
    try {
      const contents = await Promise.all(files.map((file) => new Promise<ImageContent>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result as string;
          resolve({ type: 'image', mimeType: file.type, data: url.slice(url.indexOf(',') + 1) });
        };
        reader.onerror = () => reject(new Error('Could not read images. Remove their references or attach them again.'));
        reader.readAsDataURL(file);
      })));
      this.images.push(...contents.map((content, i) => ({ id: ids[i]!, content })));
    } catch (err) {
      this.imageError = (err as Error).message;
    } finally {
      this.imageLoading = false;
    }
  }

  removeImage(id: string) {
    if (this.busy) return;
    this.images = this.images.filter((image) => image.id !== id);
  }

  get missingReferences(): string[] {
    return [...new Set(this.draft.match(/\[IMG_\d+\]/g) ?? [])]
      .filter((ref) => !this.images.some((image) => `[${image.id}]` === ref));
  }

  /**
   * Sends the draft through `onSubmit`. Resolves true on success (draft cleared) and false
   * when nothing was sent or the handler threw (draft kept for retry).
   */
  async submit(onSubmit: SubmitHandler): Promise<boolean> {
    const text = this.draft.trim();
    if ((!text && !this.images.length) || this.busy || this.missingReferences.length) return false;
    this.sending = true;
    try {
      // Both agent protocols accept ordered images. Keep the mapping in the message
      // itself so it survives queues and native agent session history as well.
      const mapping = this.images.length
        ? `\n\nAttached images (in order): ${this.images.map((image) => `[${image.id}]`).join(', ')}.`
        : '';
      await onSubmit(text + mapping, this.images.map((image) => image.content));
      this.draft = '';
      this.images = [];
      this.nextImageId = 1;
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
