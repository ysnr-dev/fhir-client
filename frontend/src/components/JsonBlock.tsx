import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";

hljs.registerLanguage("json", json);

export function JsonBlock({ value }: { value: unknown }) {
  const code = JSON.stringify(value, null, 2);
  const html = hljs.highlight(code, { language: "json" }).value;

  return (
    <pre className="json-block">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
