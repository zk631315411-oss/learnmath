import { describe, expect, it } from 'vitest';

import { captureFlowReducer, initialCaptureFlowState } from './useCaptureFlow';

describe('captureFlowReducer', () => {
  it('moves recognized blocks into external content and consumes by nonce', () => {
    const started = captureFlowReducer(initialCaptureFlowState, { type: 'start' });
    expect(started.isCapturing).toBe(true);
    const cancelled = captureFlowReducer(started, { type: 'cancel' });
    expect(cancelled.isCapturing).toBe(false);
    const recognized = captureFlowReducer(cancelled, {
      type: 'content', blocks: [{ type: 'formula', latex: 'x^2', display_mode: 'inline' }], nonce: 'n1',
    });
    expect(recognized.externalContent?.nonce).toBe('n1');
    expect(captureFlowReducer(recognized, { type: 'consume-content', nonce: 'other' })).toBe(recognized);
    expect(captureFlowReducer(recognized, { type: 'consume-content', nonce: 'n1' }).externalContent).toBeNull();
  });

  it('resets busy on every exit path so interactionLocked cannot leak', () => {
    const busyState = { ...initialCaptureFlowState, isCapturing: true, busy: true };
    expect(captureFlowReducer(busyState, { type: 'cancel' }).busy).toBe(false);
    expect(captureFlowReducer(busyState, { type: 'clear-draft' }).busy).toBe(false);
    expect(captureFlowReducer(busyState, { type: 'close-photo' }).busy).toBe(false);
    expect(captureFlowReducer(busyState, {
      type: 'content', blocks: [], nonce: 'n1',
    }).busy).toBe(false);
  });
});
