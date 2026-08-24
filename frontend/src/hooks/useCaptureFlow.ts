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
  /** 识别结果为单个纯公式时，走公式编辑器弹窗（而非塞输入框）。 */
  externalFormula: { latex: string; displayMode: 'inline' | 'block'; nonce: string } | null;
  /** 识别出多个公式时，作为「识别队列」传给公式编辑器逐个编辑（含单个，交互统一）。 */
  externalFormulaQueue: { formulas: { latex: string; displayMode: 'inline' | 'block' }[]; nonce: string } | null;
  photoFile: File | null;
  /** 一次性操作反馈提示（如"识别失败已转为直接提问"），显示几秒后清除。 */
  notice: string | null;
};

type CaptureFlowAction =
  | { type: 'start' }
  | { type: 'cancel' }
  | { type: 'clear-draft' }
  | { type: 'busy'; value: boolean }
  | { type: 'content'; blocks: RecognizedBlock[]; nonce: string }
  | { type: 'formula'; latex: string; displayMode: 'inline' | 'block'; nonce: string }
  | { type: 'formula-queue'; formulas: { latex: string; displayMode: 'inline' | 'block' }[]; nonce: string }
  | { type: 'consume-content'; nonce: string }
  | { type: 'consume-formula'; nonce: string }
  | { type: 'open-photo'; file: File }
  | { type: 'close-photo' }
  | { type: 'notice'; message: string | null };

export const initialCaptureFlowState: CaptureFlowState = {
  isCapturing: false,
  busy: false,
  externalContent: null,
  externalFormula: null,
  externalFormulaQueue: null,
  photoFile: null,
  notice: null,
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
    case 'formula': return { ...state, photoFile: null, busy: false, externalFormula: { latex: action.latex, displayMode: action.displayMode, nonce: action.nonce } };
    case 'formula-queue': return { ...state, photoFile: null, busy: false, externalFormulaQueue: { formulas: action.formulas, nonce: action.nonce } };
    case 'consume-content': return state.externalContent?.nonce === action.nonce ? { ...state, externalContent: null } : state;
    case 'consume-formula': return state.externalFormula?.nonce === action.nonce ? { ...state, externalFormula: null, externalFormulaQueue: null } : state;
    case 'open-photo': return { ...state, photoFile: action.file };
    case 'close-photo': return { ...state, photoFile: null, busy: false };
    case 'notice': return { ...state, notice: action.message };
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

  // 识别结果为单个纯公式：弹「插入公式」编辑器（图1），而不是塞进聊天输入框。
  const insertFormula = useCallback((latex: string, displayMode: 'inline' | 'block') => {
    dispatch({ type: 'formula', latex, displayMode, nonce: contentNonce() });
    revealComposer();
  }, [revealComposer]);

  // 识别出多个公式：把公式块作为「识别队列」传给公式编辑器，逐个编辑插入。
  const insertFormulaQueue = useCallback((formulas: { latex: string; displayMode: 'inline' | 'block' }[]) => {
    dispatch({ type: 'formula-queue', formulas, nonce: contentNonce() });
    revealComposer();
  }, [revealComposer]);

  const consumeExternalFormula = useCallback((nonce: string) => {
    dispatch({ type: 'consume-formula', nonce });
  }, []);

  // 原 CapturePreviewSheet.doRecognize 的能力：OCR 识别框选图 → 文字/公式进聊天编辑。
  // 含公式 → 抽出公式块进公式编辑器队列逐个编辑；纯文字 → 塞聊天输入框。失败回退为直接提问并提示。
  const recognizeAndEdit = useCallback(async (image: string, cropBBox: CropBBox | null) => {
    dispatch({ type: 'cancel' });
    dispatch({ type: 'busy', value: true });
    dispatch({ type: 'notice', message: null });
    try {
      const result = await recognizeFormulaContent(image, token || undefined);
      const blocks = result.blocks;
      const formulas = blocks.filter(b => b.type === 'formula').map(b => ({ latex: b.latex, displayMode: b.display_mode }));
      if (formulas.length > 0) {
        // 含公式 → 公式编辑器队列（单个也走队列，交互统一）
        insertFormulaQueue(formulas);
      } else {
        // 纯文字 → 塞聊天输入框
        insertContent(blocks);
      }
    } catch (err) {
      console.error('框选内容提取失败，回退为直接提问:', err);
      queueImage(image, cropBBox, 'pdf-capture');
      revealComposer();
      dispatch({ type: 'busy', value: false });
      dispatch({ type: 'notice', message: '识别失败（内容可能过多或过复杂），已改为直接提问' });
      setTimeout(() => dispatch({ type: 'notice', message: null }), 5000);
    }
  }, [token, insertContent, insertFormulaQueue, queueImage, revealComposer]);

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
    insertFormula,
    insertFormulaQueue,
    openPhoto,
    queuePhoto,
    closePhoto,
    consumeExternalContent,
    consumeExternalFormula,
    clearDraft,
    setBusy,
  };
}
