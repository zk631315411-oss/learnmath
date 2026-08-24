# -*- coding: utf-8 -*-
"""
全量离线 OCR 跑批：4 本扫描版教材 PDF → 每行 (page, bbox, text) 的 JSONL。

- 渲染: PyMuPDF 150dpi
- OCR: RapidOCR (PP-OCRv6)，优先 CUDAExecutionProvider（GPU），不可用降级 CPU
- bbox: 像素坐标 × 72/150 换算回 PDF 点
- 输出: D:/LearnMath/shared/ocr/<textbook_id>.ocr_lines.jsonl
  每行 JSON: {"page": <1起物理页>, "bbox": [x0,y0,x1,y1], "text": "..."}
- 断点续跑: 先读已有 jsonl 收集已完成页码，跳过；逐页 append + flush
- 健壮: 单页失败记日志并跳过，不中断整本

用法: python ocr_batch.py [--only gaodai_shang] [--dpi 150]
"""
import argparse
import json
import os
import sys
import time
import traceback

import fitz

OUT_DIR = "D:/LearnMath/shared/ocr"
LOG_DIR = "D:/LearnMath/shared/ocr/logs"
DPI = 150
SCALE = DPI / 72.0

BOOKS = [
    ("gaodai_shang", "D:/LearnMath/data/textbooks/gaodai_vol1.pdf"),
    ("gaodai_xia",   "D:/LearnMath/data/textbooks/高等代数下册_丘维声.pdf"),
    ("gaoshu_shang", "D:/LearnMath/data/textbooks/高等数学第二版上册黄立宏主编.pdf"),
    ("gaoshu_xia",   "D:/LearnMath/data/textbooks/高等数学第二版下册黄立宏主编.pdf"),
]


def log(logf, msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    logf.write(line + "\n")
    logf.flush()


def build_ocr():
    """构建 RapidOCR，优先 GPU。返回 (ocr, engine_desc)"""
    try:
        import onnxruntime as ort
        ort.preload_dlls()  # 加载 pip 装的 nvidia CUDA13/cuDNN9 DLL，使 CUDA EP 可用
        providers = ort.get_available_providers()
    except Exception:
        providers = []
    use_gpu = "CUDAExecutionProvider" in providers

    from rapidocr import RapidOCR
    # rapidocr 3.x: params 覆盖 config.yaml，onnxruntime 引擎开 CUDA
    params = {"EngineConfig.onnxruntime.use_cuda": use_gpu}
    ocr = RapidOCR(params=params)
    desc = f"rapidocr3 onnxruntime use_cuda={use_gpu}"
    return ocr, desc, providers


def load_done_pages(jsonl_path):
    done = set()
    if not os.path.exists(jsonl_path):
        return done
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                done.add(json.loads(line)["page"])
            except Exception:
                continue
    return done


def ocr_one_book(book_id, pdf_path, ocr, dpi, logf):
    jsonl_path = os.path.join(OUT_DIR, f"{book_id}.ocr_lines.jsonl")
    scale = dpi / 72.0
    doc = fitz.open(pdf_path)
    n_pages = doc.page_count
    done = load_done_pages(jsonl_path)
    todo = [pi for pi in range(n_pages) if (pi + 1) not in done]
    log(logf, f"== {book_id}: 共{n_pages}页, 已完成{len(done)}页, 待跑{len(todo)}页 ==")

    fail_pages = []
    t0 = time.time()
    with open(jsonl_path, "a", encoding="utf-8") as out:
        for k, pi in enumerate(todo):
            page_no = pi + 1
            try:
                pix = doc[pi].get_pixmap(dpi=dpi)
                img_bytes = pix.tobytes("png")
                res = ocr(img_bytes)
                lines = []
                if res is not None and getattr(res, "boxes", None) is not None:
                    for box, txt in zip(res.boxes, res.txts):
                        xs = [float(pt[0]) for pt in box]
                        ys = [float(pt[1]) for pt in box]
                        bbox = [min(xs) / scale, min(ys) / scale,
                                max(xs) / scale, max(ys) / scale]
                        lines.append((bbox, str(txt)))
                    lines.sort(key=lambda t: (t[0][1], t[0][0]))
                if not lines:
                    # 空页（封面/空白页）写一个占位记录，避免断点续跑重跑
                    out.write(json.dumps({"page": page_no, "bbox": [0, 0, 0, 0],
                                          "text": "", "empty": True},
                                         ensure_ascii=False) + "\n")
                else:
                    for bbox, txt in lines:
                        out.write(json.dumps({"page": page_no,
                                              "bbox": [round(v, 2) for v in bbox],
                                              "text": txt},
                                             ensure_ascii=False) + "\n")
                out.flush()
            except Exception as e:
                fail_pages.append(page_no)
                log(logf, f"  [FAIL] {book_id} p{page_no}: {e}")
                log(logf, traceback.format_exc(limit=2))
                # 失败页也写占位，防止每次重启反复重试坏页
                out.write(json.dumps({"page": page_no, "bbox": [0, 0, 0, 0],
                                      "text": "", "failed": True},
                                     ensure_ascii=False) + "\n")
                out.flush()
            if (k + 1) % 20 == 0 or k == len(todo) - 1:
                el = time.time() - t0
                spd = (k + 1) / el if el > 0 else 0
                eta = (len(todo) - k - 1) / spd if spd > 0 else 0
                log(logf, f"  {book_id} 进度 {k+1}/{len(todo)} "
                          f"({spd:.2f}页/s, ETA {eta/60:.1f}min)")
    doc.close()
    el = time.time() - t0
    log(logf, f"== {book_id} 完成: 本次跑{len(todo)}页, 失败{len(fail_pages)}页, "
              f"耗时{el/60:.1f}min, 失败页={fail_pages[:50]} ==")
    return {"book": book_id, "pages": n_pages, "ran": len(todo),
            "failed": fail_pages, "secs": round(el, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="只跑某本，如 gaodai_shang")
    ap.add_argument("--dpi", type=int, default=DPI)
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)
    logf = open(os.path.join(LOG_DIR, f"ocr_batch_{time.strftime('%Y%m%d_%H%M%S')}.log"),
                "w", encoding="utf-8")

    log(logf, "构建 OCR 引擎...")
    ocr, desc, providers = build_ocr()
    log(logf, f"引擎: {desc}; onnxruntime providers={providers}")

    t_all = time.time()
    summary = []
    for book_id, pdf_path in BOOKS:
        if args.only and book_id != args.only:
            continue
        if not os.path.exists(pdf_path):
            log(logf, f"[SKIP] {book_id}: 找不到 {pdf_path}")
            continue
        summary.append(ocr_one_book(book_id, pdf_path, ocr, args.dpi, logf))
    total_min = (time.time() - t_all) / 60
    log(logf, f"全部完成, 总耗时 {total_min:.1f} min")
    log(logf, "SUMMARY " + json.dumps(summary, ensure_ascii=False))
    logf.close()


if __name__ == "__main__":
    main()
