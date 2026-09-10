/**
 * "Type anywhere" support: decides whether a keystroke or paste made outside any field should
 * be routed to the composer. Modifier shortcuts, IME composition, focused fields and open
 * dialogs are left alone.
 */

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** The printable character a keystroke would insert, or null when it is not plain typing. */
export function typedCharacter(event: KeyboardEvent): string | null {
  if (event.defaultPrevented || event.isComposing || event.repeat) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key.length !== 1) return null;
  return event.key;
}

/** True while a modal dialog is open anywhere on the page. */
export function dialogOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}

/** Whether a stray keystroke should go to the composer. `blocked` covers page-level overlays. */
export function shouldCapture(event: KeyboardEvent, blocked: () => boolean): string | null {
  if (isEditableTarget(event.target) || dialogOpen() || blocked()) return null;
  return typedCharacter(event);
}

/** Whether a paste outside any field should go to the composer. */
export function shouldCapturePaste(event: ClipboardEvent, blocked: () => boolean): boolean {
  return !isEditableTarget(event.target) && !dialogOpen() && !blocked();
}
