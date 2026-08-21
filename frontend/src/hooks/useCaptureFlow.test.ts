import { describe, expect, it } from 'vitest';

import { captureFlowReducer, initialCaptureFlowState } from './useCaptureFlow';

describe('captureFlowReducer', () => {
  it('moves a capture from selection into an external content draft', () => {
    const started = captureFlowReducer(initialCaptureFlowState, { type: 'start' });
    expect(started.isCapturing).toBe(true);
    const selected = captureFlowReducer(started, {
      type: 'selected',
      draft: { image: 'data:image/png;base64,x', cropBBox: { x: 0, y: 0, width: 1, height: 1 }, page: 7 },
    });
    expect(selected).toMatchObject({ isCapturing: false, captureDraft: { page: 7 } });
    const recognized = captureFlowReducer(selected, {
      type: 'content', blocks: [{ type: 'formula', latex: 'x^2', display_mode: 'inline' }], nonce: 'n1',
    });
    expect(recognized.captureDraft).toBeNull();
    expect(recognized.externalContent?.nonce).toBe('n1');
    expect(captureFlowReducer(recognized, { type: 'consume-content', nonce: 'other' })).toBe(recognized);
    expect(captureFlowReducer(recognized, { type: 'consume-content', nonce: 'n1' }).externalContent).toBeNull();
  });
});
