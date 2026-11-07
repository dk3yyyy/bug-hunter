# Contributing to Bug Hunter

Thanks for helping. Bug Hunter is a small, testable codebase and contributions of
all sizes are welcome: bug reports, docs fixes, provider support, prompt
improvements, and code.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug.** Include the version or commit, provider, the shape of the
  diff, and a scrubbed error message. Never paste tokens or `.env` contents.
- **Improve the docs.** Setup friction is a bug.
- **Add or fix a provider.** Provider resolution is isolated in
  `src/llm/config.ts` and `src/llm/models.ts`.
- **Tune prompts or wording.** Report wording lives in `prompts/voice.json`;
  model prompts live in `prompts/`.
- **Send a pull request.** Small, focused PRs with a test are easiest to review.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.

## Development setup

Requirements: **Node 22+** and `npm`.

```bash
git clone https://github.com/dk3yyyy/bug-hunter.git
cd bug-hunter
npm install
cp .env.example .env     # add a GitHub token and one model key
npm run dev              # http://localhost:3000
```

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for the full local walkthrough and
[docs/CONFIGURATION.md](docs/CONFIGURATION.md) for every variable.

## Before opening a pull request

```bash
npm run typecheck
npm test
```

CI runs both on every push and pull request. Please make them pass locally
first. The suite is unit plus in-process integration and does not call the
network.

### Tests

- Behaviour changes need a test.
- Pure modules (diff parsing, filtering, budget, sanitisation, rendering,
  provider resolution, webhook filters) are unit-tested.
- The hunt pipeline accepts injected model functions, so pipeline tests can run
  without a provider.
- Do not add tests that require a real GitHub token or a live model.
- If you fix a bug, add the failing case first when practical.

### Code style

- TypeScript, ESM, strict mode.
- Match the surrounding style; there is no separate formatter configuration.
- Keep network calls in the server, `src/github/`, or `src/llm/`. Keep the hunt
  pipeline and renderers pure where possible.
- Prefer explicit error handling over silent fallbacks, and never log secrets.
  Use `scrubSecrets` for anything that may contain a token.
- New environment variables need a Zod entry in `src/env.ts`, a line in
  `.env.example`, and a row in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

### Copy and prompts

- Keep the Halloween identity: Séance Report, creatures, haunting levels. It is
  the product's brand.
- Put posted strings in `prompts/voice.json` rather than hard-coding them.
- Prompt changes are behaviour changes; explain the before/after and add or
  update a test where the output is validated.
- Do not weaken security guidance to reduce findings. The verifier may drop a
  weak candidate, but rules cannot disable security checks.

### Docs and landing page

- Docs live in `docs/`. Link new pages from the README and from related pages.
- `src/render/landing.html` is also published to GitHub Pages. Changes to it
  trigger the `deploy-pages.yml` workflow.

## Pull request expectations

- Describe the problem and the change, not just the files touched.
- Keep unrelated refactors out of the same PR.
- Note any user-visible behaviour change, new environment variable, or
  deployment requirement.
- Include screenshots for landing-page or report-rendering changes.
- Be responsive to review; maintainers may ask for a narrower scope.

## Commit messages

Use a short imperative subject, for example:

```
Fix inline position snapping for renamed files
Add DeepSeek provider defaults
Document the shared-secret API
```

There is no enforced commit format. Squash or rebase is fine; the merged history
should stay readable.

## License

By contributing, you agree that your contribution is licensed under the
repository's [MIT License](LICENSE).
