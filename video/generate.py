#!/usr/bin/env python3
"""Video 1080p untuk YouTube tentang QRIS Speaker.

Butuh ffmpeg, ffprobe, dan Pillow.
Suara diambil dari Inworld TTS. Kuncinya dibaca dari INWORLD_API_KEY atau video/.env.

    python3 video/generate.py
    python3 video/generate.py -o video/out/qris-speaker.mp4
"""

import argparse
import base64
import json
import os
import random
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
FPS = 30
ROOT = Path(__file__).resolve().parent
TTS_URL = "https://api.inworld.ai/tts/v1/voice"
TTS_VOICE = "vivid-beryl-6237__wimboro"
TTS_MODEL = "inworld-tts-2"
FONT = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"

PAPER = (247, 244, 239)
INK = (32, 32, 32)
MUTED = (92, 88, 84)
ACCENT = (0xD8, 0x3E, 0x3C)
OK = (22, 110, 64)
WHITE = (255, 255, 255)
BEZEL = (28, 28, 28)

SCREEN_W, SCREEN_H = 480, 640
DEMO_AMOUNT = 25000


def rupiah(amount):
    digits = str(amount)
    parts = []
    for i, ch in enumerate(digits):
        if i and (len(digits) - i) % 3 == 0:
            parts.append(".")
        parts.append(ch)
    return "Rp " + "".join(parts)


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def wrap(text, face, width):
    lines, cur = [], ""
    for word in text.split():
        trial = word if not cur else f"{cur} {word}"
        if face.getlength(trial) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def button(draw, x, y, w, h, label, solid):
    face = ACCENT if solid else WHITE
    text = WHITE if solid else INK
    rounded(draw, (x, y, x + w, y + h), 16, face, None if solid else ACCENT, 3)
    draw.text((x + w / 2, y + h / 2), label, font=font(28, True), fill=text, anchor="mm")


def paint_qr(draw, x, y, side, seed):
    n = 29
    cell = side // n
    ox = x + (side - cell * n) // 2
    oy = y + (side - cell * n) // 2
    draw.rectangle((x, y, x + side, y + side), fill=WHITE)
    rng = random.Random(seed)
    reserved = set()

    def module(col, row, on):
        reserved.add((col, row))
        if not on:
            return
        draw.rectangle(
            (ox + col * cell, oy + row * cell, ox + (col + 1) * cell, oy + (row + 1) * cell),
            fill=INK,
        )

    def finder(fx, fy):
        for row in range(7):
            for col in range(7):
                edge = row in (0, 6) or col in (0, 6)
                core = 2 <= row <= 4 and 2 <= col <= 4
                module(fx + col, fy + row, edge or core)

    finder(0, 0)
    finder(n - 7, 0)
    finder(0, n - 7)
    for row in range(n):
        for col in range(n):
            if (col, row) in reserved:
                continue
            if rng.random() < 0.46:
                module(col, row, True)


def screen_static():
    img = Image.new("RGB", (SCREEN_W, SCREEN_H), WHITE)
    draw = ImageDraw.Draw(img)
    paint_qr(draw, 64, 138, 352, 3)
    button(draw, 16, 552, 448, 80, "NOMINAL", True)
    return img


def screen_keypad(amount):
    img = Image.new("RGB", (SCREEN_W, SCREEN_H), WHITE)
    draw = ImageDraw.Draw(img)
    draw.text((20, 16), "Nominal", font=font(28, True), fill=ACCENT)
    draw.text((20, 56), rupiah(amount), font=font(48, True), fill=INK)
    labels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"]
    gap, bw, bh, y0 = 12, 140, 80, 176
    for i, label in enumerate(labels):
        col, row = i % 3, i // 3
        button(draw, 16 + col * (bw + gap), y0 + row * (bh + gap), bw, bh, label, False)
    yb = y0 + 4 * (bh + gap)
    hw = (SCREEN_W - 32 - gap) // 2
    button(draw, 16, yb, hw, bh, "BATAL", False)
    button(draw, 16 + hw + gap, yb, hw, bh, "BAYAR", True)
    return img


def screen_dynamic(amount):
    img = Image.new("RGB", (SCREEN_W, SCREEN_H), WHITE)
    draw = ImageDraw.Draw(img)
    draw.text((16, 18), rupiah(amount), font=font(36, True), fill=ACCENT)
    paint_qr(draw, 64, 138, 352, 9)
    button(draw, 16, 552, 448, 80, "BATAL", False)
    return img


def screen_paid(amount):
    img = Image.new("RGB", (SCREEN_W, SCREEN_H), OK)
    draw = ImageDraw.Draw(img)
    draw.text((SCREEN_W / 2, 250), "Lunas", font=font(64, True), fill=WHITE, anchor="mm")
    draw.text((SCREEN_W / 2, 340), rupiah(amount), font=font(42, True), fill=WHITE, anchor="mm")
    return img


