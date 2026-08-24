import { useEffect, useRef, useState } from 'react';

import { recognizeFormulaContent } from '../services/api';
import type { RecognizedContent } from '../types';
import { errorMessage } from '../utils/errorMessage';

interface Options {
  /** 识别失败兜底文案（异常非 Error 或无 message 时使用） */
  fallbackMessage?: string;
  /** busy 状态变化通知（父级联动禁用等），卸载时自动回置 false */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * 公式/图片内容识别流程（框选预览与拍照预览共用）：
 * 管理 AbortController、busy/error/result 状态、取消与重置。
 * recognize 期间组件卸载或再次调用会自动中止上一次请求。
 */
export function useFormulaRecognition({ fallbackMessage = '识别失败，请重试', onBusyChange }: Options = {}) {
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RecognizedContent | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    onBusyChange?.(false);
  }, [onBusyChange]);

  const recognize = async (image: string, token?: string | null) => {
    if (!image || busy) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      setResult(await recognizeFormulaContent(image, token || undefined, controller.signal));
    } catch (recognitionError) {
      if (!controller.signal.aborted) {
        setError(errorMessage(recognitionError, fallbackMessage));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  };

  const cancelRecognition = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    onBusyChange?.(false);
  };

  /** 清空识别结果与错误（换图/重试前调用） */
  const reset = () => {
    setResult(null);
    setError('');
  };

  return { busy, error, result, recognize, cancelRecognition, reset };
}
