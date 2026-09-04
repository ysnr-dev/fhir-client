import { type KeyboardEvent } from "react";
import { usePostalCodeLookup } from "../api/masterQueries";

// 郵便番号の入力欄と「住所検索」ボタン。押すと郵便番号マスタを引き、都道府県・
// 市区町村・町域を親に渡す(実際にどの欄へ入れるかは親が決める)。
//
// ラベルや並びは使う側のフォームに任せるので、ここは欄とボタンだけを描く。
// フォームの中に置くため、Enter は送信ではなく住所検索に割り当てる。

interface ResolvedAddress {
  prefecture: string;
  city: string;
  /** 町域名。1 つの郵便番号が複数の町域を表す場合は空。 */
  town: string;
}

interface PostalCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onResolved: (address: ResolvedAddress) => void;
}

export function PostalCodeInput({ value, onChange, onResolved }: PostalCodeInputProps) {
  const digits = value.replace(/\D/g, "");
  const lookup = usePostalCodeLookup();

  function handleLookup() {
    if (digits.length !== 7 || lookup.isPending) return;

    lookup.mutate(digits, {
      onSuccess: (result) => {
        const [first] = result.items;
        if (!first) return;

        // 町域が分かれる郵便番号(1 つの番号で複数の町域)は町域を決められないので、
        // 都道府県・市区町村までにする。
        const sameTown = result.items.every((item) => item.town === first.town);
        onResolved({
          prefecture: first.prefecture,
          city: first.city,
          town: sameTown ? first.town : "",
        });
      },
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    handleLookup();
  }

  const notFound = lookup.isSuccess && lookup.data.items.length === 0;

  return (
    <>
      <div className="postal-code">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            lookup.reset();
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={digits.length !== 7 || lookup.isPending}
        >
          {lookup.isPending ? "検索中..." : "住所検索"}
        </button>
      </div>
      {(notFound || lookup.isError) && (
        <span className="postal-code__message" role="status">
          {notFound ? "該当する住所がありません" : "住所を検索できませんでした"}
        </span>
      )}
    </>
  );
}
