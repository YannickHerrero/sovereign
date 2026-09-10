import { describe, expect, it, vi } from 'vitest';
import { ComposerState } from './composer.svelte';

const image = () => new File(['image'], 'test.png', { type: 'image/png' });

describe('composer image references', () => {
  it('inserts multiple references at the selection before asynchronous reads', async () => {
    const c = new ComposerState();
    c.draft = 'Compare this please';
    const loading = c.attachImages([image(), image()], 8, 12);
    expect(c.draft).toBe('Compare [IMG_1] [IMG_2] please');
    c.draft += '!';
    expect(await c.submit(vi.fn())).toBe(false);
    await loading;
    expect(c.images.map((i) => i.id)).toEqual(['IMG_1', 'IMG_2']);
    expect(c.draft).toBe('Compare [IMG_1] [IMG_2] please!');
    c.dispose();
  });

  it('preserves identifiers after removal and sends an explicit ordered mapping', async () => {
    const c = new ComposerState();
    await c.attachImages([image(), image()]);
    c.removeImage('IMG_1');
    expect(c.missingReferences).toEqual(['[IMG_1]']);
    const send = vi.fn();
    expect(await c.submit(send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    c.draft = 'Use [IMG_2] with ';
    await c.attachImages([image()]);
    expect(c.images.map((i) => i.id)).toEqual(['IMG_2', 'IMG_3']);
    expect(await c.submit(send)).toBe(true);
    expect(send).toHaveBeenCalledWith(
      'Use [IMG_2] with [IMG_3]\n\nAttached images (in order): [IMG_2], [IMG_3].',
      [expect.objectContaining({ type: 'image' }), expect.objectContaining({ type: 'image' })],
    );
    expect(c.images).toEqual([]);
    await c.attachImages([image()]);
    expect(c.images[0]?.id).toBe('IMG_1');
    c.dispose();
  });

  it('keeps attachments when text references are deleted or sending fails', async () => {
    const c = new ComposerState();
    await c.attachImages([image(), image()]);
    c.draft = 'Compare the attachments';
    expect(await c.submit(() => { throw new Error('offline'); })).toBe(false);
    expect(c.images).toHaveLength(2);
    expect(c.draft).toBe('Compare the attachments');
    c.dispose();
  });

  it('validates batches without changing the draft or existing attachments', async () => {
    const c = new ComposerState();
    await c.attachImages([image()]);
    const draft = c.draft;
    await c.attachImages(Array.from({ length: 10 }, image));
    expect(c.imageError).toContain('10');
    await c.attachImages([new File(['x'], 'bad.svg', { type: 'image/svg+xml' })]);
    expect(c.imageError).toContain('JPEG');
    await c.attachImages([new File([], 'empty.png', { type: 'image/png' })]);
    expect(c.imageError).toContain('non-empty');
    expect(c.draft).toBe(draft);
    expect(c.images).toHaveLength(1);
    c.dispose();
  });

  it('takes every clipboard image and leaves ordinary text pastes alone', async () => {
    const c = new ComposerState();
    const event = (files: File[]) => ({ clipboardData: { files } }) as unknown as ClipboardEvent;
    expect(c.pasteImage(event([new File(['text'], 'text.txt', { type: 'text/plain' })]))).toBe(false);
    c.draft = 'Before after';
    expect(c.pasteImage(event([image(), image()]), 7, 7)).toBe(true);
    expect(c.draft).toBe('Before [IMG_1] [IMG_2]after');
    await vi.waitFor(() => expect(c.imageLoading).toBe(false));
    expect(c.images).toHaveLength(2);
    c.dispose();
  });

  it('does not accidentally link restored references to new attachments', async () => {
    const c = new ComposerState();
    c.draft = 'Restored [IMG_4]';
    await c.attachImages([image()]);
    expect(c.images[0]?.id).toBe('IMG_5');
    expect(c.missingReferences).toEqual(['[IMG_4]']);
    c.dispose();
  });
});
