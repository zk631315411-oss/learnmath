import { useCallback, useReducer } from 'react';

import { recognizeFormulaContent } from '../services/api';
import type { CropBBox, PendingImage, RecognizedBlock } from '../types';

export type OverlaySurface = 'none' | 'drawer' | 'sheet-half' | 'sheet-full' | 'photo';

type Params = {
  isDesktop: boolean;
  /** 登录态 token，用于框选「提取编辑」的 OCR 请求 */
  token?: string | null;
  setOverlaySurface: (surface: OverlaySurface) => void;
  queueImage: (image: string, cropBBox: CropBBox | null, source?: PendingImage['source']) => void;
  revealDesktopChat: () => void;
};

function contentNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type CaptureFlowState = {
  isCapturing: boolean;
  busy: boolean;
  externalContent: { blocks: RecognizedBlock[]; nonce: string } | null;
  photoFile: File | null;
};

type CaptureFlowAction =
  | { type: 'start' }
  | { type: 'cancel' }
  | { type: 'clear-draft' }
  | { type: 'busy'; value: boolean }
  | { type: 'content'; blocks: RecognizedBlock[]; nonce: string }
  | { type: 'consume-content'; nonce: string }
  | { type: 'open-photo'; file: File }
  | { type: 'close-photo' };

export const initialCaptureFlowState: CaptureFlowState = {
  isCapturing: false,
  busy: false,
  externalContent: null,
  photoFile: null,
};

export function captureFlowReducer(state: CaptureFlowState, action: CaptureFlowAction): CaptureFlowState {
  switch (action.type) {
    case 'start': return { ...state, isCapturing: true };
    // busy 是提取中标记；任何退出截图/取消的路径都必须复位，
    // 否则 interactionLocked 会永久锁死跳页、返回地图等基础导航。
    case 'cancel': return { ...state, isCapturing: false, busy: false };
    case 'clear-draft': return { ...state, busy: false };
    case 'busy': return { ...state, busy: action.value };
    case 'content': return { ...state, photoFile: null, busy: false, externalContent: { blocks: action.blocks, nonce: action.nonce } };
    case 'consume-content': return state.externalContent?.nonce === action.nonce ? { ...state, externalContent: null } : state;
    case 'open-photo': return { ...state, photoFile: action.file };
    case 'close-photo': return { ...state, photoFile: null, busy: false };
  }
}

export function useCaptureFlow({ isDesktop, token, setOverlaySurface, queueImage, revealDesktopChat }: Params) {
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

  // 方案 A1：框选确认区直接给「提问/提取编辑」，不再落草稿弹预览卡片。
  // queueCapture 由框选层携带截图结果直接调用（桌面 handleConfirm / 移动端 ImageCropper）。
  const queueCapture = useCallback((image: string, cropBBox: CropBBox | null) => {
    dispatch({ type: 'cancel' });
    queueImage(image, cropBBox, 'pdf-capture');
    revealComposer();
  }, [queueImage, revealComposer]);

  const insertContent = useCallback((blocks: RecognizedBlock[]) => {
    dispatch({ type: 'content', blocks, nonce: contentNonce() });
    revealComposer();
  }, [revealComposer]);

  // 原 CapturePreviewSheet.doRecognize 的能力：OCR 识别框选图 → 文字/公式进聊天编辑。
  // 识别失败回退为直接提问（图进待发区），保证用户操作不丢。
  const recognizeAndEdit = useCallback(async (image: string, cropBBox: CropBBox | null) => {
    dispatch({ type: 'cancel' });
    dispatch({ type: 'busy', value: true });
    try {
      const result = await recognizeFormulaContent(image, token || undefined);
      insertContent(result.blocks);
    } catch (err) {
      console.error('框选内容提取失败，回退为直接提问:', err);
      queueImage(image, cropBBox, 'pdf-capture');
      revealComposer();
      dispatch({ type: 'busy', value: false });
    }
  }, [token, insertContent, queueImage, revealComposer]);

  const openPhoto = useCallback((file: File) => {
    dispatch({ type: 'open-photo', file });
    setOverlaySurface('photo');
  }, [setOverlaySurface]);

  const queuePhoto = useCallback((image: string) => {
    dispatch({ type: 'close-photo' });
    queueImage(image, null, 'photo');
    revealComposer();
  }, [queueImage, revealComposer]);

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
    queueCapture,
    recognizeAndEdit,
    insertContent,
    openPhoto,
    queuePhoto,
    closePhoto,
    consumeExternalContent,
    clearDraft,
    setBusy,
  };
}
