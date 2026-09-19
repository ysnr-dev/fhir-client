// CT のウィンドウ(表示する CT 値の幅と中心)のプリセット。

export interface WindowPreset {
  label: string;
  width: number;
  center: number;
}

export const CT_WINDOW_PRESETS: readonly WindowPreset[] = [
  { label: "肺野", width: 1500, center: -600 },
  { label: "縦隔", width: 400, center: 40 },
  { label: "腹部", width: 350, center: 50 },
  { label: "骨", width: 2000, center: 400 },
  { label: "脳", width: 80, center: 40 },
];
