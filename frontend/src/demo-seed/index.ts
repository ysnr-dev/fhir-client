// デモ用サンプル患者の生成器の入口。`run()` で全シナリオ、`run(["diabetes"])` で指定したものだけ流す。
// 同じ氏名・生年月日の患者がいるシナリオは飛ばすので、何度流しても二重にはならない。

import { fetchRegimen, radiotherapyProtocolClient } from "../api/masterClient";
import { DrugMaster, findDisease, findTemplate, LabMaster, loadEnv } from "./base";
import { REQUIREMENTS as ckdRequirements, seedCkd } from "./ckd";
import { REQUIREMENTS as diabetesRequirements, seedDiabetes } from "./diabetes";
import { REQUIREMENTS as headNeckRequirements, seedHeadNeckRadiotherapy } from "./headNeckRadiotherapy";
import { REQUIREMENTS as heartFailureRequirements, seedHeartFailure } from "./heartFailure";
import { REQUIREMENTS as periodontalRequirements, seedPeriodontal } from "./periodontal";
import { REQUIREMENTS as rectalRequirements, seedRectalCancer } from "./rectalCancer";

export const SCENARIOS = {
  diabetes: seedDiabetes,
  rectal: seedRectalCancer,
  heartFailure: seedHeartFailure,
  ckd: seedCkd,
  periodontal: seedPeriodontal,
  headNeckRt: seedHeadNeckRadiotherapy,
} as const;

export type ScenarioName = keyof typeof SCENARIOS;

export async function run(
  names: ScenarioName[] = Object.keys(SCENARIOS) as ScenarioName[],
  nameSuffix = "",
): Promise<string[]> {
  const lines: string[] = [];
  const log = (message: string) => {
    lines.push(message);
    console.log(`[demo-seed] ${message}`);
  };
  const env = await loadEnv(log, nameSuffix);
  log(`実行者: ${env.practitioner.name} / 診療科 ${env.departments.length} 件 / ベッド ${env.beds.length} 床`);
  for (const name of names) {
    log(`--- ${name}`);
    await SCENARIOS[name](env);
  }
  return lines;
}

/**
 * 書き込む前の確認。各シナリオが使うマスタ(検査項目・薬剤・用法・病名・レジメン・放射線治療の
 * プロトコル)とテンプレートが揃っているかを見て、足りないものを返す。途中で止まって半端な患者が残らないように、
 * 本番へ流す前に `--check` で見る。
 */
export async function preflight(): Promise<string[]> {
  const missing: string[] = [];
  const all = [
    diabetesRequirements,
    rectalRequirements,
    heartFailureRequirements,
    ckdRequirements,
    periodontalRequirements,
    headNeckRequirements,
  ];
  const labs = new LabMaster();
  const labCodes = [...new Set(all.flatMap((r) => r.labs))];
  await labs.load(labCodes);
  for (const code of labCodes) if (!labs.get(code)) missing.push(`検査結果項目 ${code}`);
  for (const code of ckdRequirements.codedLabs) {
    const item = labs.get(code);
    if (item && item.data_type !== "CO" && item.data_type !== "CD") {
      missing.push(`検査結果項目 ${code}(${item.name})がコード型ではありません(チャートの網掛けは付きません)`);
    }
  }
  const drugs = new DrugMaster();
  const medicineCodes = [...new Set(all.flatMap((r) => r.medicines))];
  const usages = [...new Set(all.flatMap((r) => r.usages))];
  await drugs.load(medicineCodes, usages);
  for (const code of medicineCodes) {
    try {
      drugs.medicine(code);
    } catch {
      missing.push(`薬剤 ${code}`);
    }
  }
  for (const usage of usages) {
    try {
      drugs.usage(usage);
    } catch {
      missing.push(`用法「${usage}」`);
    }
  }
  for (const name of new Set(all.flatMap((r) => r.diseases))) {
    await findDisease(name).catch(() => missing.push(`病名「${name}」`));
  }
  for (const code of rectalRequirements.regimens) {
    await fetchRegimen(code).catch(() => missing.push(`レジメン ${code}(直腸癌の化学療法は飛ばされます)`));
  }
  for (const code of [rectalRequirements.radiotherapyProtocol, headNeckRequirements.radiotherapyProtocol]) {
    const protocols = await radiotherapyProtocolClient.search({ code, per: 5 });
    if (!protocols.items.some((p) => p.code === code)) {
      missing.push(`放射線治療プロトコル ${code}(放射線治療は飛ばされます)`);
    }
  }
  for (const url of [...periodontalRequirements.templates, ...headNeckRequirements.templates]) {
    if (!(await findTemplate(url))) missing.push(`テンプレート ${url}(取り込むまでそのシナリオは飛ばされます)`);
  }
  return missing;
}
