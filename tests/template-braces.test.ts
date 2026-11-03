// P0 regression: the "unfilled placeholder" guard used to scan the FILLED output,
// so any brace pair in interpolated data aborted the hunt. A PR touching a GitHub
// Actions workflow (${{ secrets.X }}), a Handlebars/Jinja/Go template, or this
// repo's own prompts/*.md could never be hunted — the failure happened before the
// model was even called.
import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/hunt/pipeline";
import { fillTemplate } from "../src/prompts";

const ACTIONS = "- run: echo ${{ secrets.GITHUB_TOKEN }}";
const HANDLEBARS = "{{#if user}}hi{{/if}}";
const JINJA = "{{ range .Values.services }}";
const OWN_PROMPT = "Please fill {{repo_rules}} and {{annotated_diff}}.";

describe("renderTemplate tolerates braces in data", () => {
  it.each([
    ["GitHub Actions", ACTIONS],
    ["Handlebars", HANDLEBARS],
    ["Go template", JINJA],
    ["this repo's own prompt text", OWN_PROMPT],
  ])("does not throw on %s in the diff", (_label, data) => {
    expect(() => renderTemplate("DIFF:\n{{diff}}", { diff: data })).not.toThrow();
  });

  it("keeps the data byte-for-byte", () => {
    const out = renderTemplate("DIFF:\n{{diff}}", { diff: ACTIONS });
    expect(out).toBe(`DIFF:\n${ACTIONS}`);
  });

  it("does not treat a data value equal to a placeholder name as unfilled", () => {
    // `{{max_findings}}` inside the diff is data, not a template variable.
    const out = renderTemplate("{{diff}}", { diff: "{{max_findings}}" });
    expect(out).toBe("{{max_findings}}");
  });

  it("still rejects an unknown placeholder in the TEMPLATE", () => {
    expect(() => renderTemplate("hello {{unknown_var}}", {})).toThrow(/missing template vars/);
  });

  it("still rejects a malformed placeholder in the TEMPLATE", () => {
    // Non-word placeholders are not substituted, so they can never be filled:
    // that is a prompt bug and must still be caught.
    expect(() => renderTemplate("{{#if something}}", {})).toThrow(
      /unfilled placeholder in prompt/,
    );
    expect(() => renderTemplate("{{ if something }}", {})).toThrow(
      /unfilled placeholder in prompt/,
    );
  });

  it("still substitutes ordinary placeholders", () => {
    expect(renderTemplate("a {{x}} b", { x: "1" })).toBe("a 1 b");
  });
});

describe("fillTemplate (voice/status strings) has the same guard", () => {
  it("does not throw when a verified reason quotes templated code", () => {
    // This is the path that killed reports: the verifier's free-text reason is
    // interpolated into a voice template, never through renderTemplate first.
    const reason = "The `{{ secrets.X }}` template is unescaped";
    expect(() => fillTemplate("Reason: {{reason}}", { reason })).not.toThrow();
    expect(fillTemplate("Reason: {{reason}}", { reason })).toBe(`Reason: ${reason}`);
  });

  it("still rejects a malformed placeholder in the voice template", () => {
    expect(() => fillTemplate("{{bad placeholder}}", {})).toThrow(/unfilled placeholder/);
  });

  it("still rejects an unknown word placeholder in the voice template", () => {
    expect(() => fillTemplate("{{nope}}", {})).toThrow(/missing template vars/);
  });
});
