import {
  useDepartmentDoctors,
  useLocationOptions,
  usePractitionerOptions,
  useSelfDepartments,
  useSelfOrganization,
} from "../api/queries";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import { OUTPATIENT_ROOM_TYPE_CODE, locationTypeCode } from "../fhir/locationHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";

// 受付内容(診療科・担当医・診察室)の入力欄。当日受付と新患登録で同じものを使う。
//
// 担当医は診療科を選ぶとその科に所属する医師だけになる(依頼科 → 依頼医師の
// 階層選択と同じ作り)。科を選んでいない間は全員を候補にする。
// 診察室は外来の診察室だけを出す(撮影室・手術室などは受付先にならない)。

export interface ReceptionSelects {
  departmentId: string;
  practitionerId: string;
  locationId: string;
}

export const emptyReceptionSelects: ReceptionSelects = {
  departmentId: "",
  practitionerId: "",
  locationId: "",
};

interface ReceptionFieldsProps {
  /** 3 つの欄を並べる入れ物のクラス(モーダルごとに並びが違うため)。 */
  className: string;
  values: ReceptionSelects;
  onChange: (values: ReceptionSelects) => void;
}

export function ReceptionFields({ className, values, onChange }: ReceptionFieldsProps) {
  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();

  const { selfOrganizationId } = useSelfOrganization();
  const { doctors } = useDepartmentDoctors(
    values.departmentId || undefined,
    selfOrganizationId || undefined,
  );

  const practitionerOptions = values.departmentId ? doctors : practitioners.practitioners;
  const rooms = locations.locations.filter(
    (location) => locationTypeCode(location) === OUTPATIENT_ROOM_TYPE_CODE,
  );

  function changeDepartment(departmentId: string) {
    // 科が変われば担当医の指定も外す(前の科の医師が残らないように)。
    onChange({ ...values, departmentId, practitionerId: "" });
  }

  return (
    <div className={className}>
      <label>
        診療科
        <select value={values.departmentId} onChange={(e) => changeDepartment(e.target.value)}>
          <option value="">未指定</option>
          {departments.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {departmentDisplayName(department)}
            </option>
          ))}
        </select>
      </label>
      <label>
        担当医
        <select
          value={values.practitionerId}
          onChange={(e) => onChange({ ...values, practitionerId: e.target.value })}
        >
          <option value="">未指定</option>
          {practitionerOptions.map((practitioner) => (
            <option key={practitioner.id} value={practitioner.id}>
              {practitionerDisplayName(practitioner)}
            </option>
          ))}
        </select>
      </label>
      <label>
        診察室
        <select
          value={values.locationId}
          onChange={(e) => onChange({ ...values, locationId: e.target.value })}
        >
          <option value="">未指定</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
