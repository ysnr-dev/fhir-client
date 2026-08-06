import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useDepartmentDoctors, useDepartmentsOf, usePractitionerRoles } from "../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../fhir/departmentHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  baseRoleOf,
  isDoctorRoleCode,
  parseDepartmentRoles,
  parsePractitionerRole,
} from "../fhir/practitionerRoleHelpers";
import {
  emptyOrderContext,
  readOrderContext,
  storeOrderContext,
  type OrderContext,
} from "../orderContext";

// カルテ画面ヘッダーの「依頼科 / 依頼医師」。オーダーの依頼元をここで切り替える。
//
//   医師・歯科医師 … 依頼医師は本人なので依頼科だけを選ぶ(初期値は既定診療科)。
//   それ以外       … 代行入力。依頼科を開くとその科の医師が出る階層選択。
//
// 常時出ている表示なので、プルダウンではなく枠線のないテキストとして置き、
// クリック(またはマウスオーバー)でメニューを開く。

interface DepartmentOption {
  id: string;
  name: string;
}

export function OrderContextPicker() {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const practitionerRoles = usePractitionerRoles(practitionerId ?? undefined);

  const baseRole = baseRoleOf(practitionerRoles.roles);
  const baseRoleValues = baseRole ? parsePractitionerRole(baseRole) : undefined;
  const facilityId = baseRoleValues?.organizationId || undefined;
  const isDoctor = isDoctorRoleCode(baseRoleValues?.roleCode);

  // 自分に紐付く診療科(既定科が先頭)。
  const myDepartments = useMemo(
    () => parseDepartmentRoles(practitionerRoles.roles),
    [practitionerRoles.roles],
  );

  // 医師は自分の担当科から選ぶ。担当科が未登録なら、選べる科が無くならないよう
  // 所属医療機関の診療科をすべて出す。代行入力(医師以外)は常に施設の全科。
  const useMyDepartments = isDoctor && myDepartments.length > 0;
  const facilityDepartments = useDepartmentsOf(
    practitionerRoles.isPending || useMyDepartments ? undefined : facilityId,
  );

  const departments: DepartmentOption[] = useMemo(() => {
    if (useMyDepartments) {
      return myDepartments.map((d) => ({ id: d.organizationId, name: d.name }));
    }
    return sortDepartmentsByCode(facilityDepartments.data ?? [])
      .filter((organization) => Boolean(organization.id))
      .map((organization) => ({
        id: organization.id as string,
        name: departmentDisplayName(organization),
      }));
  }, [useMyDepartments, myDepartments, facilityDepartments.data]);

  const [value, setValue] = useState<OrderContext | null>(null);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  // 初期化済みのログインユーザー。ログインし直したら初期値を取り直す。
  const initializedFor = useRef("");

  // 初期値: ユーザーが選んだ保存済みの値、無ければ既定診療科(+ 医師なら依頼医師は本人)。
  useEffect(() => {
    if (!practitionerId || practitionerRoles.isPending) return;
    if (initializedFor.current === practitionerId) return;
    // 医師本人が依頼医師になるので、氏名が引けるまで待つ。
    if (isDoctor && !practitioner) return;
    // 選択肢が出揃う前に確定させると、保存済みの科を照合できないまま
    // 「診療科未選択」で固定されてしまう。施設の全科を引く場合は待つ。
    if (!useMyDepartments && facilityId && facilityDepartments.isPending) return;

    initializedFor.current = practitionerId;

    // 既定診療科。担当科が未登録なら(医師以外の代行入力を含め)空になる。
    const primary = myDepartments.find((d) => d.primary) ?? myDepartments[0];
    // ユーザーが選んだ値だけを引き継ぐ。自動で入れただけの値(auto)は毎回入れ直す
    // ので、医療従事者マスタで既定診療科を変えるとここにも反映される。今選べる科に
    // 無い(診療科の登録が変わった)ときも既定診療科に戻す。
    const chosen = readOrderContext(practitionerId);
    const stored = chosen && !chosen.auto ? chosen : null;
    const department =
      departments.find((d) => d.id === stored?.departmentId) ??
      (primary ? { id: primary.organizationId, name: primary.name } : undefined);
    // 既定診療科のまま(ユーザーが選んでいない)かどうか。次回もマスタ側に追従させる。
    const auto = !stored || stored.departmentId !== department?.id;
    // 代行入力の指示医師は、科が保存時のままのときだけ引き継ぐ。
    const keepsStoredDoctor = Boolean(stored && department && stored.departmentId === department.id);

    const initial: OrderContext = {
      ...emptyOrderContext,
      departmentId: department?.id ?? "",
      departmentName: department?.name ?? "",
      ...(isDoctor && practitioner
        ? {
            practitionerId: practitionerId,
            practitionerName: practitionerDisplayName(practitioner),
          }
        : keepsStoredDoctor && stored
          ? { practitionerId: stored.practitionerId, practitionerName: stored.practitionerName }
          : {}),
    };
    setValue(initial);
    storeOrderContext(practitionerId, initial, auto);
  }, [
    practitionerId,
    practitioner,
    practitionerRoles.isPending,
    isDoctor,
    myDepartments,
    departments,
    useMyDepartments,
    facilityId,
    facilityDepartments.isPending,
  ]);

  // メニュー外を押すか Esc で閉じる。マウスが離れただけでは閉じない
  // (トリガーとパネルの間に隙間があり、そこを通っただけで消えてしまうため)。
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function update(next: OrderContext) {
    setValue(next);
    if (practitionerId) storeOrderContext(practitionerId, next);
  }

  function selectDepartment(department: DepartmentOption) {
    const current = value ?? emptyOrderContext;
    if (isDoctor) {
      // 依頼医師は本人のままなので、科を選んだ時点で確定してよい。
      update({ ...current, departmentId: department.id, departmentName: department.name });
      setOpen(false);
      return;
    }
    // 代行入力は科を変えたら指示医師を選び直す。同じ科なら開閉だけ切り替える。
    const changed = current.departmentId !== department.id;
    update({
      ...current,
      departmentId: department.id,
      departmentName: department.name,
      ...(changed ? { practitionerId: "", practitionerName: "" } : {}),
    });
    setExpandedId((id) => (id === department.id ? "" : department.id));
  }

  function selectDoctor(department: DepartmentOption, doctor: fhir4.Practitioner) {
    update({
      departmentId: department.id,
      departmentName: department.name,
      practitionerId: doctor.id ?? "",
      practitionerName: practitionerDisplayName(doctor),
    });
    setOpen(false);
  }

  // 医療従事者と紐付かないログイン(管理者)や認証不要モードでは出さない。
  if (!practitionerId || !value) return null;

  const doctorName =
    value.practitionerId === practitionerId && practitioner
      ? practitionerDisplayName(practitioner)
      : value.practitionerName;

  const summary = [value.departmentName || "診療科未選択", doctorName]
    .filter(Boolean)
    .join(" | ");

  return (
    // 開閉はクリックのみ(マウスオーバーで勝手に開くと、直後のクリックで
    // 閉じてしまい「押しても開かない」ように見えるため)。閉じるのは上の外側クリック。
    <div className="order-context" ref={ref}>
      <span className="order-context__label">依頼</span>
      <button
        type="button"
        className="order-context__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={isDoctor ? "依頼科を選択" : "依頼科・依頼医師(指示医師)を選択"}
        onClick={() => setOpen((v) => !v)}
      >
        {summary} <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="row-menu__items order-context__menu" role="menu">
          {departments.length === 0 ? (
            <p className="order-context__empty">
              {facilityDepartments.isPending || practitionerRoles.isPending
                ? "読み込み中..."
                : "選択できる診療科がありません"}
            </p>
          ) : (
            departments.map((department) => (
              <div key={department.id} className="order-context__group">
                <button
                  type="button"
                  className={`row-menu__item order-context__dept${
                    value.departmentId === department.id ? " order-context__item--active" : ""
                  }`}
                  aria-expanded={isDoctor ? undefined : expandedId === department.id}
                  onClick={() => selectDepartment(department)}
                >
                  <span>{department.name}</span>
                  {!isDoctor && (
                    <span aria-hidden="true">{expandedId === department.id ? "▾" : "▸"}</span>
                  )}
                </button>
                {!isDoctor && expandedId === department.id && (
                  <DepartmentDoctorList
                    department={department}
                    facilityId={facilityId}
                    selectedId={value.practitionerId}
                    onSelect={selectDoctor}
                  />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// 展開した診療科にぶら下がる医師。開いたときだけ取りに行く。
function DepartmentDoctorList({
  department,
  facilityId,
  selectedId,
  onSelect,
}: {
  department: DepartmentOption;
  facilityId: string | undefined;
  selectedId: string;
  onSelect: (department: DepartmentOption, doctor: fhir4.Practitioner) => void;
}) {
  const { doctors, isPending, error } = useDepartmentDoctors(department.id, facilityId);

  if (isPending) return <p className="order-context__empty">読み込み中...</p>;
  if (error) return <p className="order-context__empty">医師を取得できませんでした</p>;
  if (doctors.length === 0) return <p className="order-context__empty">医師の登録がありません</p>;

  return (
    <div className="order-context__doctors">
      {doctors.map((doctor) => (
        <button
          key={doctor.id}
          type="button"
          className={`row-menu__item order-context__doctor${
            selectedId === doctor.id ? " order-context__item--active" : ""
          }`}
          onClick={() => onSelect(department, doctor)}
        >
          {practitionerDisplayName(doctor)}
        </button>
      ))}
    </div>
  );
}
