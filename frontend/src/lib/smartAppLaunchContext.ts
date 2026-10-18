// CDS Hooks のカードのリンク(type: smart)が持つ appContext を、吹き出しからアプリタブへ渡す
// ための受け渡し場所。URL に載せない(長さの上限があり、業務上の文脈をブラウザの履歴に
// 残さない)ので、遷移の直前に置き、アプリタブが起動時に取り出す。

const pending = new Map<number, string>();

export function setPendingAppContext(appId: number, appContext: string) {
  pending.set(appId, appContext);
}

/** 置かれていれば取り出して消す。無ければ undefined。 */
export function takePendingAppContext(appId: number): string | undefined {
  const value = pending.get(appId);
  if (value !== undefined) pending.delete(appId);
  return value;
}
