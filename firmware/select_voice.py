Import("env")
import os
import shutil

NAMES = [
    "koin-krincing.wav",
    "diterima.wav",
    "satu.wav",
    "dua.wav",
    "tiga.wav",
    "empat.wav",
    "lima.wav",
    "enam.wav",
    "tujuh.wav",
    "delapan.wav",
    "sembilan.wav",
    "sepuluh.wav",
    "sebelas.wav",
    "belas.wav",
    "puluh.wav",
    "ratus.wav",
    "ribu.wav",
    "juta.wav",
    "miliar.wav",
    "seratus.wav",
    "seribu.wav",
    "sejuta.wav",
    "rupiah.wav",
]

voice = env.GetProjectOption("custom_voice", "rowosari")
root = env.subst("$PROJECT_DIR")
src = os.path.join(root, "bank" if voice == "bank" else os.path.join("voices", voice))
dst = os.path.join(root, ".voice")
os.makedirs(dst, exist_ok=True)
missing = []
for name in NAMES:
    src_file = os.path.join(src, name)
    if not os.path.isfile(src_file):
        missing.append(name)
        continue
    shutil.copyfile(src_file, os.path.join(dst, name))
if missing:
    raise SystemExit(f"suara '{voice}' tidak lengkap: {', '.join(missing)}")
print(f"suara kata: {voice}")
