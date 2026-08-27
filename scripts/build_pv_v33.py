# build_pv_v33.py — V3.6 正式版构建脚本（保留历史文件名）
# V3.4: 04b 改三拍结构（FORMAL 追问 → 补录学生作答 → 补录系统确认），
#       05b 聚焦锚点改钳位居中并加深到 3.2x，07 证据段叠化延长到 2.6s。
# V3.3 修订版（导演 6 条意见）
# 1) hook 重剪提速去黑场（4 段拼接：快入→生成→流出→定格缓推）
# 2) 17s 黑场消除（hook 不再淡出，定格到切 02a）
# 3) 03 段换 2.1 梯子前态图（烘焙红框+标题）+ 新增配音 03-map
# 4) 04 段跳剪 FORMAL 48→50 死区，探测题 39s 前亮相，BOX_PROBE 重定时
# 5) 05b 换 Edge headless 桌面 1920x1080 真实卡片截图（manim-card-desktop.png）
# 6) 片尾配音 -8% 速率重录，混音改 volume=1.25+alimiter+尾渐弱
# 用法: python scripts/build_pv_v33.py [clips|concat|final|all]
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
# Resolve the repository root from this script so local rebuilds do not depend
# on a particular checkout drive or directory.
ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / ".runtime-dev" / "pv-v3"
CLIPS = WORK / "clips33"
FRAMES = WORK / "frames"
OUTDIR = ROOT / "artifacts" / "pv"
VOICE = OUTDIR / "voice"
CHARS = OUTDIR / "character" / "cutout"
PV_REALITY = ROOT / "artifacts" / "pv-reality"
V3A = PV_REALITY / "v3-browser-assets"
SOURCE = OUTDIR / "source" / "v3.6"

FORMAL = PV_REALITY / "formal-recording" / "formal-recording.webm"
HOOK = OUTDIR / "hook" / "hook-preview.mp4"
HOOK_HOLD = OUTDIR / "hook" / "hook-answer-frame.png"
MANIM = OUTDIR / "animation" / "animation-manim-formal.mp4"
S3 = V3A / "s3-home-needs-review.webm"
S4 = V3A / "s4-kg-card-expanded.webm"
MAP_PRE_RAW = V3A / "s2-pre-nixushu-learning.png"          # 2.1 梯子：逆序数 学习中
MAP_PRE = FRAMES / "map-pre-composite.png"                 # 烘焙红框+标题
EV_PRE = SOURCE / "evidence-pre.png"
EV_POST = SOURCE / "evidence-post.png"
CARD_RAW = SOURCE / "manim-card-desktop.png"               # 桌面 1920x1080 真实截图
CARD_COMP = FRAMES / "manim-card-desktop-box.png"          # 烘焙红框
ANSWER2 = WORK / "frames" / "answer-round2.webm"              # 方案 C 补录（弃用：穿帮）
QUIZ4 = SOURCE / "quiz-round4.webm"                         # 新线程第 4 轮：问→答→确认零穿帮
REQUEST = SOURCE / "request-typing.webm"                    # 新线程：动画请求草稿（只打字不发送）
BRAND = OUTDIR / "brand-card.png"
ASS = OUTDIR / "pv-subtitles-v3.6.ass"
MASTER = WORK / "pv-v3.6-master.mp4"
FINAL = OUTDIR / "学数有道-PV-v3.6.mp4"

TOTAL = 97.0

# ---------------- 时间码（秒） ----------------
SEGMENTS = [
    ("01a-hook-q",      1.25),   #  0.00- 1.25  面板快入+问句
    ("01b-hook-gen",    1.00),   #  1.25- 2.25  正在生成（压缩）
    ("01c-hook-ans",    2.00),   #  2.25- 4.25  答案流出
    ("01d-hook-hold",  10.25),   #  4.25-14.50  答案定格缓推（L1+L2 旁白）
    ("02a-locate",      2.50),   # 14.50-17.00  提问→正在分析
    ("02b-kgcard",      6.20),   # 17.00-23.20  KG 卡片展开
    ("03-map-pre",      4.50),   # 23.20-27.70  2.1 梯子：逆序数 学习中
    ("04a-dialogue",    8.00),   # 27.70-35.70  学生答→讲解流式 2x
    ("04b-dialogue",   12.00),   # 35.70-47.70  下拉出追问→学生作答（Q→A 双框）
    ("05-transition",   4.00),   # 47.70-51.70  过场（真实输入框问句）
    ("05b-card",        4.00),   # 51.70-55.70  Manim 卡片→点开
    ("06-manim",       11.50),   # 55.70-67.20  Manim 全屏
    ("07-evidence",    12.00),   # 67.20-79.20  双节点分屏同步叠化（xf 2.6s）
    ("10-flash",        0.30),   # 79.20-79.50  白闪
    ("11-s3-home",      9.00),   # 79.50-88.50  首页→需要巩固
    ("12-brand",        8.50),   # 88.50-97.00  品牌卡
]
STARTS = {}
_t = 0.0
for _n, _d in SEGMENTS:
    STARTS[_n] = _t
    _t += _d
