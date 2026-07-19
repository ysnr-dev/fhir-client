const BASE = "/fhir";
const FHIR_JSON = "application/fhir+json";

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
  return fetch(`${BASE}/${resourceType}?${params.toString()}`).then((r) => handle(r));
}

export function readResource<T extends fhir4.Resource>(
  resourceType: string,
  id: string,
): Promise<FhirResult<T>> {
  return fetch(`${BASE}/${resourceType}/${id}`).then((r) => handle(r));
}

export function postBundle(bundle: fhir4.Bundle): Promise<FhirResult<fhir4.Bundle>> {
  return fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": FHIR_JSON },
    body: JSON.stringify(bundle),
  }).then((r) => handle(r));
}

export function createResource<T extends fhir4.Resource>(resource: T): Promise<FhirResult<T>> {
  return fetch(`${BASE}/${resource.resourceType}`, {
    method: "POST",
    headers: { "Content-Type": FHIR_JSON },
    body: JSON.stringify(resource),
  }).then((r) => handle(r));
}

export function updateResource<T extends fhir4.Resource & { id?: string }>(
  resource: T,
  etag: string,
): Promise<FhirResult<T>> {
  return fetch(`${BASE}/${resource.resourceType}/${resource.id}`, {
    method: "PUT",
    headers: { "Content-Type": FHIR_JSON, "If-Match": etag },
    body: JSON.stringify(resource),
  }).then((r) => handle(r));
}

export function deleteResource(resourceType: string, id: string): Promise<FhirResult<void>> {
  return fetch(`${BASE}/${resourceType}/${id}`, { method: "DELETE" }).then((r) => handle(r));
}
