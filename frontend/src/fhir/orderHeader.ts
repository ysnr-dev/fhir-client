import { emptyOrderContext, type OrderContext } from "../orderContext";

// オーダーと記録に共通の「どの種別か・誰が・どの科で・どの病棟から」。処方・注射・検査などの
// オーダー(ServiceRequest)のほか、診療記録・テンプレート回答・バイタルも記録した診療科を同じ
// 拡張で持つ。

// オーダー種別。処方・注射・検体検査はどれも ServiceRequest で保存するので、
// どの種類のオーダーかを category に持たせて振り分ける(処方は種別を持たず、
// 種別を持たない ServiceRequest は処方として扱う)。
export const ORDER_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/order-type";

// 依頼科(診療科 Organization)。ServiceRequest / MedicationRequest には診療科を持つ
// 標準要素が無い(FHIR では Encounter 経由で表現する)ため、参照をローカル拡張で持たせる。
// 依頼医師は標準の requester に入れる。
const ORDER_DEPARTMENT_EXT_URL = "http://fhir-client.local/StructureDefinition/order-department";
// オーダー時点の入院病棟(病棟 Location)。標準要素が無いのは依頼科と同じ理由(FHIR では
// Encounter 経由で表す)。部門の一覧が 1 行ずつ入院を引き直さずに済むよう、オーダー側に
// 焼き付ける(入外区分を category に焼き付けているのと同じ考え方)。転棟しても書き換えない
// ので、値は「そのオーダーを出した時点でどの病棟に居たか」を表す。
const ORDER_WARD_EXT_URL = "http://fhir-client.local/StructureDefinition/order-ward";

/**
 * 診療科(Organization)を指すローカル拡張。オーダーの依頼科のほか、検査結果
 * (DiagnosticReport)の診療科にも同じ拡張を使う。参照を引き直さずに一覧・カルテで
 * 名前を出せるよう display を埋めておく(PractitionerRole と同じ方針)。
 */
export function departmentExtension(departmentId: string, departmentName: string): fhir4.Extension {
  return {
    url: ORDER_DEPARTMENT_EXT_URL,
    valueReference: {
      reference: `Organization/${departmentId}`,
      ...(departmentName ? { display: departmentName } : {}),
    },
  };
}

/** 診療科(Organization)の id と名前。 */
export interface DepartmentRef {
  departmentId: string;
  departmentName: string;
}

/** ローカル拡張に入れた診療科。未設定なら id・名前とも空。 */
export function departmentOf(resource: { extension?: fhir4.Extension[] }): DepartmentRef {
  const reference = resource.extension?.find(
    (e) => e.url === ORDER_DEPARTMENT_EXT_URL,
  )?.valueReference;
  return {
    departmentId: reference?.reference?.split("/").pop() ?? "",
    departmentName: reference?.display ?? "",
  };
}

/**
 * 入院病棟(Location)を指すローカル拡張。依頼科と同じく、参照を引き直さずに部門の一覧で
 * 名前を出せるよう display を埋めておく。
 */
export function wardExtension(wardId: string, wardName: string): fhir4.Extension {
  return {
    url: ORDER_WARD_EXT_URL,
    valueReference: {
      reference: `Location/${wardId}`,
      ...(wardName ? { display: wardName } : {}),
    },
  };
}

/** ローカル拡張に入れたオーダー時点の入院病棟。未設定(外来オーダー)なら id・名前とも空。 */
export function wardOf(resource: { extension?: fhir4.Extension[] }): {
  wardId: string;
  wardName: string;
} {
  const reference = resource.extension?.find((e) => e.url === ORDER_WARD_EXT_URL)?.valueReference;
  return {
    wardId: reference?.reference?.split("/").pop() ?? "",
    wardName: reference?.display ?? "",
  };
}

/**
 * オーダーに焼き付ける「誰が・どの科で・どの病棟から」。依頼科・依頼医師はユーザーが選ぶ
 * (OrderContext)が、病棟は選ぶものではなく登録時点の在院状況なので、任意の追加とする。
 */
export interface OrderAttribution extends OrderContext {
  /** オーダー時点の入院病棟(Location.id)。外来オーダーでは空。 */
  wardId?: string;
  wardName?: string;
  /** オーダー時点の入院(Encounter.id)。外来オーダーでは空。 */
  encounterId?: string;
}

/**
 * 入院のオーダーにだけ在院病棟と入院(Encounter)を添える。入外区分を手で「外来」に
 * 変えたときは付けない(一覧の区分列と病棟列が食い違わないように)。
 */
export function withOrderWard(
  requester: OrderContext,
  setting: string,
  ward: { wardId: string; wardName: string; encounterId?: string },
): OrderAttribution {
  if (setting !== "inpatient" || !ward.wardId) return requester;
  return {
    ...requester,
    wardId: ward.wardId,
    wardName: ward.wardName,
    ...(ward.encounterId ? { encounterId: ward.encounterId } : {}),
  };
}

// 依頼医師は標準の requester、依頼科と入院病棟はローカル拡張に入れる。
export function applyOrderContext(
  resource: fhir4.ServiceRequest | fhir4.MedicationRequest,
  requester: OrderAttribution,
) {
  if (requester.practitionerId) {
    resource.requester = {
      reference: `Practitioner/${requester.practitionerId}`,
      ...(requester.practitionerName ? { display: requester.practitionerName } : {}),
    };
  }
  if (requester.departmentId) {
    resource.extension = [
      ...(resource.extension ?? []),
      departmentExtension(requester.departmentId, requester.departmentName),
    ];
  }
  if (requester.wardId) {
    resource.extension = [
      ...(resource.extension ?? []),
      wardExtension(requester.wardId, requester.wardName ?? ""),
    ];
  }
}

// 登録時に入れた依頼科・依頼医師。参照の display をそのまま名前として使うので、
// 表示のために Organization / Practitioner を引き直す必要はない。
export function orderRequester(sr: fhir4.ServiceRequest): OrderAttribution {
  const department = departmentOf(sr);
  const ward = wardOf(sr);
  const encounterId = sr.encounter?.reference?.split("/").pop() ?? "";
  if (!department.departmentId && !sr.requester && !ward.wardId && !encounterId) {
    return emptyOrderContext;
  }
  return {
    ...department,
    // 編集で保存し直しても登録時点の病棟・入院が残るよう、読み戻してそのまま渡す
    // (依頼科・依頼医師を引き継ぐのと同じ扱い)。
    ...(ward.wardId ? ward : {}),
    ...(encounterId ? { encounterId } : {}),
    practitionerId: sr.requester?.reference?.split("/").pop() ?? "",
    practitionerName: sr.requester?.display ?? "",
  };
}

/** 「依頼科 | 依頼医師」の表示文字列。どちらも未設定なら空。 */
export function orderContextSummary(requester: OrderContext): string {
  return [requester.departmentName, requester.practitionerName].filter(Boolean).join(" | ");
}