def screen_setup():
    img = Image.new("RGB", (SCREEN_W, SCREEN_H), WHITE)
    draw = ImageDraw.Draw(img)
    draw.text((24, 28), "Atur speaker", font=font(40, True), fill=ACCENT)
    lines = [
        "Wi-Fi: qris-speaker",
        "Browser: 192.168.4.1",
        "",
        "Serial 115200:",
        "WIFI=nama",
        "PASS=sandi",
        "HOST=https://server",
        "TOKEN=rahasia",
        "APPLY",
    ]
    y = 110
    face = font(26)
    for line in lines:
        if line:
            draw.text((24, y), line, font=face, fill=INK)
        y += 48
    return img


def screen_keys():
    img = Image.new("RGB", (SCREEN_W, SCREEN_H), WHITE)
    draw = ImageDraw.Draw(img)
    draw.text((24, 28), "Di perangkat", font=font(32, True), fill=ACCENT)
    draw.text((24, 84), "Token perangkat", font=font(28), fill=INK)
    draw.line((24, 300, SCREEN_W - 24, 300), fill=ACCENT, width=4)
    draw.text((24, 332), "Di backend", font=font(32, True), fill=ACCENT)
    draw.text((24, 388), "Server Key Midtrans", font=font(28), fill=INK)
    draw.text((24, 436), "API key Duitku", font=font(28), fill=INK)
    return img


SCREENS = {
    "static": lambda: screen_static(),
    "keypad": lambda: screen_keypad(DEMO_AMOUNT),
    "dynamic": lambda: screen_dynamic(DEMO_AMOUNT),
    "paid": lambda: screen_paid(DEMO_AMOUNT),
    "setup": screen_setup,
    "keys": screen_keys,
}

SCENES = [
    {
        "kicker": "ESP32-S3  ·  layar 2,8 inci",
        "title": "QRIS Speaker",
        "lines": [
            "Layar menampilkan kode QR.",
            "Speaker mengumumkan nominal setelah pembayaran berhasil.",
        ],
        "screen": "static",
    },
    {
        "kicker": "Midtrans",
        "title": "QR statis",
        "lines": [
            "Layar awal menampilkan QR statis GoPay.",
            "Tombol Nominal membuka keypad.",
        ],
        "screen": "static",
    },
    {
        "kicker": "Duitku",
        "title": "Nominal",
        "lines": [
            "Keypad sentuh menyusun angka.",
            "Bayar meminta QR dinamis. Batal kembali ke QR statis.",
        ],
        "screen": "keypad",
    },
    {
        "kicker": "Berlaku 15 menit",
        "title": "QR dinamis",
        "lines": [
            "QR dinamis dibuat lewat inquiry Duitku.",
            "Pembayaran yang sudah terlanjur discan tetap diumumkan.",
        ],
        "screen": "dynamic",
    },
    {
        "kicker": "Pembayaran berhasil",
        "title": "Lunas",
        "lines": [
            "Layar menampilkan Lunas.",
            "Speaker mengucapkan pembayaran diterima sebesar dua puluh lima ribu rupiah.",
        ],
        "screen": "paid",
    },
    {
        "kicker": "Pembayaran",
        "title": "Kunci di backend",
        "lines": [
            "Server Key Midtrans dan API key Duitku hanya ada di backend.",
            "ESP32 memegang token perangkat, bukan kunci pembayaran.",
        ],
        "screen": "keys",
    },
    {
        "kicker": "Sekali, saat pertama menyala",
        "title": "Sambungkan",
        "lines": [
            "Dari ponsel, sambungkan ke Wi-Fi qris-speaker, lalu buka 192.168.4.1.",
            "Atau lewat serial: WIFI, PASS, HOST, TOKEN, lalu APPLY.",
        ],
        "screen": "setup",
    },
    {
        "kicker": "Soket horn",
        "title": "Siap dipasang",
        "lines": [
            "QR statis lewat Midtrans. QR dinamis lewat Duitku.",
            "Speaker di soket horn, maksimum 1,5 watt pada 8 ohm.",
        ],
        "screen": "static",
    },
]


def render_frame(scene):
    img = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 14, H), fill=ACCENT)

    kicker = font(26, True)
    title = font(68, True)
    body = font(34)
    x, y = 88, 150
    draw.text((x, y), scene["kicker"].upper(), font=kicker, fill=ACCENT)
    y += 56
    draw.text((x, y), scene["title"], font=title, fill=INK)
    y += 110
    for line in scene["lines"]:
        for part in wrap(line, body, 900):
            draw.text((x, y), part, font=body, fill=INK)
            y += 50
        y += 16

    lcd = SCREENS[scene["screen"]]()
    bezel = 28
    dw, dh = SCREEN_W + bezel * 2, SCREEN_H + bezel * 2
    dx = 1920 - 96 - dw
    dy = (H - dh) // 2 - 16
    rounded(draw, (dx, dy, dx + dw, dy + dh), 28, BEZEL)
    img.paste(lcd, (dx + bezel, dy + bezel))
    if scene["screen"] in ("static", "dynamic"):
        note = font(22)
        draw.text(
            (dx + dw / 2, dy + dh + 28),
            "Ilustrasi layar, bukan kode bayar.",
            font=note,
            fill=MUTED,
            anchor="mt",
        )
    return img


