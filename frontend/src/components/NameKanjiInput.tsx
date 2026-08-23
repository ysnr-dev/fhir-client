import { useRef, type CompositionEvent } from "react";
import { isKanaOnly, toKatakana } from "../lib/kana";

// 漢字氏名の入力欄。入力中に IME が見せている読み(変換前のかな)を拾って、
// 対になるカナ欄へカタカナで書き込む。
//
// 読みは compositionupdate の data から採る。変換を確定するまでの間、data は
// 「やまだ」→「山田」と変わっていくので、かなだけだった最後の状態を覚えておき、
// 確定(compositionend)のときにそれをカタカナにして渡す。読みを拾えない IME では
// 何もしない(カナ欄は手入力のまま)。
//
// カナ欄を手で直した後は上書きしない。自分が書き込んだ値を覚えておき、それと
// 食い違っていれば触らないでおく(患者編集のように初めからカナが入っている場合も同じ)。

interface NameKanjiInputProps {
  value: string;
  onChange: (value: string) => void;
  kana: string;
  onKanaChange: (kana: string) => void;
}

export function NameKanjiInput({ value, onChange, kana, onKanaChange }: NameKanjiInputProps) {
  // 変換中の読み(かなだけだった最後の状態)。
  const reading = useRef("");
  // 変換開始時に欄が空(または全選択で置き換え)だったか。カナを足すか置き換えるかの判断に使う。
  const replacing = useRef(false);
  // 直近に自動記載したカナ。手入力と区別するために持つ。
  const autoFilled = useRef("");

  function handleCompositionStart(e: CompositionEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const selectedAll = input.selectionStart === 0 && input.selectionEnd === value.length;
    reading.current = "";
    replacing.current = value === "" || selectedAll;
  }

  function handleCompositionUpdate(e: CompositionEvent<HTMLInputElement>) {
    if (isKanaOnly(e.data)) reading.current = e.data;
  }

  function handleCompositionEnd() {
    const katakana = toKatakana(reading.current);
    reading.current = "";
    if (!katakana) return;
    if (kana !== autoFilled.current) return;

    const next = (replacing.current ? "" : kana) + katakana;
    autoFilled.current = next;
    onKanaChange(next);
  }

  function handleChange(next: string) {
    onChange(next);
    // 漢字を消したらカナも消す(自動記載したぶんだけ)。
    if (next === "" && kana === autoFilled.current && kana !== "") {
      autoFilled.current = "";
      onKanaChange("");
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      onCompositionStart={handleCompositionStart}
      onCompositionUpdate={handleCompositionUpdate}
      onCompositionEnd={handleCompositionEnd}
    />
  );
}
