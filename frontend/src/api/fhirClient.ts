import { notifyUnauthorized, withCsrfHeaders } from "./session";

const BASE = "/fhir";
const FHIR_JSON = "application/fhir+json";

// ログインセッション(HttpOnly Cookie)は same-origin fetch に自動で載る。
// ここでは非 GET への CSRF トークン付与と、401(このアプリ自身のセッション
// 失効。上流の 401 は backend が 502 に読み替える)の通知だけを行う。
async function fhirFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const res = await fetch(url, { ...init, headers: withCsrfHeaders(method, init.headers) });
  if (res.status === 401) notifyUnauthorized();
  return res;
}

export class FhirError extends Error {
  status: number;
  outcome?: fhir4.OperationOutcome;

  constructor(status: number, outcome?: fhir4.OperationOutcome) {
    super(`FHIR request failed with status ${status}`);
    this.name = "FhirError";
    this.status = status;
    this.outcome = outcome;
  }
}

export interface FhirResult<T> {
  data: T;
  etag: string | null;
}

async function handle<T>(res: Response): Promise<FhirResult<T>> {
  const etag = res.headers.get("ETag");

  if (res.status === 204) {
    if (!res.ok) throw new FhirError(res.status);
    return { data: undefined as T, etag };
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    throw new FhirError(res.status, body as fhir4.OperationOutcome | undefined);
  }

  return { data: body as T, etag };
}

export function searchResource<T extends fhir4.Resource>(
  resourceType: string,
  params: URLSearchParams,
): Promise<FhirResult<fhir4.Bundle<T>>> {
  return fhirFetch(`${BASE}/${resourceType}?${params.toString()}`).then((r) => handle(r));
}

export function readResource<T extends fhir4.Resource>(
  resourceType: string,
  id: string,
): Promise<FhirResult<T>> {
  return fhirFetch(`${BASE}/${resourceType}/${id}`).then((r) => handle(r));
}

/**
 * リソースの版履歴(history bundle)。上流の /<型>/<id>/_history をそのまま引く。
 * 各 entry.resource がその版の内容で、meta.versionId / meta.lastUpdated を持つ。
 */
export function readHistory<T extends fhir4.Resource>(
  resourceType: string,
  id: string,
  params?: URLSearchParams,
): Promise<FhirResult<fhir4.Bundle<T>>> {
  const query = params?.toString();
  return fhirFetch(
    `${BASE}/${resourceType}/${id}/_history${query ? `?${query}` : ""}`,
  ).then((r) => handle(r));
}

export function postBundle(bundle: fhir4.Bundle): Promise<FhirResult<fhir4.Bundle>> {
  return fhirFetch(BASE, {
    method: "POST",
    headers: { "Content-Type": FHIR_JSON },
    body: JSON.stringify(bundle),
  }).then((r) => handle(r));
}

export function createResource<T extends fhir4.Resource>(resource: T): Promise<FhirResult<T>> {
  return fhirFetch(`${BASE}/${resource.resourceType}`, {
    method: "POST",
    headers: { "Content-Type": FHIR_JSON },
    body: JSON.stringify(resource),
  }).then((r) => handle(r));
}

export function updateResource<T extends fhir4.Resource & { id?: string }>(
  resource: T,
  etag: string,
): Promise<FhirResult<T>> {
  return fhirFetch(`${BASE}/${resource.resourceType}/${resource.id}`, {
    method: "PUT",
    headers: { "Content-Type": FHIR_JSON, "If-Match": etag },
    body: JSON.stringify(resource),
  }).then((r) => handle(r));
}

export function deleteResource(resourceType: string, id: string): Promise<FhirResult<void>> {
  return fhirFetch(`${BASE}/${resourceType}/${id}`, { method: "DELETE" }).then((r) => handle(r));
}

// Binary を raw バイトで取得して dataURL にする。非 FHIR Accept を送ると
// 上流が data を decode した生バイトを contentType 付きで返す。
export async function fetchBinaryImage(id: string): Promise<string> {
  const res = await fhirFetch(`${BASE}/Binary/${id}`, { headers: { Accept: "image/*" } });
  if (!res.ok) throw new FhirError(res.status);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
    reader.readAsDataURL(blob);
  });
}
