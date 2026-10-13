const SMALL = [
  "nol",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
];

function underThousand(n) {
  const parts = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 1) parts.push("seratus");
  else if (hundreds > 1) parts.push(SMALL[hundreds], "ratus");
  if (rest > 0 && rest < 12) parts.push(SMALL[rest]);
  else if (rest >= 12 && rest < 20) parts.push(SMALL[rest - 10], "belas");
  else if (rest >= 20) {
    parts.push(SMALL[Math.floor(rest / 10)], "puluh");
    if (rest % 10) parts.push(SMALL[rest % 10]);
  }
  return parts.join(" ");
}

export function terbilang(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) {
    throw new Error("nominal di luar jangkauan");
  }
  if (n === 0) return "nol";
  const juta = Math.floor(n / 1_000_000);
  const ribu = Math.floor((n % 1_000_000) / 1000);
  const sisa = n % 1000;
  const parts = [];
  if (juta) parts.push(juta === 1 ? "satu juta" : `${underThousand(juta)} juta`);
  if (ribu) parts.push(ribu === 1 ? "seribu" : `${underThousand(ribu)} ribu`);
  if (sisa) parts.push(underThousand(sisa));
  return parts.join(" ");
}

export function kalimatNominal(amount) {
  return `Pembayaran diterima sebesar ${terbilang(amount)} rupiah`;
}
