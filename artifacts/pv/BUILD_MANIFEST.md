# PV V3.6 构建清单

## 成片

| 字段 | 值 |
|---|---|
| 文件 | `学数有道-PV-v3.6.mp4` |
| 时长 | 97.000 秒 |
| 视频 | H.264，1920×1080，30fps |
| 音频 | AAC，44.1kHz，单声道 |
| 文件大小 | 7,488,840 bytes |
| SHA-256 | `2496D0138AC2D1C6CCF2001D54465CC7BBC7819482EF48129A6154535C2BA693` |

`学数有道-PV.mp4` 是当前便捷副本，SHA-256 与上述正式版一致。

## V3.6 独有输入

| 文件 | SHA-256 |
|---|---|
| `source/v3.6/evidence-pre.png` | `15C92BA15107DD95809F282248DDFF3A52FB81F76E59B62D0B2E373D2B9640C3` |
| `source/v3.6/evidence-post.png` | `CD2A4A464AC8C7F0236200D35CFB427BF83840A681FF3BEDCBCE888C577CB5EB` |
| `source/v3.6/manim-card-desktop.png` | `209B9940B0C426A59E900A4DC156937568634672B3A0013773A09A9B9FE57678` |
| `source/v3.6/quiz-round4.webm` | `56DBDEB21F9DF0B9C4C3A17534A265B3E8FF896EA1C4D932864EF38FD63FCC4E` |
| `source/v3.6/request-typing.webm` | `50F304BDB30A09C6B35087A04519D53291826D0A03CF7CD17921E7ACA34CCD11` |

其他正式输入由构建脚本从以下目录读取：

- `artifacts/pv-reality/formal-recording/`
- `artifacts/pv-reality/v3-browser-assets/`
- `artifacts/pv/hook/`
- `artifacts/pv/animation/`
- `artifacts/pv/character/cutout/`
- `artifacts/pv/voice/xiaoyi/`

## 复现

从仓库根目录执行：

```powershell
python scripts/build_pv_v33.py all
```

脚本使用 `imageio_ffmpeg` 提供的 FFmpeg，并需要 Pillow。中文合成标题优先读取环境变量 `DAIMON_CJK_FONT_REGULAR` 指向的字体。
