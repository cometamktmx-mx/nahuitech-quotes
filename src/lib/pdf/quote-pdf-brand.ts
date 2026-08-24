export const quotePdfBrand = {
  black: "#111111",
  graphite: "#25252A",
  white: "#FFFFFF",
  neutral: "#F3F3F3",
  muted: "#707070",
  border: "#D8D8D8",
  logoViolet: "#6463B5",
  logoRed: "#DB2149",
  logoPeach: "#FFBF98",
  logoBrown: "#B57964",
} as const;

export function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);

  return {
    red: ((value >> 16) & 255) / 255,
    green: ((value >> 8) & 255) / 255,
    blue: (value & 255) / 255,
  };
}
