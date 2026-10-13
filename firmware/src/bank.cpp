#include "bank.h"

#include "audio.h"

#include <cstring>

#if WORD_BANK

#define CLIP_EXTERN(sym) \
  extern const uint8_t sym##_start[] asm("_binary__voice_" #sym "_wav_start"); \
  extern const uint8_t sym##_end[] asm("_binary__voice_" #sym "_wav_end")

CLIP_EXTERN(koin_krincing);
CLIP_EXTERN(pembayaran_diterima);
CLIP_EXTERN(satu);
CLIP_EXTERN(dua);
CLIP_EXTERN(tiga);
CLIP_EXTERN(empat);
CLIP_EXTERN(lima);
CLIP_EXTERN(enam);
CLIP_EXTERN(tujuh);
CLIP_EXTERN(delapan);
CLIP_EXTERN(sembilan);
CLIP_EXTERN(sepuluh);
CLIP_EXTERN(sebelas);
CLIP_EXTERN(belas);
CLIP_EXTERN(puluh);
CLIP_EXTERN(ratus);
CLIP_EXTERN(ribu);
CLIP_EXTERN(juta);
CLIP_EXTERN(miliar);
CLIP_EXTERN(seratus);
CLIP_EXTERN(seribu);
CLIP_EXTERN(sejuta);
CLIP_EXTERN(rupiah);

struct Clip {
  const char* name;
  const uint8_t* start;
  const uint8_t* end;
};

static const Clip CLIPS[] = {
  {"koin-krincing", koin_krincing_start, koin_krincing_end},
  {"pembayaran-diterima", pembayaran_diterima_start, pembayaran_diterima_end},
  {"satu", satu_start, satu_end},
  {"dua", dua_start, dua_end},
  {"tiga", tiga_start, tiga_end},
  {"empat", empat_start, empat_end},
  {"lima", lima_start, lima_end},
  {"enam", enam_start, enam_end},
  {"tujuh", tujuh_start, tujuh_end},
  {"delapan", delapan_start, delapan_end},
  {"sembilan", sembilan_start, sembilan_end},
  {"sepuluh", sepuluh_start, sepuluh_end},
  {"sebelas", sebelas_start, sebelas_end},
  {"belas", belas_start, belas_end},
  {"puluh", puluh_start, puluh_end},
  {"ratus", ratus_start, ratus_end},
  {"ribu", ribu_start, ribu_end},
  {"juta", juta_start, juta_end},
  {"miliar", miliar_start, miliar_end},
  {"seratus", seratus_start, seratus_end},
  {"seribu", seribu_start, seribu_end},
  {"sejuta", sejuta_start, sejuta_end},
  {"rupiah", rupiah_start, rupiah_end},
};

static const char* DIGIT[] = {
  nullptr, "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan",
};

static int pushPart(const char** out, int count, int cap, const char* part) {
  if (count >= cap) return count;
  out[count] = part;
  return count + 1;
}

static int below1000(long n, const char** out, int count, int cap) {
  if (n >= 100) {
    long hundreds = n / 100;
    if (hundreds == 1) count = pushPart(out, count, cap, "seratus");
    else {
      count = pushPart(out, count, cap, DIGIT[hundreds]);
      count = pushPart(out, count, cap, "ratus");
    }
    n %= 100;
  }
  if (n >= 20) {
    count = pushPart(out, count, cap, DIGIT[n / 10]);
    count = pushPart(out, count, cap, "puluh");
    n %= 10;
    if (n) count = pushPart(out, count, cap, DIGIT[n]);
  } else if (n >= 12) {
    count = pushPart(out, count, cap, DIGIT[n - 10]);
    count = pushPart(out, count, cap, "belas");
  } else if (n == 11) {
    count = pushPart(out, count, cap, "sebelas");
  } else if (n == 10) {
    count = pushPart(out, count, cap, "sepuluh");
  } else if (n > 0) {
    count = pushPart(out, count, cap, DIGIT[n]);
  }
  return count;
}

static int amountParts(long amount, const char** out, int cap) {
  int count = 0;
  const long scale[] = {1000000000L, 1000000L, 1000L};
  const char* word[] = {"miliar", "juta", "ribu"};
  const char* alone[] = {nullptr, "sejuta", "seribu"};
  for (int i = 0; i < 3; i++) {
    long quote = amount / scale[i];
    amount %= scale[i];
    if (!quote) continue;
    if (quote == 1 && alone[i]) count = pushPart(out, count, cap, alone[i]);
    else {
      count = below1000(quote, out, count, cap);
      count = pushPart(out, count, cap, word[i]);
    }
  }
  if (amount) count = below1000(amount, out, count, cap);
  return count;
}

bool speakAmount(long amount) {
  if (amount < 1 || amount > 999999999999L) return false;
  const char* parts[40];
  int count = pushPart(parts, 0, 40, "koin-krincing");
  count = pushPart(parts, count, 40, "pembayaran-diterima");
  count += amountParts(amount, parts + count, 40 - count);
  count = pushPart(parts, count, 40, "rupiah");
  const uint8_t* clips[40];
  size_t lengths[40];
  for (int i = 0; i < count; i++) {
    const Clip* found = nullptr;
    for (const Clip& clip : CLIPS) {
      if (strcmp(clip.name, parts[i]) == 0) {
        found = &clip;
        break;
      }
    }
    if (!found) return false;
    clips[i] = found->start;
    lengths[i] = (size_t)(found->end - found->start);
  }
  return playWavs(clips, lengths, (size_t)count);
}

#else

bool speakAmount(long) {
  return false;
}

#endif
