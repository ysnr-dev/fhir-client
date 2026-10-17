import { useMemo } from "react";
import { usePatientFolderMembers, usePatientFolders } from "../../api/masterQueries";
import { usePatientsByIds } from "../../api/queries";
import { usePatientFolderOwners } from "../../hooks/usePatientFolderOwners";
import { useRowPictograms } from "../../hooks/useRowPictograms";
import { ErrorBanner } from "../ErrorBanner";
import { PatientFolderMemberTable } from "../PatientFolderMemberTable";
import { patientFolderPath } from "../patientFolderTree";
import { HomeCardFrame, HomeCardLoading, type HomeCardProps } from "./shared";

/** 患者フォルダ 1 つの患者。患者フォルダの画面と同じ表(操作なし)。 */
export function FolderCard({ card }: HomeCardProps<"folder">) {
  const folderId = card.settings.folderId;
  const { departmentId, practitionerId } = usePatientFolderOwners();
  const folders = usePatientFolders(departmentId || undefined, practitionerId ?? undefined);
  const items = useMemo(() => folders.data?.items ?? [], [folders.data]);
  const folder = items.find((f) => f.id === folderId);
  const members = usePatientFolderMembers(folderId, false);
  const rows = useMemo(() => members.data?.items ?? [], [members.data]);
  const patientIds = useMemo(() => [...new Set(rows.map((m) => m.patient_id))], [rows]);
  const patients = usePatientsByIds(patientIds);
  const pictograms = useRowPictograms(patientIds);

  return (
    <HomeCardFrame
      title={folder ? patientFolderPath(items, folder.id) : "患者フォルダ"}
      link={{ to: folder ? `/patient-folders?folder=${folder.id}` : "/patient-folders", label: "患者フォルダ" }}
    >
      <ErrorBanner error={folders.error ?? members.error ?? patients.error} />
      {members.isPending || folders.isPending ? (
        <HomeCardLoading />
      ) : !folder ? (
        <p className="home__empty">フォルダが見つかりません。</p>
      ) : rows.length === 0 ? (
        <p className="home__empty">登録した患者はいません。</p>
      ) : (
        <div className="home__table-wrap">
          <PatientFolderMemberTable
            className="home__table"
            members={rows}
            patients={patients.data}
            patientsPending={patients.isPending}
            pictograms={pictograms}
          />
        </div>
      )}
    </HomeCardFrame>
  );
}
