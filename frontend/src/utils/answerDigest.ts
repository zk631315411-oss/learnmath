/**
 * 从完整回答中提取一句可扫读的概要：
 * 去掉 markdown / LaTeX 标记后，取首个完整句子（按句末标点切分），超长截断。
 * 纯函数、零成本；后续若接入小模型生成 summary 字段，仅需替换调用处数据来源。
 */
export function answerDigest(answer: string, maxLength = 80): string {
  const plain = answer
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/[#>*`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  const firstSentence = plain.match(/^.{1,160}?[。！？!?；;](?=\s|$)/)?.[0]
    ?? plain.split(/[。！？!?；;]/)[0]
    ?? plain;
  const sentence = firstSentence.trim();
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength)}…` : sentence;
}