assert abs(_t - TOTAL) < 1e-6, _t

# 配音: (文件, delay秒) — edge-tts XiaoyiNeural
VOICES = [
    ("xiaoyi/01a-hook-l1.mp3",   4.80),   # 这个回答没有错…(3.79s)
    ("xiaoyi/01b-hook-l2.mp3",   9.20),   # 但学习不只是听一遍答案…(6.12s)
    ("xiaoyi/02-locate.mp3",    17.60),   # 同一个问题…先定位知识点…(6.62s)
    ("xiaoyi/03-map.mp3",       24.60),   # 学习地图上，逆序数还标着学习中。(3.82s)
    ("xiaoyi/03-dialogue.mp3",  30.20),   # 学生的回答，决定下一步先讲哪里。(3.77s)
    ("xiaoyi/04-check.mp3",     36.60),   # 用一道小题，确认学生掌握情况。(3.79s)
    ("xiaoyi/05-transition.mp3", 48.40),  # 文字讲了一遍，眼睛再看一遍。(3.34s)
    ("xiaoyi/06-animation.mp3", 52.50),   # 小狸，让讲解不止于文字。(3.31s)
    ("xiaoyi/07-evidence.mp3",  69.20),   # 对话成为地图更新的证据…(6.53s)
    ("xiaoyi/08-continuity.mp3", 81.00),  # 下次回来，系统还记得你学到哪里。(3.91s)
    ("xiaoyi/09-ending.mp3",    90.80),   # 学数有道，你的 AI 数学导师。(4.13s, -8%)
]

# 字幕: (起, 止, 文本)
SUBS = [
    ( 4.80,  8.60, "这个回答没有错，甚至已经讲得很完整。"),
    ( 9.20, 15.40, "但学习不只是听一遍答案。不同的学生，学习情况可能不同。"),
    (17.60, 24.40, "同一个问题，学数有道先定位知识点，再读取相关节点的学习记录。"),
    (24.60, 28.40, "学习地图上，逆序数还标着学习中。"),
    (30.20, 34.00, "学生的回答，决定下一步先讲哪里。"),
    (36.60, 40.40, "用一道小题，确认学生掌握情况。"),
    (48.40, 51.60, "文字讲了一遍，眼睛再看一遍。"),
    (52.50, 55.80, "小狸，让讲解不止于文字。"),
    (69.20, 75.70, "对话成为地图更新的证据。地图上的状态，决定下一步从哪教起。"),
    (81.00, 85.00, "下次回来，系统还记得你学到哪里。"),
    (93.20, 96.70, "把每道题放回知识体系，把每次学习留在学习地图上。"),  # 纯字幕
]

# 小狸姿态窗口
FOX = [
    ("explaining-r.png", 11.00, 67.20),
    ("recording.png",    67.20, 79.50),
    ("standing.png",     79.50, 88.50),
    ("thumbs-up.png",    88.50, 97.00),
]

# 红框（drawbox，作用于各自片段内时间轴）
BOX_KG = "drawbox=x=1545:y=210:w=370:h=435:c=red@0.85:t=4:enable='between(t,1.5,5.5)'"
# 04b 拍1（新线程 132→123 追问，z=4 右锚）：框住三行追问
BOX_Q = "drawbox=x=400:y=165:w=1420:h=370:c=red@0.85:t=4:enable='between(t,1.0,2.9)'"
# 04b 拍3b（系统确认，z=1.4 ay=0.973）：框住判语“对，交换一个对换会改变排列的奇偶性…”
BOX_C = "drawbox=x=1385:y=405:w=480:h=105:c=red@0.85:t=4:enable='between(t,0.5,3.4)'"
BOX_S3 = "drawbox=x=250:y=118:w=270:h=46:c=red@0.9:t=4:enable='between(t,5.3,8.8)'"


def run(args, **kw):
    subprocess.run([FF, *args], check=True, **kw)


