import { useCallback, useReducer } from 'react';

import type { CaptureDraft } from '../components/CapturePreviewSheet';
import type { CropBBox, PendingImage, RecognizedBlock } from '../types';

export type OverlaySurface = 'none' | 'drawer' | 'capture-preview' | 'sheet-half' | 'sheet-full' | 'photo';

type Params = {
  currentPage: number;
  isDesktop: boolean;
  setOverlaySurface: (surface: OverlaySurface) => void;
  queueImage: (image: string, cropBBox: CropBBox | null, source?: PendingImage['source']) => void;
  revealDesktopChat: () => void;
};

function contentNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type CaptureFlowState = {
  isCapturing: boolean;
  captureDraft: CaptureDraft | null;
  busy: boolean;
  externalContent: { blocks: RecognizedBlock[]; nonce: string } | null;
  photoFile: File | null;
};

type CaptureFlowAction =
  | { type: 'start' }
  | { type: 'cancel' }
  | { type: 'selected'; draft: CaptureDraft }
  | { type: 'clear-draft' }
  | { type: 'busy'; value: boolean }
  | { type: 'content'; blocks: RecognizedBlock[]; nonce: string }
  | { type: 'consume-content'; nonce: string }
  | { type: 'open-photo'; file: File }
  | { type: 'close-photo' };

export const initialCaptureFlowState: CaptureFlowState = {
  isCapturing: false,
  captureDraft: null,
  busy: false,
  externalContent: null,
  photoFile: null,
};

export function captureFlowReducer(state: CaptureFlowState, action: CaptureFlowAction): CaptureFlowState {
  switch (action.type) {
    case 'start': return { ...state, isCapturing: true, captureDraft: null };
    case 'cancel': return { ...state, isCapturing: false };
    case 'selected': return { ...state, isCapturing: false, captureDraft: action.draft };
    case 'clear-draft': return { ...state, captureDraft: null };
    case 'busy': return { ...state, busy: action.value };
    case 'content': return { ...state, captureDraft: null, photoFile: null, externalContent: { blocks: action.blocks, nonce: action.nonce } };
    case 'consume-content': return state.externalContent?.nonce === action.nonce ? { ...state, externalContent: null } : state;
    case 'open-photo': return { ...state, photoFile: action.file };
    case 'close-photo': return { ...state, photoFile: null };
  }
}

export function useCaptureFlow({ currentPage, isDesktop, setOverlaySurface, queueImage, revealDesktopChat }: Params) {
  const [state, dispatch] = useReducer(captureFlowReducer, initialCaptureFlowState);

  const revealComposer = useCallback(() => {
    if (isDesktop) {
      revealDesktopChat();
      setOverlaySurface('none');
    } else {
      setOverlaySurface('sheet-half');
    }
  }, [isDesktop, revealDesktopChat, setOverlaySurface]);

  const start = useCallback(() => {
    if (state.busy) return;
    setOverlaySurface('none');
    dispatch({ type: 'start' });
  }, [setOverlaySurface, state.busy]);

  const cancel = useCallback(() => dispatch({ type: 'cancel' }), []);

  const completeSelection = useCallback((image: string, _pageRatioX: number, _pageRatioY: number, cropBBox: CropBBox) => {
    dispatch({ type: 'selected', draft: { image, cropBBox, page: currentPage } });
    setOverlaySurface('capture-preview');
  }, [currentPage, setOverlaySurface]);

  const queueCapture = useCallback(() => {
    if (!state.captureDraft) return;
    queueImage(state.captureDraft.image, state.captureDraft.cropBBox, 'pdf-capture');
    dispatch({ type: 'clear-draft' });
    revealComposer();
  }, [queueImage, revealComposer, state.captureDraft]);

  const insertContent = useCallback((blocks: RecognizedBlock[]) => {
    dispatch({ type: 'content', blocks, nonce: contentNonce() });
    revealComposer();
  }, [revealComposer]);

  const openPhoto = useCallback((file: File) => {
    dispatch({ type: 'open-photo', file });
    setOverlaySurface('photo');
  }, [setOverlaySurface]);

  const queuePhoto = useCallback((image: string) => {
    dispatch({ type: 'close-photo' });
    queueImage(image, null, 'photo');
    revealComposer();
  }, [queueImage, revealComposer]);

  const closePreview = useCallback(() => {
    dispatch({ type: 'clear-draft' });
    setOverlaySurface('none');
  }, [setOverlaySurface]);

  const reselect = useCallback(() => {
    dispatch({ type: 'clear-draft' });
    setOverlaySurface('none');
    start();
  }, [setOverlaySurface, start]);

  const closePhoto = useCallback(() => {
    dispatch({ type: 'close-photo' });
    setOverlaySurface(isDesktop ? 'none' : 'sheet-half');
  }, [isDesktop, setOverlaySurface]);

  const consumeExternalContent = useCallback((nonce: string) => {
    dispatch({ type: 'consume-content', nonce });
  }, []);

  const clearDraft = useCallback(() => dispatch({ type: 'clear-draft' }), []);
  const setBusy = useCallback((value: boolean) => dispatch({ type: 'busy', value }), []);

  return {
    ...state,
    start,
    cancel,
    completeSelection,
    queueCapture,
    insertContent,
    openPhoto,
    queuePhoto,
    closePreview,
    reselect,
    closePhoto,
    consumeExternalContent,
    clearDraft,
    setBusy,
  };
}