def run(cmd):
    proc = subprocess.run(cmd, text=True, capture_output=True)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise SystemExit(detail or f"gagal: {' '.join(cmd[:3])}")
    return proc


def wav_duration(path):
    out = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ]
    ).stdout.strip()
    return float(out)


def load_api_key():
    key = os.environ.get("INWORLD_API_KEY", "").strip()
    if key:
        return key
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("INWORLD_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("INWORLD_API_KEY belum diisi. Taruh di video/.env atau lingkungan.")


def speak(text, dest, api_key):
    body = json.dumps(
        {
            "text": text,
            "voiceId": TTS_VOICE,
            "modelId": TTS_MODEL,
            "timestampType": "WORD",
            "audioConfig": {"speakingRate": 1},
            "deliveryMode": "BALANCED",
            "language": "id-ID",
        }
    ).encode()
    request = urllib.request.Request(
        TTS_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {api_key}",
            "Accept": "application/json",
            "User-Agent": "curl/8.5.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            data = response.read()
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:180]
        raise SystemExit(f"TTS menolak ({err.code}) {detail}") from err
    except urllib.error.URLError as err:
        raise SystemExit(f"TTS tidak terjangkau: {err.reason}") from err
    try:
        audio = json.loads(data).get("audioContent") or ""
    except json.JSONDecodeError:
        audio = ""
    raw = base64.b64decode(audio) if audio else b""
    if len(raw) < 64:
        preview = data[:180].decode("utf-8", "replace")
        raise SystemExit(f"TTS bukan audio: {preview}")
    dest.write_bytes(raw)


def stamp(seconds):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def chapter(seconds):
    total = int(seconds)
    minutes, secs = divmod(total, 60)
    return f"{minutes}:{secs:02d}"


def write_srt(path, cues):
    blocks = []
    for i, (start, end, text) in enumerate(cues, 1):
        blocks.append(f"{i}\n{stamp(start)} --> {stamp(end)}\n{text}\n")
    path.write_text("\n".join(blocks), encoding="utf-8")


def scene_clip(png, wav, dest, duration):
    run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-loop",
            "1",
            "-framerate",
            str(FPS),
            "-t",
            f"{duration:.3f}",
            "-i",
            str(png),
            "-i",
            str(wav),
            "-filter_complex",
            "[1:a]apad,aformat=sample_rates=48000:channel_layouts=stereo[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(dest),
        ]
    )


def assemble(clips, dest):
    listing = dest.with_suffix(".txt")
    listing.write_text("".join(f"file '{clip}'\n" for clip in clips), encoding="utf-8")
    run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(listing),
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=11",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-profile:v",
            "high",
            "-level",
            "4.0",
            "-g",
            "60",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            str(dest),
        ]
    )
    listing.unlink()


def main():
    parser = argparse.ArgumentParser(description="Buat video YouTube QRIS Speaker")
    parser.add_argument("-o", "--output", type=Path, default=ROOT / "out" / "qris-speaker.mp4")
    args = parser.parse_args()
    api_key = load_api_key()

    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise SystemExit(f"{tool} tidak ada di PATH")

    out = args.output.resolve()
    work = out.parent / "work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    clips = []
    cues = []
    cursor = 0.0
    for index, scene in enumerate(SCENES):
        speech = " ".join(scene["lines"])
        png = work / f"{index:02d}.png"
        audio = work / f"{index:02d}.mp3"
        clip = work / f"{index:02d}.mp4"
        render_frame(scene).save(png)
        speak(speech, audio, api_key)
        duration = max(4.8, wav_duration(audio) + 0.75)
        scene_clip(png, audio, clip, duration)
        clips.append(clip)
        cues.append((cursor, cursor + duration - 0.15, speech))
        cursor += duration
        print(f"{index + 1}/{len(SCENES)}  {scene['title']}  {duration:.1f}s")

    assemble(clips, out)
    srt = out.with_suffix(".srt")
    write_srt(srt, cues)
    shutil.rmtree(work)

    length = wav_duration(out)
    print(f"\nVideo  {out}")
    print(f"Takarir  {srt}")
    print(f"Durasi  {length:.1f}s  ·  1920×1080  ·  H.264 + AAC")
    print("\nJudul YouTube")
    print("QRIS Speaker di ESP32-S3: QR di layar, nominal di speaker")
    print("\nDeskripsi")
    print("Speaker QRIS untuk board LCD 2,8 inci ESP32-S3.")
    print("Layar awal menampilkan QR statis GoPay. Keypad membuat QR dinamis lewat Duitku.")
    print("Setelah pembayaran berhasil, speaker mengumumkan nominal dan layar menampilkan Lunas.")
    print("Kunci pembayaran tetap di backend. Perangkat hanya memegang token.")
    print("\nBab")
    for scene, (start, _end, _text) in zip(SCENES, cues):
        print(f"{chapter(start)} {scene['title']}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