def render_clip(name, src, ss, src_dur, tgt_dur, extra=None):
    tgt = CLIPS / f"{name}.mp4"
    speed = src_dur / tgt_dur
    vf = (f"trim=duration={src_dur},setpts=(PTS-STARTPTS)/{speed},"
          f"trim=duration={tgt_dur},setpts=PTS-STARTPTS,"
          f"scale=1920:1080:force_original_aspect_ratio=decrease,"
          f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30")
    if extra:
        vf += "," + extra
    run(["-hide_banner", "-loglevel", "error", "-y", "-ss", str(ss), "-i", str(src),
         "-an", "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-r", "30", str(tgt)])
    return tgt


def zoom_still_clip(name, src, dur, z0, z1, ax, ay, extra=None):
    tgt = CLIPS / f"{name}.mp4"
    frames = int(round(dur * 30))
    vf = (f"scale=5760:3240:flags=lanczos,"
          f"zoompan=z='{z0}+({z1}-{z0})*on/{frames}':"
          f"x='{ax}*(iw-iw/zoom)':y='{ay}*(ih-ih/zoom)':d=1:fps=30:s=1920x1080,setsar=1")
    if extra:
        vf += "," + extra
    run(["-hide_banner", "-loglevel", "error", "-y", "-framerate", "30", "-loop", "1",
         "-i", str(src), "-t", str(dur), "-an", "-vf", vf,
         "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
         "-r", "30", str(tgt)])
    return tgt


def video_zoom_clip(name, src, ss, src_dur, tgt_dur, zmax, ax, ay, zoom_in_frames, extra=None):
    tgt = CLIPS / f"{name}.mp4"
    speed = src_dur / tgt_dur
    vf = (f"trim=duration={src_dur},setpts=(PTS-STARTPTS)/{speed},"
          f"trim=duration={tgt_dur},setpts=PTS-STARTPTS,fps=30,"
          f"scale=3840:2160:flags=lanczos,"
          f"zoompan=z='min(1+({zmax}-1)*on/{zoom_in_frames},{zmax})':"
          f"x='{ax}*(iw-iw/zoom)':y='{ay}*(ih-ih/zoom)':d=1:fps=30:s=1920x1080,setsar=1")
    if extra:
        vf += "," + extra
    run(["-hide_banner", "-loglevel", "error", "-y", "-ss", str(ss), "-i", str(src),
         "-an", "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-r", "30", str(tgt)])
    return tgt


def video_zfix_clip(name, src, ss, src_dur, tgt_dur, z, x_expr, y_expr, extra=None):
    """定焦推镜：整个片段固定倍率 z，锚点表达式为 zoompan 的 x/y。
    起点用 trim=start 实现（webm 无 Duration 元数据，-ss 输出侧会吞帧）。"""
    tgt = CLIPS / f"{name}.mp4"
    speed = src_dur / tgt_dur
    vf = (f"trim=start={ss}:duration={src_dur},setpts=(PTS-STARTPTS)/{speed},"
          f"trim=duration={tgt_dur},setpts=PTS-STARTPTS,fps=30,"
          f"scale=3840:2160:flags=lanczos,"
          f"zoompan=z='{z}':x='{x_expr}':y='{y_expr}':d=1:fps=30:s=1920x1080,setsar=1")
    if extra:
        vf += "," + extra
    run(["-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
         "-an", "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-r", "30", str(tgt)])
    return tgt


def build_04b():
    """04b 四拍（12.0s），全部取自新线程第 4 轮连续录屏（quiz-round4.webm）：
    追问定格 → 打字发送 → 确认流出 → 确认定格。τ(321)/τ(132) 错位段在取景窗外。"""
    subs = []
    # 拍1 (3.0s)：发送前定格，z=4 推近到 132→123 追问，红框亮起
    subs.append(video_zfix_clip("04b-s1", QUIZ4, 0.0, 1.5, 3.0, "4.0",
                                "iw-iw/zoom", "ih-ih/zoom", extra=BOX_Q))
    # 拍2 (3.5s)：打字→发送→气泡弹出，z=2.1（语境：R3 确认尾行可见）
    subs.append(video_zfix_clip("04b-s2", QUIZ4, 2.5, 3.5, 3.5, "2.1",
                                "iw-iw/zoom", "0.99*(ih-ih/zoom)"))
    # 拍3a (2.0s)：确认流出（KG 卡+已思考收起，判语逐行到来）
    subs.append(video_zfix_clip("04b-s3a", QUIZ4, 17.0, 3.6, 2.0, "1.4",
                                "iw-iw/zoom", "0.973*(ih-ih/zoom)"))
    # 拍3b (3.5s)：确认定格+留白问题，红框圈住判语
    subs.append(video_zfix_clip("04b-s3b", QUIZ4, 22.0, 10.0, 3.5, "1.4",
                                "iw-iw/zoom", "0.973*(ih-ih/zoom)", extra=BOX_C))
    lst = WORK / "concat04b.txt"
    lst.write_text("".join(f"file '{s.as_posix()}'\n" for s in subs), encoding="ascii")
    run(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
         "-i", str(lst), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-r", "30", str(CLIPS / "04b-dialogue.mp4")])


def make_map_pre_composite():
    """03：2.1 梯子前态图，烘焙红框（逆序数 学习中）+ 标题"""
    import os
    from PIL import Image, ImageDraw, ImageFont
    img = Image.open(MAP_PRE_RAW).convert("RGB")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([824, 542, 976, 598], radius=10, outline=(214, 48, 49), width=5)
    font_path = os.environ.get("DAIMON_CJK_FONT_REGULAR")
    f = ImageFont.truetype(font_path, 34) if font_path else ImageFont.load_default()
    d.text((660, 120), "学习地图 · 2.1 n元排列", font=f, fill=(90, 70, 55))
    img.save(MAP_PRE)
    print("map-pre composite saved")


def make_card_composite():
    """05b：桌面截图烘焙红框，圈出整张 Manim 卡片（标题+视频+说明）"""
    from PIL import Image, ImageDraw
    img = Image.open(CARD_RAW).convert("RGB")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([1562, 660, 1890, 955], radius=14, outline=(214, 48, 49), width=6)
    img.save(CARD_COMP)
    print("card composite saved")


def card_open_clip(name, dur=4.0):
    """05b：全景 1.2s → 推入视频区 1.6s → 停 1.2s，尾淡出 0.2s 接 Manim。
    锚点钳位居中：推镜终点把视频卡片(中心 0.9,0.744)尽量放到画面中心。"""
    tgt = CLIPS / f"{name}.mp4"
    z = ("1+if(lt(on,36),0,"
         "if(lt(on,84),2.2*(on-36)/48,2.2))")   # z: 1 → 3.2
    vf = (f"scale=5760:3240:flags=lanczos,"
          f"zoompan=z='{z}':"
          f"x='max(0\\,min((0.9-0.5/zoom)*iw\\,iw-iw/zoom))':"
          f"y='max(0\\,min((0.744-0.5/zoom)*ih\\,ih-ih/zoom))':"
          f"d=1:fps=30:s=1920x1080,setsar=1,fade=t=out:st={dur - 0.2}:d=0.2")
    run(["-hide_banner", "-loglevel", "error", "-y", "-framerate", "30", "-loop", "1",
         "-i", str(CARD_COMP), "-t", str(dur), "-an", "-vf", vf,
         "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
         "-r", "30", str(tgt)])
    return tgt


def evidence_clip(name, dur=12.0, hold_pre=3.6, xf=2.6):
    tgt = CLIPS / f"{name}.mp4"
    pre_t = hold_pre + xf
    post_t = dur - hold_pre
    fc = (f"[0:v][1:v]xfade=transition=fade:duration={xf}:offset={hold_pre},"
          f"fps=30,setsar=1")
    run(["-hide_banner", "-loglevel", "error", "-y",
         "-framerate", "30", "-loop", "1", "-t", str(pre_t), "-i", str(EV_PRE),
         "-framerate", "30", "-loop", "1", "-t", str(post_t), "-i", str(EV_POST),
         "-filter_complex", fc, "-an",
         "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
         "-r", "30", "-t", str(dur), str(tgt)])
    return tgt


def flash_clip(name, dur=0.3):
    tgt = CLIPS / f"{name}.mp4"
    run(["-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"color=c=white:s=1920x1080:r=30:d={dur}",
         "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-r", "30", str(tgt)])
    return tgt


def brand_clip(name, dur):
    tgt = CLIPS / f"{name}.mp4"
    vf = ("scale=1920:1080,setsar=1,fps=30,"
          f"fade=t=in:st=0:d=0.4,fade=t=out:st={dur - 0.6}:d=0.6")
    run(["-hide_banner", "-loglevel", "error", "-y", "-framerate", "30", "-loop", "1",
         "-i", str(BRAND), "-t", str(dur), "-an", "-vf", vf,
         "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
         "-r", "30", str(tgt)])
    return tgt


def make_ass():
    def ts(t):
        h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
        return f"{h}:{m:02d}:{s:05.2f}"
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Microsoft YaHei,44,&H00FFFFFF,&H00FFFFFF,&H00161616,&H66000000,0,0,0,0,100,100,0,0,1,3,1,2,120,120,62,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for st, et, text in SUBS:
        lines.append(f"Dialogue: 0,{ts(st)},{ts(et)},Default,,0,0,0,,{text}")
    ASS.write_text("\n".join(lines) + "\n", encoding="utf-8")


def step_clips():
    CLIPS.mkdir(parents=True, exist_ok=True)
    # 01 hook 四段重剪：源 0-2.5s 黑场淡入跳过；9.4s 后淡出尾巴整段弃用
    render_clip("01a-hook-q", HOOK, 2.5, 2.5, 1.25, extra="fade=t=in:st=0:d=0.3")
    render_clip("01b-hook-gen", HOOK, 5.0, 2.2, 1.00)
    render_clip("01c-hook-ans", HOOK, 7.2, 2.2, 2.00)
    zoom_still_clip("01d-hook-hold", HOOK_HOLD, 10.25, 1.0, 1.0, 0.5, 0.5)
    render_clip("02a-locate", FORMAL, 3, 10.0, 2.5)
    render_clip("02b-kgcard", S4, 8.3, 6.2, 6.2, extra=BOX_KG)
    make_map_pre_composite()
    zoom_still_clip("03-map-pre", MAP_PRE, 4.5, 1.0, 1.12, 0.469, 0.528)
    # 04a：学生答→讲解流式，提速到 2.5x（8.0s）
    render_clip("04a-dialogue", FORMAL, 28, 20.0, 8.0)
    # 04b：三拍结构（FORMAL 追问 → 补录作答 → 补录确认），共 12.0s
    build_04b()
    # 05：新线程打字草稿（只打不发），2.2s 起（打字前 0.3s 衔接 04b），1.35x，轻推至输入框
    video_zfix_clip("05-transition", REQUEST, 2.2, 5.4, 4.0, 1.15, "0.99*(iw-iw/zoom)", "0.99*(ih-ih/zoom)")
    make_card_composite()
    card_open_clip("05b-card", 4.0)
    render_clip("06-manim", MANIM, 0, 10.53, 11.5,
                extra="fade=t=in:st=0:d=0.2")
    evidence_clip("07-evidence", 12.0, 3.6, 2.6)
    flash_clip("10-flash", 0.3)
    video_zoom_clip("11-s3-home", S3, 0.6, 7.44, 9.0, 1.25, 0.27, 0.13, 150,
                    extra=BOX_S3)
    brand_clip("12-brand", 8.5)


def step_concat():
    lst = WORK / "concat33.txt"
    lst.write_text("".join(f"file '{(CLIPS / (n + '.mp4')).as_posix()}'\n" for n, _ in SEGMENTS),
                   encoding="ascii")
    run(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
         "-i", str(lst), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", str(MASTER)])


def step_final():
    make_ass()
    inputs = ["-i", str(MASTER)]
    for png, _, _ in FOX:
        inputs += ["-loop", "1", "-i", str(CHARS / png)]
    for wav, _ in VOICES:
        inputs += ["-i", str(VOICE / wav)]

    fc = []
    for i, (_, st, et) in enumerate(FOX):
        fc.append(f"[{1 + i}:v]scale=230:-1,format=rgba,"
                  f"fade=t=in:st={st}:d=0.3:alpha=1,fade=t=out:st={et - 0.3}:d=0.3:alpha=1[fox{i}]")
    base = "[0:v]"
    for i, (_, st, et) in enumerate(FOX):
        out = f"[vfox{i}]"
        fc.append(f"{base}[fox{i}]overlay=40:'H-h-42+6*sin(2*PI*t/3)':enable='between(t,{st},{et})'{out}")
        base = out
    ass_path = str(ASS).replace("\\", "/").replace(":", "\\:")
    fc.append(f"{base}ass='{ass_path}'[vout]")

    ai = 1 + len(FOX)
    labels = []
    for j, (_, delay) in enumerate(VOICES):
        ms = int(round(delay * 1000))
        fc.append(f"[{ai + j}:a]aresample=44100,adelay={ms}|{ms}[a{j}]")
        labels.append(f"[a{j}]")
    fc.append("".join(labels) +
              f"amix=inputs={len(VOICES)}:duration=longest:normalize=0,"
              f"volume=1.25,alimiter=limit=0.9:level=false,"
              f"afade=t=out:st=95.5:d=1.5,apad=pad_dur={TOTAL}[aout]")

    run(["-hide_banner", "-loglevel", "error", "-y", *inputs,
         "-filter_complex", ";".join(fc),
         "-map", "[vout]", "-map", "[aout]", "-t", str(TOTAL), "-r", "30",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart",
         str(FINAL)])


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("clips", "all"):
        step_clips()
    if which in ("concat", "all"):
        step_concat()
    if which in ("final", "all"):
        step_final()
    print("done:", which)
