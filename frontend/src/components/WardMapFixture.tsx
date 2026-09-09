import { fixtureLabel, type FixtureObject } from "../fhir/wardMapHelpers";

// 病棟マップの設備(ナースステーション・トイレ・階段など)。
// 種別ごとの見た目は CSS の修飾クラスで付け、色を指定したものはそれで上書きする。
// 回転は箱の縦横を入れ替え済み(rotateObject)なので、ここでは文字の向きだけ変える。

export function WardMapFixture({ object }: { object: FixtureObject }) {
  const vertical = object.rotation === 90 || object.rotation === 270;
  return (
    <div
      className={`ward-map__fixture ward-map__fixture--${object.kind}${vertical ? " ward-map__fixture--vertical" : ""}`}
      style={object.color ? { background: object.color } : undefined}
    >
      {object.kind !== "wall" && object.kind !== "door" && (
        <span className="ward-map__fixture-label">{fixtureLabel(object)}</span>
      )}
    </div>
  );
}
