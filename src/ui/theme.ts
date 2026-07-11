// Editor UI theme — colors, sizes, and spacing constants.
// All colors are 0-255 RGBA (Bloom Color format).

export interface UiColor {
  r: number; g: number; b: number; a: number;
}

export const Theme = {
  // Backgrounds
  bg: { r: 22, g: 24, b: 30, a: 255 } as UiColor,
  panel: { r: 30, g: 33, b: 42, a: 255 } as UiColor,
  panelHover: { r: 38, g: 42, b: 54, a: 255 } as UiColor,
  viewport: { r: 42, g: 46, b: 56, a: 255 } as UiColor,

  // Buttons
  button: { r: 45, g: 50, b: 62, a: 255 } as UiColor,
  buttonHover: { r: 58, g: 64, b: 78, a: 255 } as UiColor,
  buttonActive: { r: 72, g: 80, b: 96, a: 255 } as UiColor,
  buttonSelected: { r: 60, g: 100, b: 180, a: 255 } as UiColor,

  // Text
  text: { r: 230, g: 232, b: 240, a: 255 } as UiColor,
  textDim: { r: 140, g: 146, b: 160, a: 255 } as UiColor,
  textAccent: { r: 110, g: 168, b: 254, a: 255 } as UiColor,
  textError: { r: 255, g: 90, b: 90, a: 255 } as UiColor,

  // Borders
  border: { r: 55, g: 60, b: 72, a: 255 } as UiColor,

  // Input fields
  field: { r: 20, g: 22, b: 28, a: 255 } as UiColor,
  fieldHover: { r: 28, g: 30, b: 38, a: 255 } as UiColor,

  // Scrollbar
  scrollbar: { r: 55, g: 60, b: 72, a: 180 } as UiColor,
  scrollbarHover: { r: 80, g: 88, b: 100, a: 220 } as UiColor,

  // Selection highlight
  selected: { r: 60, g: 130, b: 230, a: 60 } as UiColor,

  // Axes
  axisX: { r: 220, g: 60, b: 60, a: 255 } as UiColor,
  axisY: { r: 60, g: 200, b: 60, a: 255 } as UiColor,
  axisZ: { r: 60, g: 100, b: 240, a: 255 } as UiColor,

  // Sizes (pixels)
  fontSize: 14,
  fontSizeSmall: 12,
  fontSizeLarge: 16,
  toolbarHeight: 36,
  statusBarHeight: 24,
  buttonHeight: 26,
  rowHeight: 24,
  padding: 8,
  spacing: 4,
  scrollbarWidth: 8,
  outlinerWidth: 240,
  assetPanelWidth: 280,
};
