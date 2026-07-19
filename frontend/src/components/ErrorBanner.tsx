import { errorMessages } from "../fhir/outcome";

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const messages = errorMessages(error);
  if (!messages.length) return null;

  return (
    <div className="error-banner" role="alert">
      {messages.map((m, i) => (
        <p key={i} className={`error-banner__line error-banner__line--${m.severity}`}>
          {m.text}
        </p>
      ))}
    </div>
  );
}
